/**
 * Photo slideshow (PHO-3, PHO-5): settings, playback order, render size and fill decisions.
 * Pure so the frame component only wires timers and images together.
 */

export const TRANSITIONS = ['fade', 'kenburns'] as const;
export type Transition = (typeof TRANSITIONS)[number];

export interface SlideshowSettings {
	intervalSeconds: number;
	transition: Transition;
}

export const DEFAULT_SLIDESHOW: SlideshowSettings = { intervalSeconds: 30, transition: 'fade' };

/** The intervals a grown-up can pick, in seconds. */
export const INTERVAL_STEPS = [10, 15, 20, 30, 45, 60, 90, 120, 300, 600] as const;

export function isIntervalSeconds(v: unknown): v is number {
	return typeof v === 'number' && (INTERVAL_STEPS as readonly number[]).includes(v);
}

export function isTransition(v: unknown): v is Transition {
	return typeof v === 'string' && (TRANSITIONS as readonly string[]).includes(v);
}

/** Fills missing or invalid values from the defaults. */
export function parseSlideshowSettings(raw: Record<string, unknown>): SlideshowSettings {
	return {
		intervalSeconds: isIntervalSeconds(raw.intervalSeconds)
			? raw.intervalSeconds
			: DEFAULT_SLIDESHOW.intervalSeconds,
		transition: isTransition(raw.transition) ? raw.transition : DEFAULT_SLIDESHOW.transition
	};
}

/** The next allowed interval up (`direction` 1) or down (-1); stays put at either end. */
export function stepInterval(current: number, direction: 1 | -1): number {
	const steps = INTERVAL_STEPS as readonly number[];
	const i = steps.findIndex((s) => s >= current);
	const at = i === -1 ? steps.length - 1 : i;
	if (direction === 1) return steps[steps[at] > current ? at : Math.min(at + 1, steps.length - 1)];
	return steps[Math.max(0, at - 1)];
}

export function intervalLabel(seconds: number): string {
	if (seconds < 60) return `${seconds} seconds`;
	const m = seconds / 60;
	return m === 1 ? '1 minute' : `${m} minutes`;
}

export interface Size {
	width: number;
	height: number;
}

/** Display render sizes /api/photo/[id] serves (landscape; portrait is the swap). */
export const DISPLAY_SIZES: readonly Size[] = [
	{ width: 1920, height: 1080 },
	{ width: 2560, height: 1440 },
	{ width: 3840, height: 2160 }
];

/** Smallest served size, in the screen's orientation, that covers its device pixels. */
export function pickTarget(cssWidth: number, cssHeight: number, dpr = 1): Size {
	const portrait = cssHeight > cssWidth;
	const long = Math.max(cssWidth, cssHeight) * (dpr || 1);
	const short = Math.min(cssWidth, cssHeight) * (dpr || 1);
	const size =
		DISPLAY_SIZES.find((s) => s.width >= long && s.height >= short) ??
		DISPLAY_SIZES[DISPLAY_SIZES.length - 1];
	return portrait ? { width: size.height, height: size.width } : size;
}

export interface SlidePhoto {
	id: string;
	/** Oriented pixel size; null until the server has read the file. */
	w: number | null;
	h: number | null;
}

/** Bars thinner than this share of the screen are not worth a backdrop. */
const FILL_TOLERANCE = 0.01;

/**
 * PHO-5: photos are never cropped (faces stay whole). A photo whose shape differs from the
 * screen's (portrait on landscape, panoramas) sits on a blurred, zoomed copy of itself instead
 * of black bars. Unknown sizes ask for the backdrop; the server answers 404 when none is needed.
 */
export function needsBackdrop(photo: SlidePhoto, target: Size): boolean {
	if (!photo.w || !photo.h) return true;
	const photoRatio = photo.w / photo.h;
	const screenRatio = target.width / target.height;
	return Math.abs(photoRatio - screenRatio) / screenRatio > FILL_TOLERANCE;
}

export function photoSrc(id: string, target: Size, part: 'main' | 'bg' = 'main'): string {
	const q = new URLSearchParams({ w: `${target.width}`, h: `${target.height}`, fmt: 'avif' });
	if (part === 'bg') q.set('part', 'bg');
	return `/api/photo/${encodeURIComponent(id)}?${q}`;
}

export interface Playlist {
	photos: SlidePhoto[];
	/** Index of the photo on screen; -1 before the first. */
	index: number;
}

export interface Step extends Playlist {
	/** True when this step started a new pass (time to fetch a fresh list for the next one). */
	wrapped: boolean;
}

/**
 * The next photo. At the end of a pass the slideshow switches to `fresh` (newly added or hidden
 * photos take effect) and skips a first photo that would repeat the one on screen.
 */
export function advance(p: Playlist, fresh: SlidePhoto[] | null = null): Step {
	if (p.index + 1 < p.photos.length)
		return { photos: p.photos, index: p.index + 1, wrapped: false };
	const photos = fresh && fresh.length > 0 ? fresh : p.photos;
	const current = p.photos[p.index]?.id;
	const index = photos.length > 1 && photos[0].id === current ? 1 : 0;
	return { photos, index, wrapped: p.index >= 0 };
}

/** Same seed all day, so a reload keeps the order but each day shuffles anew. */
export function daySeed(now: Date): string {
	const pad = (n: number) => `${n}`.padStart(2, '0');
	return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export interface Motion {
	from: string;
	to: string;
}

const ZOOM = 1.08;
const PANS = [
	['-2%', '-1%'],
	['2%', '1%'],
	['2%', '-1%'],
	['-2%', '1%']
] as const;

/** Ken Burns: a slow zoom plus pan (transform only), alternating in and out and varying direction. */
export function kenBurns(step: number): Motion {
	const [x, y] = PANS[((step % PANS.length) + PANS.length) % PANS.length];
	const still = 'scale(1) translate(0, 0)';
	const moved = `scale(${ZOOM}) translate(${x}, ${y})`;
	return step % 2 === 0 ? { from: still, to: moved } : { from: moved, to: still };
}
