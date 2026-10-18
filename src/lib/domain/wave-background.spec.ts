import { describe, expect, it } from 'vitest';
import {
	autoPalette,
	canvasSize,
	dueForFrame,
	fadeProgress,
	isSoftwareRenderer,
	readDeviceWaveOff,
	waveHeld,
	waveProfile,
	writeDeviceWaveOff,
	isStarved,
	mixPalette,
	parseColor,
	parseLocation,
	type PaletteValues,
	parseWaveChoice,
	renderScale,
	resolvePalette,
	isDarkPalette,
	PALETTE_LOOK,
	seasonPalette,
	sunTimes,
	waveShape
} from './wave-background.js';
import { SEASONS } from './season.js';

describe('choice and palette', () => {
	it('parses unknown values to auto', () => {
		expect(parseWaveChoice('sorbet')).toBe('sorbet');
		expect(parseWaveChoice('nope')).toBe('auto');
		expect(parseWaveChoice(undefined)).toBe('auto');
	});
	it('matches the palette to the theme', () => {
		expect(resolvePalette('off', 'light')).toBeNull();
		expect(resolvePalette('off', 'night')).toBeNull();
		expect(resolvePalette('seafoam', 'night')).toBe('night');
		expect(resolvePalette('seafoam', 'light')).toBe('seafoam');
		expect(resolvePalette('night', 'light')).toBe('dusk');
		expect(resolvePalette('auto', 'light')).toBe('dusk');
	});
	it('lets a holiday take over Auto, in the lightness of the theme', () => {
		expect(seasonPalette('halloween', 'light')).toBe('halloween');
		expect(seasonPalette('halloween', 'night')).toBe('halloween-night');
		expect(resolvePalette('auto', 'light', seasonPalette('autumn', 'light'))).toBe('autumn');
		expect(resolvePalette('auto', 'night', seasonPalette('christmas', 'night'))).toBe(
			'christmas-night'
		);
		// A palette of the wrong lightness never shows.
		expect(resolvePalette('auto', 'night', 'christmas')).toBe('night');
		expect(resolvePalette('auto', 'light', 'stpatricks-night')).toBe('dusk');
		// A pick ignores the holiday.
		expect(resolvePalette('seafoam', 'light', 'halloween')).toBe('seafoam');
		expect(resolvePalette('seafoam', 'night', 'halloween-night')).toBe('night');
	});
	it('has a look and a dark twin for every holiday', () => {
		for (const s of SEASONS) {
			expect(isDarkPalette(s)).toBe(false);
			expect(isDarkPalette(`${s}-night`)).toBe(true);
			expect(PALETTE_LOOK[s]).toBeDefined();
			expect(PALETTE_LOOK[`${s}-night`]).toBeDefined();
		}
		expect(isDarkPalette('night')).toBe(true);
	});
});

describe('shader numbers', () => {
	it('uses the chosen defaults', () => {
		expect(waveShape.amp).toBeCloseTo(0.1125);
		expect(waveShape.cols).toBe(105);
		expect(waveShape.rows).toBe(11);
		expect(waveShape.dot).toBeCloseTo(0.0016 * 0.4 * Math.sqrt(120 / 105));
	});
	it('sizes the canvas with dpr, scale and the 3840 cap', () => {
		expect(canvasSize(1000, 500, 1, 0.6)).toEqual({ width: 600, height: 300 });
		expect(canvasSize(1000, 500, 3, 0.5)).toEqual({ width: 1000, height: 500 });
		expect(canvasSize(7000, 4000, 2, 1)).toEqual({ width: 3840, height: 2194 });
		expect(renderScale(true)).toBeLessThan(renderScale(false));
	});
	it('gates frames to 30 fps', () => {
		expect(dueForFrame(100, 80)).toBe(false);
		expect(dueForFrame(114, 80)).toBe(true);
	});
});

it('gives up when frames crawl', () => {
	expect(isStarved(1000, 10)).toBe(false);
	expect(isStarved(1000, 20)).toBe(false);
	expect(isStarved(3000, 20)).toBe(true);
});

it('spots software renderers', () => {
	expect(isSoftwareRenderer('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device))')).toBe(true);
	expect(isSoftwareRenderer('V3D 7.1')).toBe(false);
});

it('only refuses renderers positively named as software', () => {
	for (const n of [
		'llvmpipe (LLVM 15)',
		'softpipe',
		'Microsoft Basic Render Driver',
		'Mesa OffScreen'
	])
		expect(isSoftwareRenderer(n)).toBe(true);
	// Masked, farbled or unavailable names draw.
	for (const n of ['Apple GPU', 'WebKit WebGL', 'WebKit', '', 'Adreno (TM) 740'])
		expect(isSoftwareRenderer(n)).toBe(false);
	expect(isSoftwareRenderer(undefined, null)).toBe(false);
	expect(isSoftwareRenderer('Apple GPU', 'Google SwiftShader')).toBe(true);
});

