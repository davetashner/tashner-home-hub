/** House maintenance storage (hub-nit). Recurrence and due logic live in `#lib/domain/maintenance.js`. */
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { isCalendarDate } from '#lib/domain/countdowns.js';
import {
	MAINTENANCE_NOTES_MAX,
	MAINTENANCE_TIME_MAX,
	MAINTENANCE_TITLE_MAX,
	MAINTENANCE_INTERVAL_MAX,
	dueCount,
	nextDueAfter,
	parseInterval,
	sortTasks
} from '#lib/domain/maintenance.js';
import type { Db } from '../db/index.js';
import { maintenanceTasks } from '../db/schema.js';
import { publish } from './events.js';
import { LedgerError } from './ledger.js';

export type MaintenanceTask = typeof maintenanceTasks.$inferSelect;

export interface MaintenanceInput {
	title?: unknown;
	intervalMonths?: unknown;
	nextDue?: unknown;
	lastDone?: unknown;
	estTime?: unknown;
	notes?: unknown;
}

const invalid = (msg: string) => new LedgerError('invalid', msg);

function title(v: unknown): string {
	const t = typeof v === 'string' ? v.trim() : '';
	if (t.length < 1 || t.length > MAINTENANCE_TITLE_MAX)
		throw invalid(`title must be 1-${MAINTENANCE_TITLE_MAX} characters`);
	return t;
}

function interval(v: unknown): number | null {
	const n = parseInterval(v);
	if (n === undefined)
		throw invalid(`frequency must be 1-${MAINTENANCE_INTERVAL_MAX} months, or blank for as needed`);
	return n;
}

function day(v: unknown, name: string): string | null {
	if (v === null || v === undefined || v === '') return null;
	if (!isCalendarDate(v)) throw invalid(`${name} must be a real day, YYYY-MM-DD`);
	return v;
}

function text(v: unknown, max: number, name: string): string | null {
	if (v === null || v === undefined) return null;
	if (typeof v !== 'string') throw invalid(`${name} must be text`);
	const t = v.trim();
	if (t.length > max) throw invalid(`${name} must be at most ${max} characters`);
	return t || null;
}

const changed = (id: string) => publish('lists', { kind: 'maintenance', taskId: id });

/** Every task, soonest due first. */
export function listMaintenance(db: Db): MaintenanceTask[] {
	return sortTasks(db.select().from(maintenanceTasks).all());
}

/** How many tasks are due today or overdue. */
export function maintenanceDueCount(db: Db, today: string): number {
	return dueCount(
		db.select({ nextDue: maintenanceTasks.nextDue }).from(maintenanceTasks).all(),
		today
	);
}

/** Without a next due day, one is worked out from the last done day and the frequency. */
export function createMaintenance(db: Db, input: MaintenanceInput): MaintenanceTask {
	const intervalMonths = interval(input.intervalMonths);
	const lastDone = day(input.lastDone, 'last done');
	const nextDue =
		day(input.nextDue, 'next due') ?? (lastDone ? nextDueAfter(lastDone, intervalMonths) : null);
	const row = db
		.insert(maintenanceTasks)
		.values({
			id: randomUUID(),
			title: title(input.title),
			intervalMonths,
			nextDue,
			lastDone,
			estTime: text(input.estTime, MAINTENANCE_TIME_MAX, 'time'),
			notes: text(input.notes, MAINTENANCE_NOTES_MAX, 'notes')
		})
		.returning()
		.get();
	changed(row.id);
	return row;
}

/** Updates only the fields present in `patch`; null clears an optional one. */
export function updateMaintenance(db: Db, id: string, patch: MaintenanceInput): MaintenanceTask {
	const set: Partial<typeof maintenanceTasks.$inferInsert> = {};
	if (patch.title !== undefined) set.title = title(patch.title);
	if (patch.intervalMonths !== undefined) set.intervalMonths = interval(patch.intervalMonths);
	if (patch.nextDue !== undefined) set.nextDue = day(patch.nextDue, 'next due');
	if (patch.lastDone !== undefined) set.lastDone = day(patch.lastDone, 'last done');
	if (patch.estTime !== undefined) set.estTime = text(patch.estTime, MAINTENANCE_TIME_MAX, 'time');
	if (patch.notes !== undefined) set.notes = text(patch.notes, MAINTENANCE_NOTES_MAX, 'notes');
	const row =
		Object.keys(set).length === 0
			? db.select().from(maintenanceTasks).where(eq(maintenanceTasks.id, id)).get()
			: db.update(maintenanceTasks).set(set).where(eq(maintenanceTasks.id, id)).returning().get();
	if (!row) throw new LedgerError('not_found', 'Task not found');
	if (Object.keys(set).length > 0) changed(id);
	return row;
}

/**
 * Records the task as done on `date` and schedules the next one from that day. Sets rather than
 * toggles, so an offline write replayed later lands on the same answer.
 */
export function markMaintenanceDone(db: Db, id: string, date: unknown): MaintenanceTask {
	const done = day(date, 'date');
	if (!done) throw invalid('date is required');
	return db.transaction((tx) => {
		const task = tx.select().from(maintenanceTasks).where(eq(maintenanceTasks.id, id)).get();
		if (!task) throw new LedgerError('not_found', 'Task not found');
		const row = tx
			.update(maintenanceTasks)
			.set({ lastDone: done, nextDue: nextDueAfter(done, task.intervalMonths) })
			.where(eq(maintenanceTasks.id, id))
			.returning()
			.get();
		changed(id);
		return row;
	});
}

export function deleteMaintenance(db: Db, id: string): { id: string } {
	const gone = db.delete(maintenanceTasks).where(eq(maintenanceTasks.id, id)).returning().get();
	if (!gone) throw new LedgerError('not_found', 'Task not found');
	changed(id);
	return { id };
}
