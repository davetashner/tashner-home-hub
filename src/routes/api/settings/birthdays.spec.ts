import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'hub-birthdays-api-'));

const route = await import('./birthdays/+server.js');
const event = (adult: boolean, init?: RequestInit) => ({
	locals: { adult: adult ? { id: 'adult', name: 'Test Adult' } : null },
	cookies: { get: () => undefined },
	request: new Request('http://example.com/x', init)
});
const get = (adult = true) =>
	(route.GET as unknown as (e: unknown) => Promise<Response> | Response)(event(adult));
const put = (body: unknown, adult = true) =>
	(route.PUT as unknown as (e: unknown) => Promise<Response>)(
		event(adult, { method: 'PUT', body: JSON.stringify(body) })
	);

// Synthetic dates only.
it('starts empty', async () => {
	expect(await (await get()).json()).toEqual({ birthdays: [] });
});

it('saves a sorted list with labels, and reads it back', async () => {
	const res = await put({
		birthdays: [
			{ month: 9, day: 2, label: 'Kid B' },
			{ month: 2, day: 29 }
		]
	});
	const want = {
		birthdays: [
			{ month: 2, day: 29 },
			{ month: 9, day: 2, label: 'Kid B' }
		]
	};
	expect(await res.json()).toEqual(want);
	expect(await (await get()).json()).toEqual(want);
});

it('rejects impossible dates, repeats and too many, keeping the saved list', async () => {
	await expect(put({ birthdays: [{ month: 4, day: 31 }] })).rejects.toMatchObject({ status: 400 });
	await expect(
		put({
			birthdays: [
				{ month: 5, day: 5 },
				{ month: 5, day: 5 }
			]
		})
	).rejects.toMatchObject({ status: 400 });
	await expect(
		put({
			birthdays: Array.from({ length: 25 }, (_, i) => ({
				month: 1 + (i % 12),
				day: 1 + (i % 2) * 14 + Math.floor(i / 12)
			}))
		})
	).rejects.toMatchObject({ status: 400 });
	await expect(put({})).rejects.toMatchObject({ status: 400 });
	expect((await (await get()).json()).birthdays).toHaveLength(2);
});

it('needs an adult to read or write', async () => {
	await expect(put({ birthdays: [] }, false)).rejects.toMatchObject({ status: 401 });
	await expect(Promise.resolve().then(() => get(false))).rejects.toMatchObject({ status: 401 });
	expect((await (await get()).json()).birthdays).toHaveLength(2);
});

it('clears with an empty list', async () => {
	expect(await (await put({ birthdays: [] })).json()).toEqual({ birthdays: [] });
});
