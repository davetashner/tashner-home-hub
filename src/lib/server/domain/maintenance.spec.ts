import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../db/index.js';
import { subscribe } from './events.js';
import {
	createMaintenance,
	deleteMaintenance,
	listMaintenance,
	maintenanceDueCount,
	markMaintenanceDone,
	updateMaintenance
} from './maintenance.js';

let db: Db;
beforeEach(() => {
	db = openDb(':memory:');
});

describe('maintenance storage', () => {
	it('creates tasks and lists them soonest first', () => {
		createMaintenance(db, { title: 'Clean gutters', intervalMonths: 12, nextDue: '2027-04-12' });
		createMaintenance(db, { title: 'Refill fuel', intervalMonths: null });
		createMaintenance(db, {
			title: '  Change filter ',
			intervalMonths: '3',
			nextDue: '2026-11-18',
			estTime: '5 mins',
			notes: ' More often with pets '
		});
		const all = listMaintenance(db);
		expect(all.map((t) => t.title)).toEqual(['Change filter', 'Clean gutters', 'Refill fuel']);
		expect(all[0]).toMatchObject({
			intervalMonths: 3,
			estTime: '5 mins',
			notes: 'More often with pets'
		});
		expect(all[2]).toMatchObject({
			intervalMonths: null,
			nextDue: null,
			lastDone: null,
			notes: null
		});
	});

	it('works out the next due day from the last done day', () => {
		const t = createMaintenance(db, {
			title: 'Flush heater',
			intervalMonths: 12,
			lastDone: '2026-11-17'
		});
		expect(t.nextDue).toBe('2027-11-17');
		const kept = createMaintenance(db, {
			title: 'Soften water',
			intervalMonths: 12,
			lastDone: '2026-10-05',
			nextDue: '2027-09-01'
		});
		expect(kept.nextDue).toBe('2027-09-01');
	});

	it('rejects bad input', () => {
		const bad = [
			{ title: '' },
			{ title: 'x'.repeat(61) },
			{ title: 'ok', intervalMonths: 0 },
			{ title: 'ok', nextDue: '2026-02-30' },
			{ title: 'ok', lastDone: 'yesterday' },
			{ title: 'ok', estTime: 5 },
			{ title: 'ok', notes: 'x'.repeat(201) }
		];
		for (const input of bad) expect(() => createMaintenance(db, input)).toThrow();
	});

	it('counts due and overdue tasks', () => {
		createMaintenance(db, { title: 'a', nextDue: '2026-11-01' });
		createMaintenance(db, { title: 'b', nextDue: '2026-11-18' });
		createMaintenance(db, { title: 'c', nextDue: '2026-11-19' });
		createMaintenance(db, { title: 'd' });
		expect(maintenanceDueCount(db, '2026-11-18')).toBe(2);
	});

	it('marks a task done and schedules the next one', () => {
		const t = createMaintenance(db, { title: 'Filter', intervalMonths: 3, nextDue: '2026-11-18' });
		const done = markMaintenanceDone(db, t.id, '2026-11-18');
		expect(done).toMatchObject({ lastDone: '2026-11-18', nextDue: '2027-02-18' });
		// A replayed offline write lands on the same answer.
		expect(markMaintenanceDone(db, t.id, '2026-11-18')).toMatchObject({ nextDue: '2027-02-18' });
		const asNeeded = createMaintenance(db, { title: 'Fuel', nextDue: '2026-12-01' });
		expect(markMaintenanceDone(db, asNeeded.id, '2026-11-15')).toMatchObject({
			lastDone: '2026-11-15',
			nextDue: null
		});
		expect(() => markMaintenanceDone(db, t.id, undefined)).toThrow('date is required');
		expect(() => markMaintenanceDone(db, 'nope', '2026-11-18')).toThrow('Task not found');
	});

	it('updates only the fields given and clears with null', () => {
		const t = createMaintenance(db, {
			title: 'Roof',
			intervalMonths: 12,
			nextDue: '2026-11-18',
			notes: 'Look for loose shingles'
		});
		const u = updateMaintenance(db, t.id, {
			title: 'Check roof',
			notes: null,
			lastDone: '2025-11-01'
		});
		expect(u).toMatchObject({
			title: 'Check roof',
			notes: null,
			lastDone: '2025-11-01',
			nextDue: '2026-11-18',
			intervalMonths: 12
		});
		const v = updateMaintenance(db, t.id, { intervalMonths: '', nextDue: null, estTime: '1 hour' });
		expect(v).toMatchObject({ intervalMonths: null, nextDue: null, estTime: '1 hour' });
		expect(updateMaintenance(db, t.id, {})).toMatchObject({ title: 'Check roof' });
		expect(() => updateMaintenance(db, 'nope', {})).toThrow('Task not found');
		expect(() => updateMaintenance(db, 'nope', { title: 'x' })).toThrow('Task not found');
	});

	it('deletes tasks and tells live screens about every change', () => {
		const seen: string[] = [];
		const stop = subscribe(['lists'], (e) => seen.push(e.data.kind));
		const t = createMaintenance(db, { title: 'Vent' });
		updateMaintenance(db, t.id, { notes: 'Fire safety' });
		markMaintenanceDone(db, t.id, '2026-11-18');
		expect(deleteMaintenance(db, t.id)).toEqual({ id: t.id });
		expect(() => deleteMaintenance(db, t.id)).toThrow('Task not found');
		stop?.();
		expect(seen).toEqual(['maintenance', 'maintenance', 'maintenance', 'maintenance']);
		expect(listMaintenance(db)).toEqual([]);
	});
});
