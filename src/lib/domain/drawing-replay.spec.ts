import { describe, expect, it } from 'vitest';
import {
	ITEM_WEIGHT,
	REPLAY_HOLD_MS,
	REPLAY_MS,
	buildSchedule,
	frameAt,
	itemsAt,
	nextSpeed
} from './drawing-replay.js';

const stroke = (n: number) => ({ tool: 'pen', points: Array.from({ length: n }, (_, i) => i) });
const shape = { shape: 'box' };

describe('drawing-replay', () => {
	it('scales any drawing to the target time', () => {
		for (const items of [[stroke(3)], [stroke(500), shape, stroke(5000)], [shape, shape]]) {
			expect(buildSchedule(items).drawMs).toBeCloseTo(REPLAY_MS);
		}
		expect(buildSchedule([stroke(10)], 4000).drawMs).toBeCloseTo(4000);
	});

	it('gives items time in proportion to their points and keeps their order', () => {
		const s = buildSchedule([stroke(10), shape, stroke(30)]);
		const total = 10 + ITEM_WEIGHT + 30;
		expect(s.spans[0]).toBeCloseTo((10 / total) * REPLAY_MS);
		expect(s.spans[1]).toBeCloseTo((ITEM_WEIGHT / total) * REPLAY_MS);
		expect(s.starts[1]).toBeCloseTo(s.spans[0]);
		expect(s.starts[2]).toBeCloseTo(s.spans[0] + s.spans[1]);
		expect(s.totalMs).toBeCloseTo(REPLAY_MS + REPLAY_HOLD_MS);
	});

	it('handles an empty drawing', () => {
		const s = buildSchedule([]);
		expect(s.totalMs).toBe(0);
		expect(frameAt(s, 0)).toEqual({ done: 0, partial: null, finished: true });
	});

	it('reveals strokes point by point', () => {
		const s = buildSchedule([stroke(100)]);
		expect(frameAt(s, 0)).toEqual({ done: 0, partial: { index: 0, points: 1 }, finished: false });
		const mid = frameAt(s, REPLAY_MS / 2);
		expect(mid.partial?.points).toBe(50);
		expect(frameAt(s, REPLAY_MS * 0.97).partial?.points).toBeGreaterThan(95);
	});

	it('shows shapes whole when their turn comes, then the earlier items stay', () => {
		const s = buildSchedule([stroke(10), shape, stroke(10)]);
		const at = s.starts[1] + 1;
		expect(frameAt(s, at)).toEqual({ done: 1, partial: null, finished: false });
		const f = frameAt(s, s.starts[2] + 1);
		expect(f.done).toBe(2);
		expect(f.partial?.index).toBe(2);
	});

	it('holds the finished drawing, then reports finished', () => {
		const s = buildSchedule([stroke(10), shape]);
		expect(frameAt(s, s.drawMs)).toEqual({ done: 2, partial: null, finished: false });
		expect(frameAt(s, s.totalMs)).toEqual({ done: 2, partial: null, finished: true });
		expect(frameAt(s, -50).done).toBe(0);
	});

	it('finds the right item among many', () => {
		const items = Array.from({ length: 1000 }, () => stroke(4));
		const s = buildSchedule(items);
		const f = frameAt(s, s.starts[777] + s.spans[777] / 2);
		expect(f.done).toBe(777);
		expect(f.partial?.index).toBe(777);
	});

	it('builds the items to paint without touching the saved ones', () => {
		const items = [stroke(10), shape, stroke(10)];
		const copy = JSON.stringify(items);
		const s = buildSchedule(items);
		const out = itemsAt(items, frameAt(s, s.starts[2] + s.spans[2] / 2));
		expect(out).toHaveLength(3);
		expect((out[2] as ReturnType<typeof stroke>).points.length).toBeLessThan(10);
		expect(out[0]).toBe(items[0]);
		expect(JSON.stringify(items)).toBe(copy);
		expect(itemsAt(items, { done: 3, partial: null, finished: true })).toHaveLength(3);
	});

	it('toggles 1x and 2x', () => {
		expect(nextSpeed(1)).toBe(2);
		expect(nextSpeed(2)).toBe(1);
	});
});
