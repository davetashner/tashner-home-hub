import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './api.js';

afterEach(() => vi.unstubAllGlobals());

describe('calendar-settings api', () => {
	it('maps a network error to the unreachable message', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
		const r = await api('/x');
		expect(r.ok).toBe(false);
		expect(r.message).toBe("Couldn't reach the hub. Try again in a moment.");
	});

	it('maps an empty 502 to the unreachable message', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 502 })));
		expect((await api('/x')).message).toBe("Couldn't reach the hub. Try again in a moment.");
	});

	it('keeps the server message on a 400 and returns data on success', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValueOnce(Response.json({ message: 'Bad name' }, { status: 400 }))
		);
		expect((await api('/x', 'POST', {})).message).toBe('Bad name');
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ a: 1 })));
		expect((await api('/x')).data).toEqual({ a: 1 });
	});
});
