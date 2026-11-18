import { describe, expect, it } from 'vitest';
import {
	addMonths,
	dueCount,
	dueLabel,
	formatDay,
	frequencyLabel,
	isDue,
	nextDueAfter,
	parseInterval,
	sortTasks,
	statusOf,
	type MaintenanceTaskLike
} from './maintenance.js';

const task = (id: string, nextDue: string | null, title = id): MaintenanceTaskLike => ({
	id,
	title,
	intervalMonths: 12,
	nextDue,
	lastDone: null,
	estTime: null,
	notes: null
});

describe('addMonths', () => {
	it('adds months across a year end', () => {
		expect(addMonths('2026-11-18', 3)).toBe('2027-02-18');
		expect(addMonths('2026-11-18', 36)).toBe('2029-11-18');
	});
	it('clamps to the end of a shorter month', () => {
		expect(addMonths('2027-01-31', 1)).toBe('2027-02-28');
		expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
		expect(addMonths('2028-02-29', 12)).toBe('2029-02-28');
	});
	it('rejects a day that does not exist', () => {
		expect(() => addMonths('2026-02-30', 1)).toThrow(RangeError);
	});
});

describe('nextDueAfter', () => {
	it('schedules from the day it was done', () => {
		expect(nextDueAfter('2026-11-17', 12)).toBe('2027-11-17');
	});
	it('leaves an as-needed task unscheduled', () => {
		expect(nextDueAfter('2026-11-15', null)).toBeNull();
	});
});

describe('statusOf and isDue', () => {
	const today = '2026-11-18';
	it('sorts days into overdue, due, soon and later', () => {
		expect(statusOf({ nextDue: '2026-11-17' }, today)).toBe('overdue');
		expect(statusOf({ nextDue: today }, today)).toBe('due');
		expect(statusOf({ nextDue: '2026-12-18' }, today)).toBe('soon');
		expect(statusOf({ nextDue: '2026-12-19' }, today)).toBe('later');
	});
	it('treats a missing or broken day as unscheduled', () => {
		expect(statusOf({ nextDue: null }, today)).toBe('unscheduled');
		expect(statusOf({ nextDue: 'soon' }, today)).toBe('unscheduled');
		expect(statusOf({ nextDue: today }, 'nope')).toBe('unscheduled');
	});
	it('counts only overdue and due-today tasks', () => {
		const tasks = [
			task('a', '2026-01-01'),
			task('b', today),
			task('c', '2026-11-20'),
			task('d', null)
		];
		expect(tasks.map((t) => isDue(t, today))).toEqual([true, true, false, false]);
		expect(dueCount(tasks, today)).toBe(2);
	});
});

describe('sortTasks', () => {
	it('puts the soonest first, unscheduled last, ties by title', () => {
		const sorted = sortTasks([
			task('1', null, 'Propane'),
			task('2', '2027-01-12', 'Smoke alarms'),
			task('3', '2026-11-18', 'Roof'),
			task('4', '2026-11-18', 'HVAC filter'),
			task('5', null, 'Attic')
		]);
		expect(sorted.map((t) => t.title)).toEqual([
			'HVAC filter',
			'Roof',
			'Smoke alarms',
			'Attic',
			'Propane'
		]);
	});
});

describe('labels', () => {
	it('names frequencies', () => {
		expect([1, 3, 6, 12, 24, 36, 60, 18, null].map(frequencyLabel)).toEqual([
			'Monthly',
			'Quarterly',
			'Every 6 months',
			'Annually',
			'Every 2 years',
			'Every 3 years',
			'Every 5 years',
			'Every 18 months',
			'As needed'
		]);
	});
	it('formats days', () => {
		expect(formatDay('2028-11-01')).toBe('Nov 1, 2028');
		expect(formatDay('whenever')).toBe('whenever');
	});
	it('says when a task is due', () => {
		const today = '2026-11-18';
		expect(dueLabel({ nextDue: '2026-11-17' }, today)).toBe('Overdue by 1 day');
		expect(dueLabel({ nextDue: '2026-11-08' }, today)).toBe('Overdue by 10 days');
		expect(dueLabel({ nextDue: today }, today)).toBe('Due today');
		expect(dueLabel({ nextDue: '2026-11-19' }, today)).toBe('Due in 1 day');
		expect(dueLabel({ nextDue: '2026-12-01' }, today)).toBe('Due in 13 days');
		expect(dueLabel({ nextDue: '2028-11-01' }, today)).toBe('Due Nov 1, 2028');
		expect(dueLabel({ nextDue: null }, today)).toBe('As needed');
	});
});

describe('parseInterval', () => {
	it('accepts whole months in range and blank as as-needed', () => {
		expect(parseInterval(12)).toBe(12);
		expect(parseInterval('3')).toBe(3);
		expect(parseInterval(null)).toBeNull();
		expect(parseInterval(undefined)).toBeNull();
		expect(parseInterval('')).toBeNull();
	});
	it('rejects anything else', () => {
		for (const v of [0, -1, 1.5, 121, 'yearly', true]) expect(parseInterval(v)).toBeUndefined();
	});
});
