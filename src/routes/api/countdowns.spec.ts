import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'hub-countdowns-api-'));

const list = await import('./countdowns/+server.js');
const { getDb } = await import('#lib/server/db/index.js');
const { calendarSources, events } = await import('#lib/server/db/schema.js');
const one = await import('./countdowns/[id]/+server.js');

const req = (method: string, body?: unknown) =>
	new Request('http://example.com/x', {
		method,
		body: body === undefined ? undefined : JSON.stringify(body)
	});
const call = async (h: unknown, ev: Record<string, unknown>, adult = true) =>
	(h as (e: unknown) => Promise<Response> | Response)({
		locals: { adult: adult ? { id: 'adult', name: 'Test Adult' } : null },
		...ev
	});

describe('countdowns API', () => {
	it('creates, lists, edits and deletes', async () => {
		const res = await call(list.POST, {
			request: req('POST', { title: 'Beach trip', targetDate: '2026-12-01', icon: '🏖️' })
		});
		expect(res.status).toBe(201);
		const created = await res.json();
		expect(await (await call(list.GET, {}, false)).json()).toHaveLength(1);
		const patched = await (
			await call(one.PATCH, {
				params: { id: created.id },
				request: req('PATCH', { targetDate: '2026-12-05' })
			})
		).json();
		expect(patched.targetDate).toBe('2026-12-05');
		const del = await call(one.DELETE, { params: { id: created.id } });
		expect(del.status).toBe(200);
		expect(await (await call(list.GET, {})).json()).toHaveLength(0);
	});
	it('rejects bad input and missing rows', async () => {
		await expect(
			call(list.POST, { request: req('POST', { title: 'x', targetDate: '2026-02-30' }) })
		).rejects.toMatchObject({ status: 400 });
		await expect(call(one.DELETE, { params: { id: 'nope' } })).rejects.toMatchObject({
			status: 404
		});
	});
	it('lets kids add, but only adults edit or delete', async () => {
		const res = await call(
			list.POST,
			{ request: req('POST', { title: 'Kid party', targetDate: '2026-12-01' }) },
			false
		);
		expect(res.status).toBe(201);
		const { id } = await res.json();
		await expect(
			call(one.PATCH, { params: { id }, request: req('PATCH', { title: 'y' }) }, false)
		).rejects.toBeDefined();
		await expect(call(one.DELETE, { params: { id } }, false)).rejects.toBeDefined();
		await call(one.DELETE, { params: { id } });
	});
	it('counts down to a calendar event, once, for kids too, and unlinks', async () => {
		const db = getDb();
		db.insert(calendarSources).values({ id: 'src', provider: 'ics', label: 'Family' }).run();
		db.insert(events)
			.values({
				id: 'ev1',
				sourceId: 'src',
				externalId: 'uid-1',
				title: 'Cousins visit',
				startsAt: Date.UTC(2026, 11, 5),
				endsAt: Date.UTC(2026, 11, 6),
				allDay: true
			})
			.run();
		const post = () => call(list.POST, { request: req('POST', { eventId: 'ev1' }) }, false);
		const first = await post();
		expect(first.status).toBe(201);
		const made = await first.json();
		expect(made).toMatchObject({ title: 'Cousins visit', targetDate: '2026-12-05' });
		const again = await post();
		expect(again.status).toBe(200);
		expect((await again.json()).id).toBe(made.id);
		await expect(
			call(list.POST, { request: req('POST', { eventId: 'nope' }) }, false)
		).rejects.toMatchObject({ status: 404 });
		db.delete(events).run();
		const [shown] = await (await call(list.GET, {})).json();
		expect(shown.eventMissing).toBe(true);
		const unlinked = await (
			await call(one.PATCH, { params: { id: made.id }, request: req('PATCH', { unlink: true }) })
		).json();
		expect(unlinked.eventExternalId).toBeNull();
		await call(one.DELETE, { params: { id: made.id } });
	});
});
