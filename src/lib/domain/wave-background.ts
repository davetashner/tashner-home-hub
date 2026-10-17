/**
 * Live wave background (hub-gj6.17): which palette to draw, the shader's numbers, the frame gate and
 * the colour parse. Pure: the component and the WebGL renderer only wire these to the screen.
 */
export const WAVE_SETTING_KEY = 'wave.background';
export const WAVE_CHOICES = ['auto', 'dusk', 'seafoam', 'sorbet', 'night', 'off'] as const;
export type WaveChoice = (typeof WAVE_CHOICES)[number];
export type WavePalette = 'dusk' | 'seafoam' | 'sorbet' | 'night';
export type Rgb = [number, number, number];

export const WAVE_LABELS: Record<WaveChoice, string> = {
	auto: 'Auto',
	dusk: 'Dusk',
	seafoam: 'Seafoam',
	sorbet: 'Sorbet',
	night: 'Night',
	off: 'Off'
};

export function isWaveChoice(v: unknown): v is WaveChoice {
	return typeof v === 'string' && (WAVE_CHOICES as readonly string[]).includes(v);
}

/** Anything unknown is "auto", so a corrupt setting never blanks the background. */
export function parseWaveChoice(v: unknown): WaveChoice {
	return isWaveChoice(v) ? v : 'auto';
}

/** Validates a PUT body; returns the choice or an error message. */
export function parseWavePatch(body: Record<string, unknown>): { choice: WaveChoice } | string {
	return isWaveChoice(body.choice)
		? { choice: body.choice }
		: `choice must be one of ${WAVE_CHOICES.join(', ')}`;
}

export interface GeoPoint {
	lat: number;
	lon: number;
}

/** The household location (`weather.location`): { lat, lon }, or null when unset or out of range. */
export function parseLocation(v: unknown): GeoPoint | null {
	if (!v || typeof v !== 'object') return null;
	const { lat, lon } = v as Record<string, unknown>;
	if (typeof lat !== 'number' || typeof lon !== 'number') return null;
	if (!(Math.abs(lat) <= 90) || !(Math.abs(lon) <= 180)) return null;
	return { lat, lon };
}

export interface SunTimes {
	/** UTC ms; null when the sun does not rise or set that day. */
	sunrise: number | null;
	sunset: number | null;
	polar: 'day' | 'night' | null;
}

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** Sunrise and sunset for a calendar date at a place (NOAA solar-position algorithm, good to about a minute). Pure maths: never touches the network. */
export function sunTimes(p: GeoPoint, year: number, month: number, day: number): SunTimes {
	const midnight = Date.UTC(year, month - 1, day);
	// Julian century at local solar noon.
	const jd = midnight / 86400000 + 2440587.5 + 0.5 - p.lon / 360;
	const t = (jd - 2451545) / 36525;
	const l0 = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
	const m = rad(357.52911 + t * (35999.05029 - 0.0001537 * t));
	const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
	const c =
		Math.sin(m) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
		Math.sin(2 * m) * (0.019993 - 0.000101 * t) +
		Math.sin(3 * m) * 0.000289;
	const omega = rad(125.04 - 1934.136 * t);
	const lambda = rad(l0 + c - 0.00569 - 0.00478 * Math.sin(omega));
	const eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
	const eps = rad(eps0 + 0.00256 * Math.cos(omega));
	const decl = Math.asin(Math.sin(eps) * Math.sin(lambda));
	const y = Math.tan(eps / 2) ** 2;
	const l0r = rad(l0);
	const eqTime =
		4 *
		deg(
			y * Math.sin(2 * l0r) -
				2 * e * Math.sin(m) +
				4 * e * y * Math.sin(m) * Math.cos(2 * l0r) -
				0.5 * y * y * Math.sin(4 * l0r) -
				1.25 * e * e * Math.sin(2 * m)
		);
	const lat = rad(p.lat);
	const cosHa =
		Math.cos(rad(90.833)) / (Math.cos(lat) * Math.cos(decl)) - Math.tan(lat) * Math.tan(decl);
	if (cosHa > 1) return { sunrise: null, sunset: null, polar: 'night' };
	if (cosHa < -1) return { sunrise: null, sunset: null, polar: 'day' };
	const ha = deg(Math.acos(cosHa));
	const noon = 720 - 4 * p.lon - eqTime;
	return {
		sunrise: midnight + (noon - 4 * ha) * 60000,
		sunset: midnight + (noon + 4 * ha) * 60000,
		polar: null
	};
}

/** Sorbet shows from this long before sunset to this long after it. */
export const SUNSET_WINDOW_MS = 45 * 60000;

/** The calendar date `ms` falls on in an IANA zone; throws on an unknown zone. */
function zonedDate(ms: number, timeZone: string | undefined): [number, number, number] {
	const parts = new Intl.DateTimeFormat('en-CA', {
		timeZone,
		year: 'numeric',
		month: 'numeric',
		day: 'numeric'
	}).formatToParts(new Date(ms));
	const get = (type: string) => Number(parts.find((x) => x.type === type)?.value);
	return [get('year'), get('month'), get('day')];
}

