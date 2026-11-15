import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'hub-drawing-challenges-api-'));

const { getDb, schema } = await import('#lib/server/db/index.js');
const api = await import('./drawing-challenges/+server.js');
const done = await import('./drawing-challenges/done/+server.js');

type Handler = (e: unknown) => Response | Promise<Response>;
const event = (adult: boolean, body?: unknown) => ({
	locals: { adult: adult ? { id: 'adult', name: 'Test Adult' } : null },
	cookies: { get: () => undefined },
	request: new Request('http://example.com/x', {
		method: 'POST',
		body: body === undefined ? undefined : JSON.stringify(body)
	})
});
const call = async (h: unknown, adult = true, body?: unknown) =>
	(await (h as Handler)(event(adult, body))).json();

getDb()
	.insert(schema.members)
	.values([
		{ id: 'kid-a', name: 'Kid A', role: 'child', color: 'member-1' },
		{ id: 'kid-b', name: 'Kid B', role: 'child', color: 'member-2' },
		{ id: 'grown', name: 'Grown Up', role: 'adult', color: 'member-3' }
	])
	.run();

it('an adult sets challenges, anyone reads them, a kid cannot set one', async () => {
	expect(await call(api.GET, false)).toEqual([]);
	await expect(call(api.POST, false, { memberId: 'kid-a', text: 'x' })).rejects.toMatchObject({
		status: 401
	});
	await expect(call(api.POST, true, { memberId: 'kid-a', text: '' })).rejects.toMatchObject({
		status: 400
	});
	await expect(call(api.POST, true, { memberId: 'grown', text: 'x' })).rejects.toMatchObject({
		status: 400
	});
	await expect(call(api.POST, true, { memberId: 'nobody', text: 'x' })).rejects.toMatchObject({
		status: 400
	});
	const a = await call(api.POST, true, { memberId: 'kid-a', text: 'Draw dinner on Friday' });
	expect(a).toMatchObject({ memberId: 'kid-a', text: 'Draw dinner on Friday' });
	const a2 = await call(api.POST, true, { memberId: 'kid-a', text: 'Draw a snack' });
	await call(api.POST, true, { memberId: 'kid-b', text: 'Draw a pet' });
	const list = await call(api.GET, false);
	expect(list.map((c: { text: string }) => c.text)).toEqual(['Draw a snack', 'Draw a pet']);
	expect(a2.id).not.toBe(a.id);
});

it('delete is adult only; done clears by id or by kid for anyone', async () => {
	const list = await call(api.GET, false);
	await expect(call(api.DELETE, false, { id: list[0].id })).rejects.toMatchObject({ status: 401 });
	await expect(call(api.DELETE, true, {})).rejects.toMatchObject({ status: 400 });
	expect(await call(api.DELETE, true, { id: list[0].id })).toHaveLength(1);
	await expect(call(done.POST, false, {})).rejects.toMatchObject({ status: 400 });
	await call(api.POST, true, { memberId: 'kid-a', text: 'Again' });
	expect(await call(done.POST, false, { memberId: 'kid-a' })).toHaveLength(1);
	const [left] = await call(api.GET, false);
	expect(await call(done.POST, false, { id: left.id })).toEqual([]);
});
