import { describe, expect, it } from 'vitest';
import {
	activeRoutines,
	advance,
	clampDone,
	currentStep,
	isRoutineActive,
	isRoutineComplete,
	isRoutineIcon,
	minutesInZone,
	parseMinutes,
	sameSteps,
	validateRoutine,
	type KidRoutine
} from './routines.js';

const step = { label: 'Brush teeth', icon: 'toothbrush' };
const routine = (over: Partial<KidRoutine> = {}): KidRoutine => ({
	id: 'r',
	name: 'Morning',
	windowStart: null,
	windowEnd: null,
	steps: [{ label: 'a', icon: 'star' }],
	done: 0,
	...over
});

describe('windows', () => {
	it('parses times', () => {
		expect(parseMinutes('07:30')).toBe(450);
		expect([parseMinutes('24:00'), parseMinutes('7pm'), parseMinutes(5)]).toEqual([
			null,
			null,
			null
		]);
	});

	it('is active without a usable window, inside a day window, or inside a midnight-wrapping one', () => {
		expect(isRoutineActive(0, null, null)).toBe(true);
		expect(isRoutineActive(0, '07:00', '07:00')).toBe(true);
		expect(isRoutineActive(6 * 60 + 59, '07:00', '09:00')).toBe(false);
		expect(isRoutineActive(7 * 60, '07:00', '09:00')).toBe(true);
		expect(isRoutineActive(9 * 60, '07:00', '09:00')).toBe(false);
		expect(isRoutineActive(23 * 60, '19:00', '02:00')).toBe(true);
		expect(isRoutineActive(12 * 60, '19:00', '02:00')).toBe(false);
	});

	it('reads local minutes in a zone', () => {
		const t = Date.UTC(2026, 0, 15, 12, 5);
		expect(minutesInZone(t, 'UTC')).toBe(725);
		expect(minutesInZone(t, 'America/New_York')).toBe(7 * 60 + 5);
	});

	it('offers only non-empty, in-window, unfinished routines', () => {
		const list = [
			routine({ id: 'ok' }),
			routine({ id: 'empty', steps: [] }),
			routine({ id: 'late', windowStart: '07:00', windowEnd: '08:00' }),
			routine({ id: 'finished', done: 1 })
		];
		expect(activeRoutines(list, 12 * 60).map((r) => r.id)).toEqual(['ok']);
	});
});

describe('progress', () => {
	it('clamps, walks one step at a time, and never goes backwards', () => {
		expect([clampDone(-1, 3), clampDone(9, 3), clampDone(1.5, 3)]).toEqual([0, 3, 0]);
		expect([isRoutineComplete(3, 3), isRoutineComplete(0, 0)]).toEqual([true, false]);
		expect([currentStep(0, 3), currentStep(2, 3), currentStep(3, 3)]).toEqual([0, 2, null]);
		expect([advance(0, 0, 3), advance(2, 0, 3), advance(2, 2, 3), advance(2, 9, 3)]).toEqual([
			1, 2, 3, 3
		]);
	});
});

describe('validateRoutine', () => {
	it('cleans a good routine', () => {
		expect(
			validateRoutine({
				name: ' Morning ',
				windowStart: '',
				steps: [{ ...step, label: ' Brush teeth ' }]
			})
		).toEqual({ name: 'Morning', windowStart: null, windowEnd: null, steps: [step] });
		expect(
			validateRoutine({ name: 'x', windowStart: '07:00', windowEnd: '09:00', steps: [step] })
		).toMatchObject({ windowStart: '07:00', windowEnd: '09:00' });
		expect([isRoutineIcon('bed'), isRoutineIcon('rocket')]).toEqual([true, false]);
	});

	it.each([
		['name', { name: ' ', steps: [step] }],
		['half window', { name: 'x', windowStart: '07:00', steps: [step] }],
		['bad start', { name: 'x', windowStart: '7', windowEnd: '08:00', steps: [step] }],
		['bad end', { name: 'x', windowStart: '07:00', windowEnd: 'z', steps: [step] }],
		['no steps', { name: 'x', steps: [] }],
		['too many', { name: 'x', steps: Array.from({ length: 13 }, () => step) }],
		['blank label', { name: 'x', steps: [{ label: '', icon: 'bed' }] }],
		['bad icon', { name: 'x', steps: [{ label: 'a', icon: 'rocket' }] }]
	])('rejects %s', (_n, input) => {
		expect(validateRoutine(input)).toEqual({ error: expect.any(String) });
	});
});

describe('sameSteps', () => {
	it('compares order, labels and pictures', () => {
		const a = { label: 'a', icon: 'bed' } as const;
		const b = { label: 'b', icon: 'star' } as const;
		expect(sameSteps([a, b], [{ ...a }, { ...b }])).toBe(true);
		expect(sameSteps([a, b], [b, a])).toBe(false);
		expect(sameSteps([a], [a, b])).toBe(false);
		expect(sameSteps([a], [{ ...a, icon: 'book' }])).toBe(false);
	});
});
