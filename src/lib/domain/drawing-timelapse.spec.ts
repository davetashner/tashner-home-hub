import { describe, expect, it } from 'vitest';
import {
	VIDEO_FPS,
	VIDEO_MAX_BITRATE,
	VIDEO_MAX_EDGE,
	VIDEO_MAX_MS,
	VIDEO_MIN_BITRATE,
	VIDEO_MIN_MS,
	frameIndexAt,
	maxVideoBytes,
	planTimelapse,
	replayTimeAt,
	videoBitrate,
	videoSize
} from './drawing-timelapse.js';

describe('planTimelapse', () => {
	it('keeps a short replay at its own length', () => {
		const p = planTimelapse(10_600);
		expect(p.durationMs).toBe(10_600);
		expect(p.frames).toBe(Math.round(10.6 * VIDEO_FPS));
	});
	it('squeezes a long replay into the cap', () => {
		expect(planTimelapse(120_000).durationMs).toBe(VIDEO_MAX_MS);
		expect(planTimelapse(120_000, 5_000).durationMs).toBe(5_000);
	});
	it('never exceeds 15 s even if asked for more, nor goes under the minimum', () => {
		expect(planTimelapse(120_000, 60_000).durationMs).toBe(VIDEO_MAX_MS);
		expect(planTimelapse(100).durationMs).toBe(VIDEO_MIN_MS);
		expect(planTimelapse(100, 10).durationMs).toBe(VIDEO_MIN_MS);
	});
	it('survives malformed numbers', () => {
		const p = planTimelapse(NaN, Infinity, NaN);
		expect(p.durationMs).toBe(VIDEO_MIN_MS);
		expect(p.fps).toBe(VIDEO_FPS);
		expect(p.frames).toBeGreaterThanOrEqual(2);
		expect(planTimelapse(-5).replayMs).toBe(0);
		expect(planTimelapse(5000, 5000, 1000).fps).toBe(30);
		expect(planTimelapse(5000, 5000, 0).fps).toBe(1);
		expect(planTimelapse(5000, 5000, 0).frames).toBe(5);
	});
});

describe('replayTimeAt', () => {
	const p = planTimelapse(40_000);
	it('starts at 0, ends at the replay end and rises evenly', () => {
		expect(replayTimeAt(p, 0)).toBe(0);
		expect(replayTimeAt(p, p.frames - 1)).toBe(40_000);
		expect(replayTimeAt(p, 10)).toBeGreaterThan(replayTimeAt(p, 9));
	});
	it('clamps and tolerates bad indexes', () => {
		expect(replayTimeAt(p, -3)).toBe(0);
		expect(replayTimeAt(p, 99999)).toBe(40_000);
		expect(replayTimeAt(p, NaN)).toBe(0);
	});
});

describe('frameIndexAt', () => {
	const p = planTimelapse(40_000);
	it('maps wall time onto frames and finishes on the last', () => {
		expect(frameIndexAt(p, 0)).toBe(0);
		expect(frameIndexAt(p, -10)).toBe(0);
		expect(frameIndexAt(p, p.durationMs / 2)).toBe(Math.floor(p.frames / 2));
		expect(frameIndexAt(p, p.durationMs)).toBe(p.frames - 1);
		expect(frameIndexAt(p, 1e9)).toBe(p.frames - 1);
		expect(frameIndexAt(p, NaN)).toBe(0);
	});
});

describe('videoSize', () => {
	it('shrinks a 4K board to the cap with even sides', () => {
		const s = videoSize(3840, 2160);
		expect(s.width).toBe(VIDEO_MAX_EDGE);
		expect(s.height).toBe(720);
	});
	it('handles portrait and keeps small boards as they are', () => {
		expect(videoSize(2160, 3840)).toEqual({ width: 720, height: VIDEO_MAX_EDGE });
		expect(videoSize(641, 361)).toEqual({ width: 642, height: 362 });
	});
	it('falls back to a square for malformed sizes', () => {
		expect(videoSize(0, 100)).toEqual({ width: VIDEO_MAX_EDGE, height: VIDEO_MAX_EDGE });
		expect(videoSize(NaN, NaN)).toEqual({ width: VIDEO_MAX_EDGE, height: VIDEO_MAX_EDGE });
	});
});

describe('videoBitrate and size bound', () => {
	it('is clamped both ways', () => {
		expect(videoBitrate(10, 10)).toBe(VIDEO_MIN_BITRATE);
		expect(videoBitrate(4000, 4000)).toBe(VIDEO_MAX_BITRATE);
		expect(videoBitrate(NaN, 5)).toBe(VIDEO_MIN_BITRATE);
	});
	it('scales with pixels in between', () => {
		const mid = videoBitrate(640, 360);
		expect(mid).toBeGreaterThan(VIDEO_MIN_BITRATE);
		expect(mid).toBeLessThan(VIDEO_MAX_BITRATE);
	});
	it('bounds a full clip to a few megabytes', () => {
		const p = planTimelapse(999_999);
		const s = videoSize(3840, 2160);
		expect(maxVideoBytes(p, videoBitrate(s.width, s.height))).toBeLessThanOrEqual(7_500_000);
	});
});
