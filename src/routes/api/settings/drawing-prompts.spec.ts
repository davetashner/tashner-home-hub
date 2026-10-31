import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'hub-drawing-prompts-api-'));

const api = await import('./drawing-prompts/+server.js');

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

it('is on by default, readable by anyone, and changed only by an adult', async () => {
	const first = await call(api.GET, false);
	expect(first.enabled).toBe(true);
	expect(first.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	await expect(call(api.PUT, false, { enabled: false })).rejects.toMatchObject({ status: 401 });
	await expect(call(api.PUT, true, { enabled: 'x' })).rejects.toMatchObject({ status: 400 });
	expect(await call(api.PUT, true, { enabled: false })).toEqual({ enabled: false });
	expect((await call(api.GET, false)).enabled).toBe(false);
	expect(await call(api.PUT, true, { enabled: true })).toEqual({ enabled: true });
});
