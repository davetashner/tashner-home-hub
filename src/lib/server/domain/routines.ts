/** Picture routines (CHO-13): CRUD and per-day progress. Progress is one row per routine per local day. */
import { asc, eq, inArray, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { Db } from '../db/index.js';
import { members, routineProgress, routineSteps, routines } from '../db/schema.js';
import {
	advance,
	clampDone,
	sameSteps,
	validateRoutine,
	type KidRoutine
} from '#lib/domain/routines.js';
import { LedgerError } from './ledger.js';

type RoutineBody = Parameters<typeof validateRoutine>[0];
type RoutineInput = RoutineBody & { memberId: string };

function get(db: Db, id: string) {
	const row = db.select().from(routines).where(eq(routines.id, id)).get();
	if (!row) throw new LedgerError('not_found', 'Routine not found');
	return row;
}

/** Routines (with steps and today's progress) for one member, or everyone when `memberId` is omitted. */
export function listRoutines(db: Db, opts: { memberId?: string; date?: string } = {}) {
	const rows = db
		.select()
		.from(routines)
		.where(opts.memberId ? eq(routines.memberId, opts.memberId) : undefined)
		.orderBy(asc(routines.createdAt), asc(routines.id))
		.all();
	if (rows.length === 0) return [];
	const ids = rows.map((r) => r.id);
	const steps = db
		.select()
		.from(routineSteps)
		.where(inArray(routineSteps.routineId, ids))
		.orderBy(asc(routineSteps.position))
		.all();
	const progress = opts.date
		? db.select().from(routineProgress).where(inArray(routineProgress.routineId, ids)).all()
		: [];
	return rows.map((r): KidRoutine & { memberId: string } => ({
		id: r.id,
		memberId: r.memberId,
		name: r.name,
		windowStart: r.windowStart,
		windowEnd: r.windowEnd,
		steps: steps
			.filter((s) => s.routineId === r.id)
			.map((s) => ({ label: s.label, icon: s.icon as KidRoutine['steps'][number]['icon'] })),
		done: progress.find((p) => p.routineId === r.id && p.date === opts.date)?.done ?? 0
	}));
}

export function createRoutine(db: Db, input: RoutineInput) {
	const v = validateRoutine(input);
	if ('error' in v) throw new LedgerError('invalid', v.error);
	if (!db.select().from(members).where(eq(members.id, input.memberId)).get())
		throw new LedgerError('not_found', 'Member not found');
	const id = randomUUID();
	db.transaction((tx) => {
		const { memberId } = input;
		tx.insert(routines)
			.values({ id, memberId, name: v.name, windowStart: v.windowStart, windowEnd: v.windowEnd })
			.run();
		const rows = v.steps.map((s, position) => ({
			id: randomUUID(),
			routineId: id,
			position,
			...s
		}));
		tx.insert(routineSteps).values(rows).run();
	});
	return listRoutines(db).find((r) => r.id === id)!;
}

/**
 * Replaces a routine's name, window and ordered steps (and optionally its member).
 * Progress rule: when the step list changes (add, remove, reorder, relabel, new picture) the
 * saved progress is cleared, because "steps done" counts positions and would point at the wrong
 * step. Renaming, changing the window or the member keeps today's progress.
 */
export function updateRoutine(db: Db, id: string, input: RoutineBody & { memberId?: string }) {
	const current = get(db, id);
	const v = validateRoutine(input);
	if ('error' in v) throw new LedgerError('invalid', v.error);
	const memberId = input.memberId ?? current.memberId;
	if (!db.select().from(members).where(eq(members.id, memberId)).get())
		throw new LedgerError('not_found', 'Member not found');
	const before = listRoutines(db).find((r) => r.id === id)!.steps;
	db.transaction((tx) => {
		tx.update(routines)
			.set({ memberId, name: v.name, windowStart: v.windowStart, windowEnd: v.windowEnd })
			.where(eq(routines.id, id))
			.run();
		if (sameSteps(before, v.steps)) return;
		tx.delete(routineSteps).where(eq(routineSteps.routineId, id)).run();
		tx.delete(routineProgress).where(eq(routineProgress.routineId, id)).run();
		tx.insert(routineSteps)
			.values(v.steps.map((s, position) => ({ id: randomUUID(), routineId: id, position, ...s })))
			.run();
	});
	return listRoutines(db).find((r) => r.id === id)!;
}

export function deleteRoutine(db: Db, id: string) {
	get(db, id);
	db.delete(routines).where(eq(routines.id, id)).run();
	return { deleted: true };
}

/** Marks step `step` (0-based) done for `date`. Never goes backwards; returns the steps finished. */
export function completeRoutineStep(db: Db, id: string, date: string, step: unknown) {
	get(db, id);
	const total = db.select().from(routineSteps).where(eq(routineSteps.routineId, id)).all().length;
	if (!Number.isInteger(step) || (step as number) < 0 || (step as number) >= total)
		throw new LedgerError('invalid', 'step is out of range');
	return db.transaction((tx) => {
		const row = tx
			.select()
			.from(routineProgress)
			.where(sql`${routineProgress.routineId} = ${id} and ${routineProgress.date} = ${date}`)
			.get();
		const done = advance(clampDone(row?.done ?? 0, total), step as number, total);
		tx.insert(routineProgress)
			.values({ routineId: id, date, done })
			.onConflictDoUpdate({
				target: [routineProgress.routineId, routineProgress.date],
				set: { done }
			})
			.run();
		return { done, total };
	});
}
