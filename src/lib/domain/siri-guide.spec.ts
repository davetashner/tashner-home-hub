import { describe, expect, it } from 'vitest';
import { authHeader, buildGuide, TOKEN_PLACEHOLDER } from './siri-guide.js';

describe('siri guide', () => {
	it('builds full URLs from the origin and the token header', () => {
		const g = buildGuide('https://hub.example', 'abc');
		expect(g.map((s) => s.name)).toEqual([
			'Add to the hub list',
			'New Star Job',
			'Send to the hub'
		]);
		const copies = g.flatMap((s) => s.steps.flatMap((x) => x.copy ?? []));
		expect(copies.map((c) => c.value)).toContain('https://hub.example/api/siri/lists');
		expect(copies.map((c) => c.value)).toContain('https://hub.example/api/siri/list-item');
		expect(copies.map((c) => c.value)).toContain('https://hub.example/api/siri/star-job');
		expect(copies.map((c) => c.value)).toContain('https://hub.example/api/siri/photo');
		expect(copies.map((c) => c.value)).toContain('Bearer abc');
	});
	it('uses a placeholder when the token is gone', () => {
		expect(authHeader(null)).toBe(`Bearer ${TOKEN_PLACEHOLDER}`);
	});
	it('ends each voice shortcut by speaking the reply, and the photo one with a notification', () => {
		const g = buildGuide('http://x', null);
		for (const s of g.filter((x) => x.id !== 'photo'))
			expect(s.steps.at(-1)?.action).toBe('Speak Text');
		expect(g.find((x) => x.id === 'photo')?.steps.at(-1)?.action).toBe('Show Notification');
	});
});