describe('personal device profile', () => {
	it('is lighter than the wall and ignores wall power', () => {
		const phone = waveProfile(false);
		expect(phone.scale).toBe(0.5);
		expect(phone.fps).toBe(30);
		expect(phone.followsWallPower).toBe(false);
		expect(canvasSize(390, 844, 3, phone.scale, phone.dprCap)).toEqual({ width: 293, height: 633 });
		expect(waveProfile(true).followsWallPower).toBe(true);
	});

	it('holds still when hidden, but only the wall holds for power state', () => {
		const awake = { hidden: false, reduced: false, powerOff: false, nightMode: false };
		const asleep = { ...awake, powerOff: true, nightMode: true };
		expect(waveHeld(waveProfile(false), awake)).toBe(false);
		expect(waveHeld(waveProfile(false), asleep)).toBe(false);
		expect(waveHeld(waveProfile(true), asleep)).toBe(true);
		expect(waveHeld(waveProfile(false), { ...awake, hidden: true })).toBe(true);
		expect(waveHeld(waveProfile(false), { ...awake, reduced: true })).toBe(true);
	});
});

describe('per-device opt-out', () => {
	it('round-trips through storage and survives it throwing', () => {
		const data = new Map<string, string>();
		const store = {
			getItem: (k: string) => data.get(k) ?? null,
			setItem: (k: string, v: string) => void data.set(k, v),
			removeItem: (k: string) => void data.delete(k)
		};
		expect(readDeviceWaveOff(store)).toBe(false);
		writeDeviceWaveOff(store, true);
		expect(readDeviceWaveOff(store)).toBe(true);
		writeDeviceWaveOff(store, false);
		expect(readDeviceWaveOff(store)).toBe(false);
		const broken = {
			getItem: () => {
				throw new Error('blocked');
			},
			setItem: () => {
				throw new Error('blocked');
			},
			removeItem: () => {
				throw new Error('blocked');
			}
		};
		expect(readDeviceWaveOff(broken)).toBe(false);
		expect(() => writeDeviceWaveOff(broken, true)).not.toThrow();
		expect(readDeviceWaveOff(undefined)).toBe(false);
	});
});

describe('parseColor', () => {
	it('reads hex and oklch', () => {
		expect(parseColor('#fff')).toEqual([1, 1, 1]);
		expect(parseColor(' #000000 ')).toEqual([0, 0, 0]);
		const white = parseColor('oklch(100% 0 0)')!;
		white.forEach((v) => expect(v).toBeCloseTo(1, 2));
		const red = parseColor('oklch(62.8% 0.258 29.2)')!;
		expect(red[0]).toBeCloseTo(1, 1);
		expect(red[1]).toBeLessThan(0.1);
		expect(parseColor('oklch(0% 0 0)')).toEqual([0, 0, 0]);
	});
	it('rejects what it cannot read', () => {
		expect(parseColor('')).toBeNull();
		expect(parseColor('oklch(a b c)')).toBeNull();
	});
});

const MIN = 60_000;
const at = (iso: string) => Date.parse(iso);

describe('sunTimes', () => {
	const near = (actual: number | null, iso: string) =>
		expect(Math.abs(actual! - at(iso)) / MIN).toBeLessThanOrEqual(2);
	it('matches published times', () => {
		const nyc = sunTimes({ lat: 40.7128, lon: -74.006 }, 2024, 6, 21);
		near(nyc.sunrise, '2024-06-21T05:25:00-04:00');
		near(nyc.sunset, '2024-06-21T20:31:00-04:00');
		const london = sunTimes({ lat: 51.5074, lon: -0.1278 }, 2024, 12, 21);
		near(london.sunrise, '2024-12-21T08:04:00Z');
		near(london.sunset, '2024-12-21T15:53:00Z');
		const sydney = sunTimes({ lat: -33.8688, lon: 151.2093 }, 2024, 12, 21);
		near(sydney.sunrise, '2024-12-21T05:41:00+11:00');
		near(sydney.sunset, '2024-12-21T20:05:00+11:00');
	});
	it('matches published times on a daylight-saving change day', () => {
		const nyc = { lat: 40.7128, lon: -74.006 };
		// US spring forward, 2024-03-10: sunset 6:57 pm EDT.
		near(sunTimes(nyc, 2024, 3, 10).sunset, '2024-03-10T18:57:00-04:00');
		// US fall back, 2024-11-03: sunset 4:50 pm EST.
		near(sunTimes(nyc, 2024, 11, 3).sunset, '2024-11-03T16:50:00-05:00');
	});
	it('reports polar day and night', () => {
		const tromso = { lat: 69.6492, lon: 18.9553 };
		expect(sunTimes(tromso, 2024, 6, 21)).toEqual({ sunrise: null, sunset: null, polar: 'day' });
		expect(sunTimes(tromso, 2024, 12, 21)).toEqual({ sunrise: null, sunset: null, polar: 'night' });
	});
});