/**
 * What Auto draws (hub-gj6.19). Text colours follow the app theme, so the palette must match the
 * theme's lightness: a dark palette under the day theme puts dark text on dark waves, a light one
 * under the night theme puts light text on light waves. So:
 * - Night theme: always Night.
 * - Day theme: Dusk, then Sorbet from 45 min before sunset to 45 min after it, then Dusk again.
 *   Never Night.
 * Polar day (no sunset) and polar night (no window) stay Dusk. With no location, or a zone the
 * runtime does not know, Auto is Dusk by day: the theme-only behaviour.
 */
export function autoPalette(
	theme: 'light' | 'night',
	now: number,
	loc: GeoPoint | null,
	timeZone?: string
): WavePalette {
	if (theme === 'night') return 'night';
	if (!loc) return 'dusk';
	let sun: SunTimes;
	try {
		sun = sunTimes(loc, ...zonedDate(now, timeZone));
	} catch {
		return 'dusk';
	}
	if (sun.sunset === null) return 'dusk';
	const from = sun.sunset - SUNSET_WINDOW_MS;
	return now >= from && now < sun.sunset + SUNSET_WINDOW_MS ? 'sorbet' : 'dusk';
}

/**
 * The palette to draw, or null for none. `auto` is what Auto wants right now (see autoPalette).
 * The night theme always gets Night and the day theme never does (see autoPalette for why).
 */
export function resolvePalette(
	choice: WaveChoice,
	theme: 'light' | 'night',
	auto: WavePalette = theme === 'night' ? 'night' : 'dusk'
): WavePalette | null {
	if (choice === 'off') return null;
	if (theme === 'night') return 'night';
	const wanted = choice === 'auto' ? auto : choice;
	return wanted === 'night' ? 'dusk' : wanted;
}

export const PALETTE_SLOTS = [
	'bg-0',
	'bg-1',
	'bg-2',
	'bloom',
	'sheet-a',
	'sheet-b',
	'line',
	'dot'
] as const;
export type PaletteSlot = (typeof PALETTE_SLOTS)[number];

/** The layout.css custom property holding one colour of a palette. */
export const tokenName = (palette: WavePalette, slot: PaletteSlot) =>
	`--color-wave-${palette}-${slot}`;

export interface PaletteLook {
	sheetAlpha: number;
	lineAlpha: number;
	dotAlpha: number;
	vignette: number;
}

export const PALETTE_LOOK: Record<WavePalette, PaletteLook> = {
	dusk: { sheetAlpha: 0.34, lineAlpha: 0.55, dotAlpha: 0.9, vignette: 0.18 },
	seafoam: { sheetAlpha: 0.32, lineAlpha: 0.55, dotAlpha: 0.9, vignette: 0.16 },
	sorbet: { sheetAlpha: 0.32, lineAlpha: 0.5, dotAlpha: 0.9, vignette: 0.16 },
	night: { sheetAlpha: 0.16, lineAlpha: 0.35, dotAlpha: 0.75, vignette: 0.35 }
};

/** Chosen defaults: speed 1.15x, wave height 150%, density 105, dot size 0.4x. */
export const WAVE_SPEED = 1.15;
export const WAVE_START_TIME = 37;
const DENSITY = 105;

export const waveShape = {
	amp: 0.075 * 1.5,
	cols: DENSITY,
	rows: Math.max(4, Math.round(DENSITY * 0.1)),
	dot: 0.0016 * 0.4 * Math.sqrt(120 / DENSITY)
};

const SOFTWARE_GL =
	/swiftshader|llvmpipe|softpipe|software|microsoft basic render|mesa offscreen|\bgdi generic\b/i;

/**
 * True only for a renderer POSITIVELY named as CPU-based (SwiftShader, llvmpipe...). iOS WebKit and
 * Brave hide or farble GPU names ("Apple GPU", "WebKit WebGL", empty): those are not software, so
 * the wave draws and the slow-draw bail-out (`isStarved`) is the safety net.
 */
export const isSoftwareRenderer = (...names: (string | null | undefined)[]) =>
	names.some((n) => typeof n === 'string' && SOFTWARE_GL.test(n));

/** After 20 draws, an average above 100 ms each (under 10 fps) means this device can't keep up. */
export const isStarved = (elapsedMs: number, draws: number) =>
	draws >= 20 && elapsedMs / draws > 100;

export const WAVE_FPS = 30;
export const MAX_CANVAS_WIDTH = 3840;
/** The wall at 4K gets a smaller canvas: the Pi 5 fills fewer pixels, the look stays the same. */
export const renderScale = (wall: boolean) => (wall ? 0.5 : 0.6);

export interface WaveProfile {
	scale: number;
	/** Highest device pixel ratio counted when sizing the canvas. */
	dprCap: number;
	fps: number;
	/** Only the wall pauses for its display power state; the power poller runs nowhere else. */
	followsWallPower: boolean;
}

