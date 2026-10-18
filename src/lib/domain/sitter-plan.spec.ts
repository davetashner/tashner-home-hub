import { describe, expect, it } from 'vitest';
import {
	buildPlan,
	countdownLabel,
	parentsLabel,
	parentsVerb,
	type PlanInput
} from './sitter-plan.js';

const base: PlanInput = {
	nowMinutes: 17 * 60 + 30,
	nowMs: 0,
	endAt: 3 * 3_600_000,
	endMinutes: 21 * 60,
	endsLater: false,
	dinner: 'Tacos',
	routines: [],
	bedtimes: [],
	parents: 'Parent One and Parent Two'
};
const routine = (id: string, windowStart: string | null, done = 0) => ({
	id,
	name: 'Bath',
	windowStart,
	windowEnd: null,
	steps: [{ label: 'Wash', icon: 'star' as const }],
	done,
	kidName: 'Kid A'
});

describe('countdownLabel', () => {
	it('reads naturally', () => {
		expect(countdownLabel(0)).toBe('now');
		expect(countdownLabel(45)).toBe('in 45 min');
		expect(countdownLabel(80)).toBe('in 1 h 20 min');
		expect(countdownLabel(120)).toBe('in 2 h');
		expect(countdownLabel(-5)).toBe('5 min ago');
	});
});

describe('parentsLabel', () => {
	it('joins first names', () => {
		expect(parentsLabel([])).toBe('The grown-ups');
		expect(parentsLabel(['A'])).toBe('A');
		expect(parentsLabel(['A', 'B'])).toBe('A and B');
		expect(parentsLabel(['A', 'B', 'C'])).toBe('A, B and C');
		expect(parentsVerb(['A'])).toBe('is');
		expect(parentsVerb(['A', 'B'])).toBe('are');
		expect(parentsVerb([])).toBe('are');
	});
});

describe('buildPlan', () => {
	it('orders dinner, routines, bedtimes and the parents home, marking Now', () => {
		const plan = buildPlan({
			...base,
			nowMinutes: 18 * 60 + 10,
			routines: [routine('r1', '19:00')],
			bedtimes: [{ name: 'Kid A', bedtime: '19:30' }]
		});
		expect(plan.map((p) => p.kind)).toEqual(['dinner', 'routine', 'bedtime', 'home']);
		expect(plan.filter((p) => p.now).map((p) => p.kind)).toEqual(['dinner']);
		expect(plan[1].inMinutes).toBe(50);
		expect(plan[3].label).toBe('Parent One and Parent Two home');
	});

	it('moves Now along as the evening goes', () => {
		const plan = buildPlan({
			...base,
			nowMinutes: 19 * 60 + 40,
			routines: [routine('r1', '19:00')],
			bedtimes: [{ name: 'Kid A', bedtime: '19:30' }]
		});
		expect(plan.find((p) => p.now)?.kind).toBe('bedtime');
	});

	it('marks the first item Now before anything has started', () => {
		const plan = buildPlan({
			...base,
			dinner: null,
			bedtimes: [{ name: 'Kid A', bedtime: '19:30' }]
		});
		expect(plan.find((p) => p.now)?.kind).toBe('bedtime');
	});

	it('skips morning routines, empty routines, and bad bedtimes; flags finished routines', () => {
		const plan = buildPlan({
			...base,
			dinner: null,
			routines: [
				routine('am', '07:00'),
				{ ...routine('empty', '19:00'), steps: [] },
				routine('done', '19:00', 1)
			],
			bedtimes: [{ name: 'Kid A', bedtime: '' }]
		});
		expect(plan.map((p) => p.key)).toEqual(['routine-done', 'home']);
		expect(plan[0].done).toBe(true);
	});

	it('puts a windowless routine at the later of now and dinner time', () => {
		const plan = buildPlan({ ...base, dinner: null, routines: [routine('r', null)] });
		expect(plan[0].at).toBe(18 * 60);
	});

	it('shifts a home time after midnight past the evening items', () => {
		const plan = buildPlan({
			...base,
			endMinutes: 60,
			endsLater: true,
			bedtimes: [{ name: 'Kid A', bedtime: '23:00' }]
		});
		expect(plan.at(-1)?.at).toBe(1500);
	});
});
