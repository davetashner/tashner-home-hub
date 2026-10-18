import { describe, expect, it } from 'vitest';
import { authHeader, buildGuide, TOKEN_PLACEHOLDER } from './siri-guide.js';

describe('siri guide', () => {
	it('builds full URLs from the origin and the token header', () => {
		const g = buildGuide('https://hub.example', 'abc');
		expect(g.map((s) => s.name)).toEqual(['Add to the hub list', 'New Star Job']);
		const copies = g.flatMap((s) => s.steps.flatMap((x) => x.copy ?? []));
		expect(copies.map((c) => c.value)).toContain('https://hub.example/api/siri/lists');
		expect(copies.map((c) => c.value)).toContain('https://hub.example/api/siri/list-item');
		expect(copies.map((c) => c.value)).toContain('https://hub.example/api/siri/star-job');
		expect(copies.map((c) => c.value)).toContain('Bearer abc');
	});
	it('uses a placeholder when the token is gone', () => {
		expect(authHeader(null)).toBe(`Bearer ${TOKEN_PLACEHOLDER}`);
	});
	it('ends each shortcut by speaking the reply', () => {
		for (const s of buildGuide('http://x', null)) expect(s.steps.at(-1)?.action).toBe('Speak Text');
	});
});
