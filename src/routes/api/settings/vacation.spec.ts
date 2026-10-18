import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'hub-vacation-api-'));

const vacation = await import('./vacation/+server.js');
type Handler = (e: unknown) => Response | Promise<Response>;
const call = async (fn: unknown, body?: unknown, adult = true) =>
	(fn as Handler)({
		locals: { adult: adult ? { id: 'adult', name: 'Test Adult' } : null },
		cookies: { get: () => undefined },
		request: new Request('http://example.com/x', {
			method: 'PUT',
			body: body === undefined ? undefined : JSON.stringify(body)
		})
	});
const get = async () => (await call(vacation.GET)).json();

it('starts with no vacation, readable without a session', async () => {
	expect(await get()).toEqual({ vacation: null });
});

it('lets a grown-up set and clear a range', async () => {
	const body = { start: '2026-07-01', back: '2026-07-08' };
	expect(await (await call(vacation.PUT, body)).json()).toEqual({ vacation: body });
	expect(await get()).toEqual({ vacation: body });
	await call(vacation.DELETE);
	expect(await get()).toEqual({ vacation: null });
});

it('accepts an open-ended vacation and ends it today', async () => {
	await call(vacation.PUT, { start: '2020-01-01', back: null });
	expect((await get()).vacation).toEqual({ start: '2020-01-01', back: null });
	const ended = (await (await call(vacation.POST)).json()) as { vacation: { back: string } };
	expect(ended.vacation.back).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});

it('rejects bad dates without writing', async () => {
	await call(vacation.DELETE);
	for (const body of [{}, { start: 'x' }, { start: '2026-07-08', back: '2026-07-01' }])
		await expect(call(vacation.PUT, body)).rejects.toMatchObject({ status: 400 });
	expect(await get()).toEqual({ vacation: null });
});

it('needs an adult to change it', async () => {
	await expect(call(vacation.PUT, { start: '2026-07-01' }, false)).rejects.toMatchObject({
		status: 401
	});
	await expect(call(vacation.POST, undefined, false)).rejects.toMatchObject({ status: 401 });
	await expect(call(vacation.DELETE, undefined, false)).rejects.toMatchObject({ status: 401 });
});
