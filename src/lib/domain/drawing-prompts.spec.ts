import { describe, expect, it } from 'vitest';
import {
	DRAWING_PROMPTS,
	parsePromptsEnabled,
	parsePromptsPatch,
	promptForDate,
	promptIndex
} from './drawing-prompts.js';

describe('drawing prompts', () => {
	it('has at least 60 distinct prompts', () => {
		expect(DRAWING_PROMPTS.length).toBeGreaterThanOrEqual(60);
		expect(new Set(DRAWING_PROMPTS).size).toBe(DRAWING_PROMPTS.length);
	});

	it('picks the same prompt for the same date', () => {
		expect(promptForDate('2026-10-31')).toBe(promptForDate('2026-10-31'));
		expect(promptIndex('2026-10-31', 0)).toBe(promptIndex('2026-10-31'));
	});

	it('varies across days', () => {
		const seen = new Set<string>();
		for (let d = 1; d <= 28; d++) seen.add(promptForDate(`2026-02-${String(d).padStart(2, '0')}`));
		expect(seen.size).toBeGreaterThan(10);
	});

	it('shuffle always changes the prompt and visits every prompt eventually', () => {
		for (const date of ['2026-01-01', '2026-10-31', '2027-03-09']) {
			for (let s = 0; s < 5; s++) {
				expect(promptIndex(date, s + 1)).not.toBe(promptIndex(date, s));
			}
		}
		expect(promptIndex('2026-10-31', DRAWING_PROMPTS.length)).toBe(promptIndex('2026-10-31', 0));
	});

	it('treats bad shuffle counts as zero', () => {
		expect(promptIndex('2026-10-31', -3)).toBe(promptIndex('2026-10-31', 0));
		expect(promptIndex('2026-10-31', Number.NaN)).toBe(promptIndex('2026-10-31', 0));
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
