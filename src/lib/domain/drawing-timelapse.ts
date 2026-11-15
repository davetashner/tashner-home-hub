/**
 * Time-lapse video (hub-t27j.17): the timing and size math for turning a drawing replay into a
 * short video. The replay timeline (`drawing-replay.ts`) says what to show at each replay time;
 * this module says how many video frames there are, which replay time each one shows, how big the
 * picture is and how many bits it may use, so any drawing squeezes into a bounded clip and a
 * bounded file. Pure: no canvas, no recorder.
 */
export const VIDEO_MAX_MS = 15_000;
export const VIDEO_MIN_MS = 2_000;
export const VIDEO_FPS = 15;
/** The longest side of the picture, in pixels (a 4K board is shrunk to this). */
export const VIDEO_MAX_EDGE = 1280;
/** Bits per pixel per frame; with the cap above a clip stays around a couple of megabytes. */
export const VIDEO_BITS_PER_PIXEL = 0.15;
export const VIDEO_MAX_BITRATE = 4_000_000;
export const VIDEO_MIN_BITRATE = 250_000;

export interface TimelapsePlan {
	/** How long the video plays, ms. */
	durationMs: number;
	fps: number;
	/** Number of frames (at least 2: the first and the finished picture). */
	frames: number;
	/** How long the replay is, ms: the span the frames are spread across. */
	replayMs: number;
}

const finite = (n: unknown, fallback: number): number =>
	typeof n === 'number' && Number.isFinite(n) ? n : fallback;

/**
 * A plan that squeezes a replay of `replayMs` into at most `maxMs` of video (never shorter than
 * VIDEO_MIN_MS, so a tiny doodle is still watchable). Bad numbers fall back to the defaults.
 */
export function planTimelapse(
	replayMs: number,
	maxMs: number = VIDEO_MAX_MS,
	fps: number = VIDEO_FPS
): TimelapsePlan {
	const replay = Math.max(0, finite(replayMs, 0));
	const cap = Math.min(VIDEO_MAX_MS, Math.max(VIDEO_MIN_MS, finite(maxMs, VIDEO_MAX_MS)));
	const rate = Math.min(30, Math.max(1, Math.round(finite(fps, VIDEO_FPS))));
	const durationMs = Math.min(cap, Math.max(VIDEO_MIN_MS, replay));
	const frames = Math.max(2, Math.round((durationMs / 1000) * rate));
	return { durationMs, fps: rate, frames, replayMs: replay };
}

/** The replay time (ms) that video frame `index` shows: frame 0 is the start, the last is the end. */
export function replayTimeAt(plan: TimelapsePlan, index: number): number {
	const last = plan.frames - 1;
	const i = Math.min(last, Math.max(0, Math.floor(finite(index, 0))));
	return (i / last) * plan.replayMs;
}

/** Which frame to draw `wallMs` into recording, so a slow device skips frames instead of running long. */
export function frameIndexAt(plan: TimelapsePlan, wallMs: number): number {
	const t = Math.max(0, finite(wallMs, 0));
	if (t >= plan.durationMs) return plan.frames - 1;
	return Math.min(plan.frames - 1, Math.floor((t / plan.durationMs) * plan.frames));
}

const even = (n: number): number => Math.max(2, Math.round(n / 2) * 2);

/** Picture size: the board's shape with the longest side at most `maxEdge`, both sides even. */
export function videoSize(
	width: number,
	height: number,
	maxEdge: number = VIDEO_MAX_EDGE
): { width: number; height: number } {
	const w = Math.max(1, finite(width, 0));
	const h = Math.max(1, finite(height, 0));
	if (!(width > 0 && height > 0)) return { width: even(maxEdge), height: even(maxEdge) };
	const k = Math.min(1, maxEdge / Math.max(w, h));
	return { width: even(w * k), height: even(h * k) };
}

/** The video bitrate for a picture size: grows with pixels, clamped so the file stays small. */
export function videoBitrate(width: number, height: number, fps: number = VIDEO_FPS): number {
	const raw = Math.max(0, finite(width, 0)) * Math.max(0, finite(height, 0)) * fps;
	return Math.round(
		Math.min(VIDEO_MAX_BITRATE, Math.max(VIDEO_MIN_BITRATE, raw * VIDEO_BITS_PER_PIXEL))
	);
}

/** An upper bound on the file size in bytes for a plan at a bitrate (what the cap guarantees). */
export const maxVideoBytes = (plan: TimelapsePlan, bitrate: number): number =>
	Math.ceil((plan.durationMs / 1000) * bitrate * 0.125);
