import { describe, expect, it, vi } from 'vitest';
import { requestLock } from './lock';

describe('requestLock', () => {
	it('POSTs logout with a JSON body and reports success', async () => {
		const fetchFn = vi.fn().mockResolvedValue({ ok: true });
		expect(await requestLock(fetchFn as unknown as typeof fetch)).toBe(true);
		const [url, init] = fetchFn.mock.calls[0]!;
		expect(url).toBe('/api/auth/logout');
		expect(init.method).toBe('POST');
		expect(init.headers['content-type']).toBe('application/json');
		expect(init.body).toBe('{}');
	});
	it('reports failure on a bad status or a network error', async () => {
		expect(await requestLock((async () => ({ ok: false })) as unknown as typeof fetch)).toBe(false);
		expect(
			await requestLock((async () => {
				throw new Error('offline');
			}) as unknown as typeof fetch)
		).toBe(false);
	});
});
