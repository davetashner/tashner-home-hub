import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../db/index.js';
import { subscribe } from './events.js';
import { createTimer, deleteTimer, listTimers, updateTimer } from './timers.js';

let db: Db;
beforeEach(() => {
	db = openDb(':memory:');
});

const code = (fn: () => unknown) => {
	try {
		fn();
	} catch (e) {
		return (e as { code: string }).code;
	}
	return 'none';
};

describe('kitchen timer storage', () => {
	it('creates a running timer and lists it', () => {
		const t = createTimer(db, { durationMs: 60_000, label: ' Pasta ' }, 1000);
		expect(t).toMatchObject({ label: 'Pasta', durationMs: 60_000, endsAt: 61_000, pausedMs: null });
		expect(listTimers(db)).toHaveLength(1);
	});
	it('keeps a client-chosen id and ignores a repeated create', () => {
		createTimer(db, { id: 'client-id-1', durationMs: 5000 }, 0);
		const again = createTimer(db, { id: 'client-id-1', durationMs: 9000 }, 100);
		expect(again.durationMs).toBe(5000);
		expect(listTimers(db)).toHaveLength(1);
	});
	it('rejects bad input and too many timers', () => {
		expect(code(() => createTimer(db, { durationMs: 5 }))).toBe('invalid');
		expect(code(() => createTimer(db, { durationMs: 5000, id: 'no spaces!' }))).toBe('invalid');
		for (let i = 0; i < 12; i++) createTimer(db, { durationMs: 5000 });
		expect(code(() => createTimer(db, { durationMs: 5000 }))).toBe('conflict');
	});
	it('pauses, resumes and adds time', () => {
		const { id } = createTimer(db, { durationMs: 60_000 }, 0);
		expect(updateTimer(db, id, 'pause', undefined, 10_000)).toMatchObject({
			endsAt: null,
			pausedMs: 50_000
		});
		expect(updateTimer(db, id, 'resume', undefined, 20_000).endsAt).toBe(70_000);
		expect(updateTimer(db, id, 'add', 60_000, 30_000).endsAt).toBe(130_000);
		expect(listTimers(db)[0].endsAt).toBe(130_000);
	});
	it('rejects unknown timers, actions and amounts', () => {
		expect(code(() => updateTimer(db, 'nope', 'pause', undefined))).toBe('not_found');
		const { id } = createTimer(db, { durationMs: 5000 });
		expect(code(() => updateTimer(db, id, 'explode', undefined))).toBe('invalid');
		expect(code(() => updateTimer(db, id, 'add', 'x'))).toBe('invalid');
	});
	it('deletes, quietly when already gone, and announces every change', () => {
		const seen: string[] = [];
		const off = subscribe(['timers'], (e) => seen.push(e.data.id));
		const { id } = createTimer(db, { durationMs: 5000 });
		updateTimer(db, id, 'pause', undefined);
		deleteTimer(db, id);
		deleteTimer(db, id);
		deleteTimer(db, 'never-existed');
		off?.();
		expect(listTimers(db)).toHaveLength(0);
		expect(seen).toEqual([id, id, id]);
	});
});
