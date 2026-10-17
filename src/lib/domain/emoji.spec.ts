import { describe, expect, it } from 'vitest';
import { REWARD_EMOJI, cleanEmoji, isSingleEmoji } from './emoji.js';

describe('isSingleEmoji', () => {
	it('accepts one emoji, including sequences, flags and keycaps', () => {
		for (const e of ['🍦', '🛍️', '👨‍👩‍👧', '🇨🇦', '1️⃣', '👍🏽']) expect(isSingleEmoji(e)).toBe(true);
	});
	it('rejects words, several emoji, blanks and non-strings', () => {
		for (const v of ['Book', '🍦🍦', '', ' ', 'a🍦', 'A', '1', 5, null, undefined])
			expect(isSingleEmoji(v)).toBe(false);
	});
});

describe('cleanEmoji', () => {
	it('trims, maps blank to null, and flags bad input with undefined', () => {
		expect(cleanEmoji(' 🍦 ')).toBe('🍦');
		expect(cleanEmoji('  ')).toBeNull();
		expect(cleanEmoji('Book')).toBeUndefined();
	});
});

describe('REWARD_EMOJI', () => {
	it('is all valid, unique single emoji with labels', () => {
		expect(new Set(REWARD_EMOJI.map((c) => c.emoji)).size).toBe(REWARD_EMOJI.length);
		for (const c of REWARD_EMOJI) {
			expect(isSingleEmoji(c.emoji)).toBe(true);
			expect(c.label.length).toBeGreaterThan(0);
		}
	});
});
