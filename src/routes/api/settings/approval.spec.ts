import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'hub-approval-api-'));

const { getDb, schema } = await import('#lib/server/db/index.js');
const { createChore } = await import('#lib/server/domain/ledger.js');
const approval = await import('./approval/+server.js');

type Handler = (e: unknown) => Response | Promise<Response>;
const event = (adult: boolean, body?: unknown) => ({
	locals: { adult: adult ? { id: 'adult', name: 'Test Adult' } : null },
	cookies: { get: () => undefined },
	request: new Request('http://example.com/x', {
		method: 'PUT',
		body: body === undefined ? undefined : JSON.stringify(body)
	})
});
const call = async (h: unknown, adult = true, body?: unknown) =>
	(await (h as Handler)(event(adult, body))).json();

it('is off by default and adult-only', async () => {
	expect(await call(approval.GET)).toEqual({ on: false });
	await expect(call(approval.GET, false)).rejects.toMatchObject({ status: 401 });
	await expect(call(approval.PUT, false, { on: true })).rejects.toMatchObject({ status: 401 });
	await expect(call(approval.POST, false)).rejects.toMatchObject({ status: 401 });
});

it('turns the default on and off', async () => {
	expect(await call(approval.PUT, true, { on: true })).toEqual({ on: true });
	expect(await call(approval.GET)).toEqual({ on: true });
	expect(await call(approval.PUT, true, { on: false })).toEqual({ on: false });
	await expect(call(approval.PUT, true, { on: 'yes' })).rejects.toMatchObject({ status: 400 });
});

it('turns approval off on every to-do', async () => {
	await call(approval.PUT, true, { on: true });
	createChore(getDb(), { title: 'Dishes' });
	expect(await call(approval.POST)).toEqual({ on: false, chores: 1, approved: 0 });
	expect(await call(approval.GET)).toEqual({ on: false });
	const rows = getDb().select().from(schema.chores).all();
	expect(rows.every((r) => !r.requiresApproval)).toBe(true);
});
