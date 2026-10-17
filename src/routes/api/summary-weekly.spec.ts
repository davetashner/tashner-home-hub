import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'hub-summary-api-'));

const api = await import('./summary/weekly/+server.js');

const call = (query: string, locals: unknown) =>
	(api.GET as unknown as (e: unknown) => Response)({
		locals,
		url: new URL(`http://example.com/api/summary/weekly${query}`)
	});

describe('weekly summary API', () => {
	it('is adults only and validates the week', async () => {
		expect(() => call('', { adult: null })).toThrow();
		const adult = { adult: { id: 'a', name: 'A' } };
		const ok = call('', adult);
		expect(ok.status).toBe(200);
		expect(await ok.json()).toMatchObject({ children: [], partial: false });
		expect(() => call('?week=garbage', adult)).toThrow();
		expect(() => call('?week=9999-01-01', adult)).toThrow();
		const named = await call('?week=2026-03-04', adult).json();
		expect(named).toMatchObject({ start: '2026-03-02', end: '2026-03-08' });
	});
});