describe('parseLocation', () => {
	it('accepts coordinates and rejects the rest', () => {
		expect(parseLocation({ lat: 1, lon: 2, name: 'x' })).toEqual({ lat: 1, lon: 2 });
		expect(parseLocation(null)).toBeNull();
		expect(parseLocation('x')).toBeNull();
		expect(parseLocation({ lat: '1', lon: 2 })).toBeNull();
		expect(parseLocation({ lat: 91, lon: 0 })).toBeNull();
		expect(parseLocation({ lat: 0, lon: 181 })).toBeNull();
	});
});

describe('autoPalette', () => {
	const nyc = { lat: 40.7128, lon: -74.006 };
	const zone = 'America/New_York';
	const sunset = sunTimes(nyc, 2024, 6, 21).sunset!;
	const p = (ms: number, theme: 'light' | 'night' = 'light') => autoPalette(theme, ms, nyc, zone);
	it('is Dusk, then Sorbet from 45 min before to 45 min after sunset, then Dusk', () => {
		expect(p(at('2024-06-21T03:00:00-04:00'))).toBe('dusk');
		expect(p(at('2024-06-21T12:00:00-04:00'))).toBe('dusk');
		expect(p(sunset - 45 * MIN - MIN)).toBe('dusk');
		expect(p(sunset - 45 * MIN)).toBe('sorbet');
		expect(p(sunset)).toBe('sorbet');
		expect(p(sunset + 45 * MIN - MIN)).toBe('sorbet');
		expect(p(sunset + 45 * MIN)).toBe('dusk');
		expect(p(sunset + 45 * MIN + MIN)).toBe('dusk');
		expect(p(at('2024-06-21T23:30:00-04:00'))).toBe('dusk');
	});
	it('never picks Night in the day theme and always does in the night theme', () => {
		for (let h = 0; h < 24; h++) {
			const ms = at('2024-06-21T00:00:00-04:00') + h * 60 * MIN;
			expect(p(ms)).not.toBe('night');
			expect(p(ms, 'night')).toBe('night');
		}
	});
	it('uses the zone for the date and works on a DST day', () => {
		const s = sunTimes(nyc, 2024, 3, 10).sunset!;
		expect(p(s - 50 * MIN)).toBe('dusk');
		expect(p(s - 40 * MIN)).toBe('sorbet');
	});
	it('stays Dusk through polar day, and has no window in polar night', () => {
		const tromso = { lat: 69.6492, lon: 18.9553 };
		expect(autoPalette('light', at('2024-06-21T22:00:00Z'), tromso, 'Europe/Oslo')).toBe('dusk');
		expect(autoPalette('light', at('2024-12-21T12:00:00Z'), tromso, 'Europe/Oslo')).toBe('dusk');
		expect(autoPalette('night', at('2024-12-21T12:00:00Z'), tromso, 'Europe/Oslo')).toBe('night');
	});
	it('follows the theme alone without a location, or with an unknown zone', () => {
		expect(autoPalette('light', 0, null, zone)).toBe('dusk');
		expect(autoPalette('night', 0, null, zone)).toBe('night');
		expect(autoPalette('light', 0, nyc, 'Not/AZone')).toBe('dusk');
		expect(autoPalette('light', sunset, nyc, undefined)).toMatch(/dusk|sorbet/);
	});
	it('feeds resolvePalette: Auto takes the sun, a pick ignores it', () => {
		expect(resolvePalette('auto', 'light', 'sorbet')).toBe('sorbet');
		expect(resolvePalette('auto', 'night', 'sorbet')).toBe('night');
		expect(resolvePalette('auto', 'light', 'night')).toBe('dusk');
		expect(resolvePalette('seafoam', 'light', 'sorbet')).toBe('seafoam');
		expect(resolvePalette('auto', 'night')).toBe('night');
	});
});

describe('palette fade', () => {
	const mk = (v: number, a: number): PaletteValues => ({
		colors: [[v, v, v]],
		look: { sheetAlpha: a, lineAlpha: a, dotAlpha: a, vignette: a }
	});
	it('blends and clamps', () => {
		const m = mixPalette(mk(0, 0), mk(1, 1), 0.5);
		expect(m.colors[0]).toEqual([0.5, 0.5, 0.5]);
		expect(m.look.vignette).toBe(0.5);
		expect(mixPalette(mk(0, 0), mk(1, 1), 3).colors[0][0]).toBe(1);
	});
	it('measures progress', () => {
		expect(fadeProgress(30000, 0, 60000)).toBe(0.5);
		expect(fadeProgress(90000, 0, 60000)).toBe(1);
		expect(fadeProgress(5, 0, 0)).toBe(1);
	});
});