/** Wall: the 4K Pi. Phones and tablets: a smaller canvas and a battery-friendly 30 fps. */
export const waveProfile = (wall: boolean): WaveProfile =>
	wall
		? { scale: renderScale(true), dprCap: 2, fps: WAVE_FPS, followsWallPower: true }
		: { scale: 0.5, dprCap: 1.5, fps: WAVE_FPS, followsWallPower: false };

/** Whether the loop should hold still: hidden tab, reduced motion, or (wall only) screen asleep. */
export const waveHeld = (
	profile: WaveProfile,
	s: { hidden: boolean; reduced: boolean; powerOff: boolean; nightMode: boolean }
) => s.hidden || s.reduced || (profile.followsWallPower && (s.powerOff || s.nightMode));

export const DEVICE_WAVE_KEY = 'hub.wave.device';

/** Per-device opt-out ("off" hides the live waves on this device only). Storage may throw. */
export function readDeviceWaveOff(storage: Pick<Storage, 'getItem'> | undefined): boolean {
	try {
		return storage?.getItem(DEVICE_WAVE_KEY) === 'off';
	} catch {
		return false;
	}
}

export function writeDeviceWaveOff(
	storage: Pick<Storage, 'setItem' | 'removeItem'> | undefined,
	off: boolean
): void {
	try {
		if (off) storage?.setItem(DEVICE_WAVE_KEY, 'off');
		else storage?.removeItem(DEVICE_WAVE_KEY);
	} catch {
		/* private mode or blocked storage: the choice just lasts this page view */
	}
}

/** Canvas pixel size for a window: device pixel ratio up to 2, times the scale, capped at 3840 wide. */
export function canvasSize(
	width: number,
	height: number,
	dpr: number,
	scale: number,
	dprCap = 2
): { width: number; height: number } {
	const d = Math.min(dpr || 1, dprCap);
	let w = Math.round(width * d * scale);
	let h = Math.round(height * d * scale);
	const cap = MAX_CANVAS_WIDTH / Math.max(w, 1);
	if (cap < 1) {
		w = Math.round(w * cap);
		h = Math.round(h * cap);
	}
	return { width: Math.max(w, 2), height: Math.max(h, 2) };
}

/** Frame-rate gate: true when enough time has passed since the last draw (2 ms slack for vsync jitter). */
export const dueForFrame = (now: number, lastDraw: number, fps = WAVE_FPS) =>
	now - lastDraw >= 1000 / fps - 2;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const toSrgb = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function oklchToRgb(l: number, c: number, hDeg: number): Rgb {
	const h = (hDeg * Math.PI) / 180;
	const a = c * Math.cos(h);
	const b = c * Math.sin(h);
	const lp = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
	const mp = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
	const sp = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
	return [
		clamp01(toSrgb(4.0767416621 * lp - 3.3077115913 * mp + 0.2309699292 * sp)),
		clamp01(toSrgb(-1.2684380046 * lp + 2.6097574011 * mp - 0.3413193965 * sp)),
		clamp01(toSrgb(-0.0041960863 * lp - 0.7034186147 * mp + 1.707614701 * sp))
	];
}

/** Parses hex or oklch colour text into 0..1 sRGB; null if unreadable. */
export function parseColor(input: string): Rgb | null {
	const s = input.trim().toLowerCase();
	const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(s);
	if (hex) {
		const h = hex[1].length === 3 ? [...hex[1]].map((x) => x + x).join('') : hex[1];
		return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as Rgb;
	}
	const ok = /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)/.exec(s);
	if (!ok) return null;
	return oklchToRgb(Number(ok[1]) / (ok[2] ? 100 : 1), Number(ok[3]), Number(ok[4]));
}

export interface PaletteValues {
	colors: Rgb[];
	look: PaletteLook;
}

/** A sunset-driven palette change fades over a minute; a picked one over a moment. */
export const SUN_FADE_MS = 60_000;
export const PICK_FADE_MS = 1_500;

/** Blend two palettes: `k` 0 is `a`, 1 is `b`. */
export function mixPalette(a: PaletteValues, b: PaletteValues, k: number): PaletteValues {
	const f = clamp01(k);
	const mix = (x: number, y: number) => x + (y - x) * f;
	return {
		colors: a.colors.map((c, i) => c.map((v, j) => mix(v, b.colors[i][j])) as Rgb),
		look: {
			sheetAlpha: mix(a.look.sheetAlpha, b.look.sheetAlpha),
			lineAlpha: mix(a.look.lineAlpha, b.look.lineAlpha),
			dotAlpha: mix(a.look.dotAlpha, b.look.dotAlpha),
			vignette: mix(a.look.vignette, b.look.vignette)
		}
	};
}

/** 0..1 progress of a fade; an instant fade (0 ms) is already done. */
export const fadeProgress = (now: number, start: number, ms: number) =>
	ms <= 0 ? 1 : clamp01((now - start) / ms);
