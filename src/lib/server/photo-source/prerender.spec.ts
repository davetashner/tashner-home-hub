import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../db/index.js';
import { enqueuePrerender, prerenderIdle } from './prerender.js';

const unhandled = vi.fn();
process.on('unhandledRejection', unhandled);
afterEach(() => {
	unhandled.mockClear();
	vi.restoreAllMocks();
});

describe('enqueuePrerender', () => {
	it('swallows and logs an unexpected failure instead of leaving a rejected promise', async () => {
		const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const broken = {
			select: () => {
				throw new Error('db closed');
			}
		} as unknown as Db;
		enqueuePrerender(broken, ['a', 'b']);
		await expect(prerenderIdle()).resolves.toBeUndefined();
		await new Promise((r) => setImmediate(r));
		expect(unhandled).not.toHaveBeenCalled();
		expect(log).toHaveBeenCalledWith('[prerender] failed:', 'db closed');
	});
});
