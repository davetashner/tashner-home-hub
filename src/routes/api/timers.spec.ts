import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'hub-timers-api-'));

const list = await import('./timers/+server.js');
const one = await import('./timers/[id]/+server.js');

const req = (method: string, body?: unknown) =>
	new Request('http://example.com/x', {
		method,
		body: body === undefined ? undefined : JSON.stringify(body)
	});
const call = async (h: unknown, ev: Record<string, unknown>) =>
	(h as (e: unknown) => Promise<Response> | Response)({ locals: { adult: null }, ...ev });

describe('timers API', () => {
	it('starts, pauses, adds time to and dismisses a timer without an adult session', async () => {
		const res = await call(list.POST, {
			request: req('POST', { durationMs: 60_000, label: 'Pasta' })
		});
		expect(res.status).toBe(201);
		const created = await res.json();
		const all = await (await call(list.GET, {})).json();
		expect(all.timers).toHaveLength(1);
		expect(typeof all.now).toBe('number');
		const paused = await (
			await call(one.PATCH, {
				params: { id: created.id },
				request: req('PATCH', { action: 'pause' })
			})
		).json();
		expect(paused.endsAt).toBeNull();
		const added = await call(one.PATCH, {
			params: { id: created.id },
			request: req('PATCH', { action: 'add', ms: 60_000 })
		});
		expect((await added.json()).pausedMs).toBeGreaterThan(100_000);
		expect((await call(one.DELETE, { params: { id: created.id } })).status).toBe(200);
		expect((await (await call(list.GET, {})).json()).timers).toHaveLength(0);
	});
	it('refuses a bad duration', async () => {
		await expect(
			call(list.POST, { request: req('POST', { durationMs: 3 }) })
		).rejects.toMatchObject({
			status: 400
		});
	});
});
