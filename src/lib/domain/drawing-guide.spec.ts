import { describe, expect, it } from 'vitest';
import {
	GUIDE_IDS,
	GUIDE_LABELS,
	clampStep,
	guideLayers,
	isGuideId,
	isLastStep,
	nextStep,
	pathD,
	prevStep,
	stepLabel
} from './drawing-guide.js';
import { GUIDES } from './drawing-guide-art.js';
import { flattenPath } from './drawing-starters.js';

describe('guide ids', () => {
	it('has at least six guides, each labelled', () => {
		expect(GUIDE_IDS.length).toBeGreaterThanOrEqual(6);
		for (const id of GUIDE_IDS) expect(GUIDE_LABELS[id].length).toBeGreaterThan(0);
	});
	it('validates ids', () => {
		expect(isGuideId('cat')).toBe(true);
		for (const bad of ['', 'Cat', 'toString', null, undefined, 3, {}])
			expect(isGuideId(bad)).toBe(false);
	});
});

describe('steps', () => {
	it('clamps into range and survives bad input', () => {
		expect(clampStep(-3, 5)).toBe(0);
		expect(clampStep(9, 5)).toBe(4);
		expect(clampStep(2.7, 5)).toBe(2);
		expect(clampStep(NaN, 5)).toBe(0);
		expect(clampStep(Infinity, 5)).toBe(0);
		expect(clampStep(3, 0)).toBe(0);
	});
	it('moves next and back without leaving the range', () => {
		expect(nextStep(0, 3)).toBe(1);
		expect(nextStep(2, 3)).toBe(2);
		expect(prevStep(1, 3)).toBe(0);
		expect(prevStep(0, 3)).toBe(0);
		expect(isLastStep(2, 3)).toBe(true);
		expect(isLastStep(1, 3)).toBe(false);
	});
	it('labels one-based', () => {
		expect(stepLabel(0, 5)).toBe('Step 1 of 5');
		expect(stepLabel(4, 5)).toBe('Step 5 of 5');
		expect(stepLabel(9, 5)).toBe('Step 5 of 5');
		expect(stepLabel(0, 0)).toBe('Step 1 of 1');
	});
});

describe('pathD', () => {
	it('writes every command kind', () => {
		expect(pathD([['M', 1.234, 2], ['L', 3, 4], ['Z']])).toBe('M1.2 2L3 4Z');
		expect(
			pathD([
				['M', 0, 0],
				['C', 1, 2, 3, 4, 5, 6]
			])
		).toBe('M0 0C1 2 3 4 5 6');
		expect(pathD([['E', 10, 10, 4, 2]])).toBe('M6 10a4 2 0 1 0 8 0a4 2 0 1 0 -8 0');
		expect(pathD([])).toBe('');
	});
});

describe('guideLayers', () => {
	const steps = [
		[
			[
				['M', 0, 0],
				['L', 1, 1]
			]
		],
		[
			[
				['M', 2, 2],
				['L', 3, 3]
			]
		],
		[
			[
				['M', 4, 4],
				['L', 5, 5]
			]
		]
	] as never;
	it('shows steps up to the current one, only the last as current', () => {
		const l = guideLayers(steps, 1);
		expect(l.map((x) => x.current)).toEqual([false, true]);
		expect(l[0].d).toBe('M0 0L1 1');
	});
	it('clamps the step and handles no steps', () => {
		expect(guideLayers(steps, 99)).toHaveLength(3);
		expect(guideLayers(steps, -1)).toHaveLength(1);
		expect(guideLayers([], 0)).toEqual([]);
	});
});

describe('guide art', () => {
	it('has a step-by-step drawing for every guide', () => {
		expect(Object.keys(GUIDES).sort()).toEqual([...GUIDE_IDS].sort());
		for (const id of GUIDE_IDS) {
			const steps = GUIDES[id];
			expect(steps.length).toBeGreaterThanOrEqual(4);
			expect(steps.length).toBeLessThanOrEqual(6);
			for (const step of steps) {
				expect(step.length).toBeGreaterThan(0);
				for (const path of step) {
					const runs = flattenPath(path);
					expect(runs.length).toBeGreaterThan(0);
					for (const [x, y] of runs.flat()) {
						expect(x).toBeGreaterThanOrEqual(0);
						expect(x).toBeLessThanOrEqual(1000);
						expect(y).toBeGreaterThanOrEqual(0);
						expect(y).toBeLessThanOrEqual(700);
					}
				}
			}
		}
	});
});
