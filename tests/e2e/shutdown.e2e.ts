import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

const PORT = 4991;

// Boots the BUILT server on its own port and data dir, holds a long-lived connection open,
// sends SIGTERM and checks the process exits 0 quickly (docker stop gives it only 10 s).
test('server exits 0 within 3 s of SIGTERM with a long-lived connection open @J16.6', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'hub-shutdown-'));
	const port = PORT + test.info().parallelIndex;
	const child = spawn('node', ['build'], {
		env: { ...process.env, DATA_DIR: dir, PORT: String(port), HOST: '127.0.0.1' },
		stdio: 'ignore'
	});
	const exited = new Promise<{ code: number | null; signal: string | null }>((resolve) =>
		child.on('exit', (code, signal) => resolve({ code, signal }))
	);
	try {
		await expect
			.poll(
				async () => {
					try {
						return (await fetch(`http://127.0.0.1:${port}/healthz`)).status;
					} catch {
						return 0;
					}
				},
				{ timeout: 20_000 }
			)
			.toBe(200);

		// A request that never completes stands in for a long-lived stream (SSE).
		const socket = createConnection(port, '127.0.0.1');
		const closed = new Promise<void>((resolve) => socket.on('close', () => resolve()));
		socket.on('error', () => undefined);
		await new Promise<void>((r) => socket.on('connect', () => r()));
		socket.write('GET /healthz HTTP/1.1\r\nHost: localhost\r\n');

		const started = Date.now();
		child.kill('SIGTERM');
		const result = await Promise.race([
			exited,
			new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), 3_000))
		]);
		expect(result).toEqual({ code: 0, signal: null });
		expect(Date.now() - started).toBeLessThan(3_000);
		await closed;
	} finally {
		child.kill('SIGKILL');
		rmSync(dir, { recursive: true, force: true });
	}
});
