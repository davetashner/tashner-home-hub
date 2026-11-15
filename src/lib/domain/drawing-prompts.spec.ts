import { describe, expect, it } from 'vitest';
import {
	DRAWING_PROMPTS,
	parsePromptsEnabled,
	nextPromptMemory,
	parsePromptMemory,
	parsePromptsPatch,
	pickPrompt
} from './drawing-prompts.js';

describe('drawing prompts', () => {
	it('has at least 130 distinct prompts', () => {
		expect(DRAWING_PROMPTS.length).toBeGreaterThanOrEqual(130);
		expect(new Set(DRAWING_PROMPTS).size).toBe(DRAWING_PROMPTS.length);
	});

	it("keeps the day's prompt until the date changes", () => {
		const day = nextPromptMemory(null, '2026-10-31');
		expect(DRAWING_PROMPTS).toContain(day.prompt);
		expect(day.recent).toEqual([day.prompt]);
		expect(nextPromptMemory(day, '2026-10-31')).toBe(day);
		const next = nextPromptMemory(day, '2026-11-01');
		expect(next.date).toBe('2026-11-01');
		expect(next.prompt).not.toBe(day.prompt);
	});

	it('shuffle picks a new prompt the same day', () => {
		const day = nextPromptMemory(null, '2026-10-31');
		const shuffled = nextPromptMemory(day, '2026-10-31', true);
		expect(shuffled.prompt).not.toBe(day.prompt);
		expect(shuffled.recent).toEqual([day.prompt, shuffled.prompt]);
	});

	it('does not repeat until three quarters of the list has been seen', () => {
		const n = DRAWING_PROMPTS.length;
		const keep = Math.floor(n * 0.75);
		let seed = 7;
		const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
		let m = nextPromptMemory(null, 'd', false, rand);
		const shown = [m.prompt];
		for (let i = 0; i < n * 3; i++) {
			m = nextPromptMemory(m, 'd', true, rand);
			expect(shown.slice(-keep)).not.toContain(m.prompt);
			shown.push(m.prompt);
			expect(m.recent.length).toBeLessThanOrEqual(keep);
		}
		expect(new Set(shown).size).toBe(n);
	});

	it('picks from the whole pool, edge values included', () => {
		expect(pickPrompt([], () => 0)).toBe(DRAWING_PROMPTS[0]);
		expect(pickPrompt([], () => 0.9999999)).toBe(DRAWING_PROMPTS.at(-1));
		expect(pickPrompt([], () => 1)).toBe(DRAWING_PROMPTS.at(-1));
		expect(pickPrompt([DRAWING_PROMPTS[0]], () => 0)).toBe(DRAWING_PROMPTS[1]);
	});

	it('reads stored memory defensively', () => {
		const good = { date: '2026-10-31', prompt: DRAWING_PROMPTS[3], recent: [DRAWING_PROMPTS[3]] };
		expect(parsePromptMemory(good)).toEqual(good);
		expect(
			parsePromptMemory({ ...good, recent: [DRAWING_PROMPTS[1], 'Draw a gone one', 4] })
		).toEqual({ ...good, recent: [DRAWING_PROMPTS[1]] });
		expect(parsePromptMemory({ ...good, recent: 'x' })?.recent).toEqual([]);
		expect(parsePromptMemory({ ...good, prompt: 'Draw a gone one' })).toBeNull();
		expect(parsePromptMemory({ prompt: DRAWING_PROMPTS[0] })).toBeNull();
		expect(parsePromptMemory(null)).toBeNull();
	});

	it('defaults the setting to on', () => {
		expect(parsePromptsEnabled(undefined)).toBe(true);
		expect(parsePromptsEnabled('junk')).toBe(true);
		expect(parsePromptsEnabled(false)).toBe(false);
	});

	it('validates the patch', () => {
		expect(parsePromptsPatch({ enabled: false })).toBe(false);
		expect(parsePromptsPatch({ enabled: true })).toBe(true);
		expect(typeof parsePromptsPatch({ enabled: 'no' })).toBe('string');
		expect(typeof parsePromptsPatch(null)).toBe('string');
	});
});
