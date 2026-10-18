import { describe, expect, it } from 'vitest';
import { showSprites, spriteStyle, spritesFor } from './season-sprites.js';
import { SEASONS } from './season.js';

describe('spritesFor', () => {
	it('shows nothing on a plain day', () => {
		expect(spritesFor(null)).toEqual([]);
	});

	it('gives Halloween pumpkins, bats and a ghost', () => {
		const ids = spritesFor('halloween').map((s) => s.id);
		expect(ids).toEqual(
			expect.arrayContaining(['jack-tall', 'jack-round', 'pumpkin', 'ghost', 'bat-1', 'bat-2'])
		);
		const bats = spritesFor('halloween').filter((s) => s.motion === 'fly');
		expect(bats.length).toBeGreaterThanOrEqual(2);
		expect(bats.every((b) => b.flap)).toBe(true);
	});

	it('keeps pumpkins small, on the bottom edge, and clear of the left nav rail', () => {
		const resting = spritesFor('halloween').filter((s) => s.motion === 'rest');
		expect(resting.length).toBeGreaterThanOrEqual(2);
		for (const s of resting) {
			expect(s.y.edge).toBe('bottom');
			expect(s.x.edge).toBe('right');
			expect(s.size).toBeLessThanOrEqual(12);
		}
	});

	it('serves every image from the static seasons folder with unique ids', () => {
		for (const season of SEASONS) {
			const list = spritesFor(season);
			expect(new Set(list.map((s) => s.id)).size).toBe(list.length);
			for (const s of list) {
				expect(s.src).toMatch(/^\/seasons\/[a-z0-9]+\/[a-z0-9-]+\.webp$/);
				expect(s.period).toBeGreaterThan(0);
			}
		}
	});

	it('has no sprites yet for seasons whose art is still to come', () => {
		expect(spritesFor('autumn')).toEqual([]);
	});
});

describe('showSprites', () => {
	const base = {
		choice: 'auto' as const,
		season: 'halloween' as const,
		covered: false,
		deviceOff: false
	};

	it('shows on a holiday under Auto', () => {
		expect(showSprites(base)).toBe(true);
	});

	it('hides for a picked palette, the photo frame, this device off, or no sprites', () => {
		expect(showSprites({ ...base, choice: 'seafoam' })).toBe(false);
		expect(showSprites({ ...base, covered: true })).toBe(false);
		expect(showSprites({ ...base, deviceOff: true })).toBe(false);
		expect(showSprites({ ...base, season: null })).toBe(false);
		expect(showSprites({ ...base, season: 'autumn' })).toBe(false);
	});
});

describe('spriteStyle', () => {
	it('anchors to the sprite edges and passes its timing', () => {
		const [s] = spritesFor('halloween');
		const style = spriteStyle(s!);
		expect(style).toContain(`${s!.x.edge}: ${s!.x.vmin}vmin`);
		expect(style).toContain(`${s!.y.edge}: ${s!.y.pct}%`);
		expect(style).toContain(`height: ${s!.size}vmin`);
		expect(style).toContain(`--period: ${s!.period}s`);
		expect(style).toContain(`--delay: ${s!.delay}s`);
	});
});
