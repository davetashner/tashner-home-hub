import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'hub-siri-api-'));

const { getDb, schema } = await import('#lib/server/db/index.js');
const tokens = await import('./api-tokens/+server.js');
const oneToken = await import('./api-tokens/[id]/+server.js');
const choresApi = await import('./chores/+server.js');
const { verifyToken } = await import('#lib/server/domain/api-tokens.js');

const adult = { id: 'adult', name: 'Test Adult' };
const post = (body: unknown, auth?: string) =>
	new Request('http://example.com/x', {
		method: 'POST',
		headers: auth ? { authorization: `Bearer ${auth}` } : {},
		body: typeof body === 'string' ? body : JSON.stringify(body)
	});
const call = async (h: unknown, ev: Record<string, unknown>) => {
	try {
		return await (h as (e: unknown) => Promise<Response> | Response)({
			locals: { adult: null },
			...ev
		});
	} catch (e) {
		const err = e as { status?: number };
		if (err.status) return new Response(null, { status: err.status });
		throw e;
	}
};
async function mint(name: string, scopes: string[]) {
	const res = await call(tokens.POST, {
		locals: { adult },
		request: post({ name, scopes })
	});
	expect(res.status).toBe(201);
	return (await res.json()) as { id: string; token: string };
}

describe('token management', () => {
	it('is adult-only', async () => {
		expect((await call(tokens.GET, {})).status).toBe(401);
		expect(
			(await call(tokens.POST, { request: post({ name: 'x', scopes: ['lists:add'] }) })).status
		).toBe(401);
		expect((await call(oneToken.DELETE, { params: { id: 'x' } })).status).toBe(401);
	});

	it('shows the secret once, stores only a hash, and revokes', async () => {
		const t = await mint('Test Phone', ['lists:add']);
		expect(t.token.length).toBeGreaterThanOrEqual(43);
		const rows = getDb().select().from(schema.apiTokens).all();
		expect(rows.some((r) => r.tokenHash.includes(t.token))).toBe(false);
		expect(rows.find((r) => r.id === t.id)!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
		const listed = await (await call(tokens.GET, { locals: { adult } })).json();
		expect(JSON.stringify(listed)).not.toContain(t.token);
		expect(verifyToken(getDb(), t.token)?.id).toBe(t.id);
		expect((await call(oneToken.DELETE, { locals: { adult }, params: { id: t.id } })).status).toBe(
			200
		);
		expect(verifyToken(getDb(), t.token)).toBeNull();
		expect((await call(oneToken.DELETE, { locals: { adult }, params: { id: t.id } })).status).toBe(
			404
		);
	});

	it('rejects bad names and scopes', async () => {
		for (const body of [
			{ name: '  ', scopes: ['lists:add'] },
			{ name: 'x'.repeat(41), scopes: ['lists:add'] },
			{ name: 'ok', scopes: [] },
			{ name: 'ok', scopes: ['admin'] },
			{ name: 'ok' }
		])
			expect((await call(tokens.POST, { locals: { adult }, request: post(body) })).status).toBe(
				400
			);
	});
});

describe('bearer tokens', () => {
	it('are not accepted by other APIs', async () => {
		const t = await mint('Everything', ['lists:add', 'chores:create']);
		const res = await call(choresApi.POST, { request: post({ title: 'Sneaky' }, t.token) });
		expect(res.status).toBe(401);
	});

	it('stamp last use and reject unknown secrets', async () => {
		const t = await mint('Stamp', ['lists:add']);
		const before = await (await call(tokens.GET, { locals: { adult } })).json();
		expect(before.find((x: { id: string }) => x.id === t.id).lastUsedAt).toBeNull();
		expect(verifyToken(getDb(), 'a'.repeat(43))).toBeNull();
		expect(verifyToken(getDb(), t.token)?.scopes).toEqual(['lists:add']);
		const after = await (await call(tokens.GET, { locals: { adult } })).json();
		expect(after.find((x: { id: string }) => x.id === t.id).lastUsedAt).toBeGreaterThan(0);
	});
});
