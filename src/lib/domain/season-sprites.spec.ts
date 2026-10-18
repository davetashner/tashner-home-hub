import { describe, expect, it } from 'vitest';
import { showSprites, snowsOn, spriteStyle, spritesFor } from './season-sprites.js';
import { NO_SEASON, REINDEER, SEASONS, type Season } from './season.js';

const on = (season: Season | null, more: { reindeer?: number; christmasEve?: boolean } = {}) => ({
	...NO_SEASON,
	season,
	...more
});

describe('spritesFor', () => {
	it('shows nothing on a plain day', () => {
		expect(spritesFor(on(null))).toEqual([]);
	});

	it('gives Halloween pumpkins, bats and a ghost', () => {
		const ids = spritesFor(on('halloween')).map((s) => s.id);
		expect(ids).toEqual(
			expect.arrayContaining(['jack-tall', 'jack-round', 'pumpkin', 'ghost', 'bat-1', 'bat-2'])
		);
		const bats = spritesFor(on('halloween')).filter((s) => s.motion === 'fly');
		expect(bats.length).toBeGreaterThanOrEqual(2);
		expect(bats.every((b) => b.flap)).toBe(true);
	});

	it('keeps pumpkins small, on the bottom edge, and clear of the left nav rail', () => {
		const resting = spritesFor(on('halloween')).filter((s) => s.motion === 'rest');
		expect(resting.length).toBeGreaterThanOrEqual(2);
		for (const s of resting) {
			expect(s.y.edge).toBe('bottom');
			expect(s.x.edge).toBe('right');
			expect(s.size).toBeLessThanOrEqual(12);
		}
	});

	it('serves every image from the static seasons folder with unique ids', () => {
		for (const season of SEASONS) {
			const list = spritesFor(on(season));
			expect(new Set(list.map((s) => s.id)).size).toBe(list.length);
			for (const s of list) {
				expect(s.src).toMatch(/^\/seasons\/[a-z0-9]+\/[a-z0-9-]+\.webp$/);
				expect(s.period).toBeGreaterThan(0);
			}
		}
	});

	it('adds one reindeer a day to the herd, Rudolph last, all clear of the nav rail', () => {
		expect(spritesFor(on('christmas'))).toEqual([]);
		for (let n = 1; n <= REINDEER.length; n++) {
			const herd = spritesFor(on('christmas', { reindeer: n }));
			expect(herd).toHaveLength(n);
			for (const s of herd) {
				expect(s.motion).toBe('rest');
				expect(s.x.edge).toBe('right');
				expect(s.y.edge).toBe('bottom');
			}
		}
		const all = spritesFor(on('christmas', { reindeer: REINDEER.length }));
		expect(all.at(-1)!.id).toBe('reindeer-rudolph');
		expect(all.at(-1)!.src).toContain('rudolph-');
		expect(all.filter((s) => s.src.includes('rudolph-'))).toHaveLength(1);
		// Each newcomer stands further left than the one before.
		const xs = all.map((s) => s.x.vmin);
		expect(xs).toEqual([...xs].sort((a, b) => a - b));
	});

	it('flies Santa and the whole team across together on Christmas Eve, with pines and snow', () => {
		const eve = on('christmas', { reindeer: REINDEER.length, christmasEve: true });
		const team = spritesFor(eve).filter((s) => s.motion === 'team');
		expect(team).toHaveLength(REINDEER.length + 1);
		expect(new Set(team.map((s) => `${s.period}/${s.delay}`)).size).toBe(1);
		const sleigh = team.find((s) => s.id === 'sleigh')!;
		// The sleigh trails behind every reindeer, and Rudolph leads.
		expect(Math.min(...team.map((s) => s.x.vmin))).toBe(sleigh.x.vmin);
		const leader = team.reduce((a, b) => (b.x.vmin > a.x.vmin ? b : a));
		expect(leader.id).toBe('team-rudolph');
		expect(spritesFor(eve).filter((s) => s.id.startsWith('pine-')).length).toBeGreaterThanOrEqual(
			2
		);
		expect(snowsOn(eve)).toBe(true);
		expect(snowsOn(on('christmas', { reindeer: 8 }))).toBe(false);
	});

	it('sets Christmas Day by the tree and a flickering fire', () => {
		const ids = spritesFor(on('christmasday')).map((s) => s.id);
		expect(ids).toEqual(expect.arrayContaining(['tree', 'fireplace']));
		expect(spritesFor(on('christmasday')).find((s) => s.id === 'fireplace')!.flicker).toBe(true);
	});

	it("ends St Patrick's rainbow at a pot of gold, with leprechauns dancing a jig", () => {
		const list = spritesFor(on('stpatricks'));
		expect(list.map((s) => s.id)).toEqual(
			expect.arrayContaining(['rainbow', 'pot-of-gold', 'leprechaun-1', 'leprechaun-2'])
		);
		const dancers = list.filter((s) => s.id.startsWith('leprechaun-'));
		expect(dancers.every((d) => d.flap)).toBe(true);
		// The pot is drawn after (over) the rainbow's foot.
		expect(list.findIndex((s) => s.id === 'pot-of-gold')).toBeGreaterThan(
			list.findIndex((s) => s.id === 'rainbow')
		);
	});

	it('has no sprites yet for seasons whose art is still to come', () => {
		expect(spritesFor(on('autumn'))).toEqual([]);
	});
});

describe('showSprites', () => {
	const base = {
		choice: 'auto' as const,
		season: on('halloween'),
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
		expect(showSprites({ ...base, season: on(null) })).toBe(false);
		expect(showSprites({ ...base, season: on('autumn') })).toBe(false);
	});
});

describe('spriteStyle', () => {
	it('anchors to the sprite edges and passes its timing', () => {
		const [s] = spritesFor(on('halloween'));
		const style = spriteStyle(s!);
		expect(style).toContain(`${s!.x.edge}: ${s!.x.vmin}vmin`);
		expect(style).toContain(`${s!.y.edge}: ${s!.y.pct}%`);
		expect(style).toContain(`height: ${s!.size}vmin`);
		expect(style).toContain(`--period: ${s!.period}s`);
		expect(style).toContain(`--delay: ${s!.delay}s`);
	});
});
