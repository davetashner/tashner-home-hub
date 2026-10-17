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

/**
 * The palette to draw, or null for none. Auto is Dusk by day and Night under the night theme. Text colours come from the day or night theme, so the background has to match its lightness:
 * the night theme always gets Night, and the day theme never gets the dark one.
 */
export function resolvePalette(choice: WaveChoice, theme: 'light' | 'night'): WavePalette | null {
	if (choice === 'off') return null;
	if (theme === 'night') return 'night';
	const wanted = choice === 'auto' ? 'dusk' : choice;
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

/** A CPU-rendered GL (SwiftShader, llvmpipe) would starve the page: show the still gradient instead. */
export const isSoftwareRenderer = (name: string) => /swiftshader|llvmpipe|software/i.test(name);

/**
 * Whether to try the live waves at all. Automated browsers (e2e) never do: WebKit reports a generic
 * GPU name ("Apple GPU") that the renderer check cannot see through, and CI has no real GPU.
 */
export const mayDrawLive = (env: { webdriver?: boolean }) => env.webdriver !== true;

/** After 20 draws, an average above 100 ms each (under 10 fps) means this device can't keep up. */
export const isStarved = (elapsedMs: number, draws: number) =>
	draws >= 20 && elapsedMs / draws > 100;

export const WAVE_FPS = 30;
export const MAX_CANVAS_WIDTH = 3840;
/** The wall at 4K gets a smaller canvas: the Pi 5 fills fewer pixels, the look stays the same. */
export const renderScale = (wall: boolean) => (wall ? 0.5 : 0.6);

/** Canvas pixel size for a window: device pixel ratio up to 2, times the scale, capped at 3840 wide. */
export function canvasSize(
	width: number,
	height: number,
	dpr: number,
	scale: number
): { width: number; height: number } {
	const d = Math.min(dpr || 1, 2);
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
