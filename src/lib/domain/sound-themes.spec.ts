import { describe, expect, it } from 'vitest';
import {
	SOUND_THEMES,
	THEME_LABELS,
	isSoundTheme,
	themeNotes,
	type SoundKind
} from './sound-themes.js';

const kinds: SoundKind[] = ['tap', 'ding', 'fanfare', 'alarm'];

describe('sound themes', () => {
	it('every theme has a label and sensible notes for every sound', () => {
		for (const theme of SOUND_THEMES) {
			expect(THEME_LABELS[theme]).toBeTruthy();
			for (const kind of kinds) {
				const notes = themeNotes(theme, kind, 3);
				expect(notes.length).toBeGreaterThan(0);
				for (const [f, o, d, p] of notes) {
					expect(f).toBeGreaterThan(100);
					expect(o).toBeGreaterThanOrEqual(0);
					expect(d).toBeGreaterThan(0);
					expect(p).toBeGreaterThan(0);
					expect(p).toBeLessThanOrEqual(0.25);
				}
			}
		}
	});
	it('the tap gains a note per star, three to five', () => {
		for (const theme of SOUND_THEMES) {
			expect(themeNotes(theme, 'tap', 0)).toHaveLength(3);
			expect(themeNotes(theme, 'tap', 2)).toHaveLength(4);
			expect(themeNotes(theme, 'tap', 99)).toHaveLength(5);
		}
	});
	it('volume scales loudness and is clamped to 0..100', () => {
		const full = themeNotes('classic', 'ding', 1, 100);
		const half = themeNotes('classic', 'ding', 1, 50);
		expect(half[0][3]).toBeCloseTo(full[0][3] / 2);
		expect(themeNotes('classic', 'ding', 1, 500)[0][3]).toBe(full[0][3]);
		expect(themeNotes('classic', 'ding', 1, -1)[0][3]).toBe(0);
	});
	it('themes sound different', () => {
		const sigs = SOUND_THEMES.map((t) => JSON.stringify(themeNotes(t, 'fanfare')));
		expect(new Set(sigs).size).toBe(SOUND_THEMES.length);
	});
	it('recognises theme ids', () => {
		expect(isSoundTheme('silly')).toBe(true);
		expect(isSoundTheme('loud')).toBe(false);
		expect(isSoundTheme(3)).toBe(false);
	});
});
