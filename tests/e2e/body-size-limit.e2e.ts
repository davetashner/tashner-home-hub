import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import Database from 'better-sqlite3';
import { expect, test } from '@playwright/test';
import { hashPin } from '../../src/lib/server/domain/pin';
import { PIN } from './adult';
import { DB_PATH } from './data-dir';

// hub-7az.9: adapter-node rejects bodies over 512 KB unless BODY_SIZE_LIMIT is set, which broke
// big data imports. The image sets it in the Dockerfile; this boots the production build with
// that exact value (the shared test server has no override) and posts a ~1 MB import.

const dockerLimit = /^\s*BODY_SIZE_LIMIT=(\S+)/m.exec(readFileSync('Dockerfile', 'utf8'))?.[1];
// Valid JSON, but not an export: the import API answers 422 before touching any data.
const bigBody = JSON.stringify({ padding: 'x'.repeat(1024 * 1024) });

async function freePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const srv = createServer();
		srv.listen(0, '127.0.0.1', () => {
			const { port } = srv.address() as { port: number };
			srv.close(() => resolve(port));
		});
		srv.on('error', reject);
	});
}

async function withServer(
	limit: string | undefined,
	run: (base: string) => Promise<void>
): Promise<void> {
	const port = await freePort();
	const env = { ...process.env, HOST: '127.0.0.1', PORT: String(port) };
	delete (env as Record<string, unknown>).BODY_SIZE_LIMIT;
	if (limit) env.BODY_SIZE_LIMIT = limit;
	const child: ChildProcess = spawn('node', ['build'], { env, stdio: 'ignore' });
	const base = `http://127.0.0.1:${port}`;
	try {
		await expect
			.poll(
				() =>
					fetch(`${base}/healthz`).then(
						(r) => r.ok,
						() => false
					),
				{ timeout: 30_000 }
			)
			.toBe(true);
		await run(base);
	} finally {
		child.kill();
	}
}

// One adult per project: projects run in parallel against the same SQLite file.
const adultFor = () => `body-limit-${test.info().project.name}`;

async function postImport(base: string, adultId: string): Promise<number> {
	const db = new Database(DB_PATH);
	db.pragma('busy_timeout = 5000');
	db.prepare(
		"INSERT OR REPLACE INTO members (id, name, role, color, pin_hash) VALUES (?, 'Test Adult', 'adult', 'member-1', ?)"
	).run(adultId, hashPin(PIN));
	db.close();
	const auth = await fetch(`${base}/api/auth/pin`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ memberId: adultId, pin: PIN, remember: true })
	});
	expect(auth.ok).toBe(true);
	const cookie = auth.headers
		.getSetCookie()
		.map((c) => c.split(';')[0])
		.join('; ');
	const res = await fetch(`${base}/api/admin/import`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', cookie },
		body: bigBody
	});
	return res.status;
}

test.describe('BODY_SIZE_LIMIT', () => {
	test('the Dockerfile sets a limit of at least 10 MB @J16.6', () => {
		expect(dockerLimit).toBeDefined();
		const mb = /^(\d+)M$/.exec(dockerLimit ?? '');
		expect(Number(mb?.[1])).toBeGreaterThanOrEqual(10);
	});

	test('without the limit a 1 MB import is rejected (400, never reaches validation) @J16.6', async () => {
		await withServer(undefined, async (base) => {
			// The oversized stream errors inside request.json(), which the route reports as 400.
			expect(await postImport(base, adultFor())).toBe(400);
		});
	});

	test('with the Dockerfile limit a 1 MB import reaches validation (422) @J16.6', async () => {
		await withServer(dockerLimit, async (base) => {
			expect(await postImport(base, adultFor())).toBe(422);
		});
	});
});
