import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, schema, type Db } from '../db/index.js';
import {
	approveCompletion,
	awardBonus,
	completeChore,
	createChore,
	undoCompletion
} from './ledger.js';
import { judgeMissedPeriods, MISSED_SINCE_KEY } from './missed.js';
import { starBalance } from './stars.js';
import { weeklySummary } from './weekly-summary.js';

const TZ = 'UTC';
const noon = (date: string) => Date.parse(`${date}T12:00:00Z`);
let db: Db;

/** Daily 3-star job created on 2026-03-01. */
function makeJob(
	over: Partial<Parameters<typeof createChore>[1]> = {},
	created = '2026-03-01'
): string {
	const job = createChore(db, {
		title: 'Dishes',
		stars: 3,
		memberIds: ['kid'],
		schedule: 'DTSTART:20260301T000000Z\nRRULE:FREQ=DAILY',
		requiresApproval: false,
		...over
	});
	db.update(schema.chores)
		.set({ createdAt: noon(created) })
		.where(eqId(job.id))
		.run();
	return job.id;
}
import { eq } from 'drizzle-orm';
const eqId = (id: string) => eq(schema.chores.id, id);
const since = (date: string) =>
	db
		.insert(schema.settings)
		.values({ key: MISSED_SINCE_KEY, value: JSON.stringify(date) })
		.run();
const judge = (date: string) => judgeMissedPeriods(db, noon(date), TZ);
const done = (choreId: string, date: string) =>
	completeChore(db, { choreId, memberId: 'kid', date, now: noon(date) }).completion;
const bal = () => starBalance(db, 'kid');
const give = (n: number) => awardBonus(db, { memberId: 'kid', delta: n, note: 'seed' });

beforeEach(() => {
	db = openDb(':memory:');
	db.insert(schema.members).values({ id: 'kid', name: 'Kid', role: 'child', color: 'blue' }).run();
	db.insert(schema.members).values({ id: 'mum', name: 'Mum', role: 'adult', color: 'red' }).run();
	since('2026-03-01');
});

describe('judgeMissedPeriods: daily jobs', () => {
	it('removes the job stars with a Missed label for a day that ended undone', () => {
		makeJob();
		give(10);
		const missed = judge('2026-03-03');
		expect(missed.map((m) => [m.periodKey, m.starsRemoved])).toEqual([
			['2026-03-02', 3] // 03-01 is the creation day: never counted
		]);
		expect(bal()).toBe(7);
		const row = db
			.select()
			.from(schema.starTransactions)
			.all()
			.find((t) => t.delta === -3)!;
		expect(row.note).toBe('Missed: Dishes');
		expect(row.status).toBe('approved');
	});

	it('does not judge today, or a day that was done', () => {
		const id = makeJob();
		give(10);
		done(id, '2026-03-02');
		expect(judge('2026-03-03')).toEqual([]);
		expect(judge('2026-03-02')).toEqual([]); // 03-01 creation day only
		expect(bal()).toBe(10 + 3);
	});

	it('catches up on every ended day after downtime, once each', () => {
		makeJob();
		give(20);
		const missed = judge('2026-03-05');
		expect(missed.map((m) => m.periodKey)).toEqual(['2026-03-02', '2026-03-03', '2026-03-04']);
		expect(bal()).toBe(11);
	});

	it('is idempotent: re-running, or a second run later, never deducts twice', () => {
		makeJob();
		give(20);
		judge('2026-03-03');
		expect(judge('2026-03-03')).toEqual([]);
		expect(bal()).toBe(17);
		expect(judge('2026-03-04').map((m) => m.periodKey)).toEqual(['2026-03-03']);
		expect(bal()).toBe(14);
	});

	it('does not charge a judged day again after its completion is undone later', () => {
		const id = makeJob();
		give(20);
		const c = done(id, '2026-03-02');
		judge('2026-03-03');
		undoCompletion(db, c.id, { now: noon('2026-03-04'), byAdult: true });
		expect(judge('2026-03-04').map((m) => m.periodKey)).toEqual(['2026-03-03']);
		expect(bal()).toBe(17);
	});

	it('counts a completion still waiting for approval as done', () => {
		const id = makeJob({ requiresApproval: true });
		give(5);
		const c = done(id, '2026-03-02');
		expect(c.status).toBe('pending');
		expect(judge('2026-03-03')).toEqual([]);
		expect(bal()).toBe(5);
		approveCompletion(db, c.id);
	});

	it('treats an undone completion as missed but a rejected one as already settled', () => {
		const id = makeJob();
		give(10);
		const c = done(id, '2026-03-02');
		undoCompletion(db, c.id, { now: noon('2026-03-02'), byAdult: true });
		expect(judge('2026-03-03')).toHaveLength(1);
		const id2 = makeJob({ title: 'Bins', requiresApproval: true });
		const c2 = done(id2, '2026-03-03');
		db.update(schema.choreCompletions)
			.set({ status: 'rejected' })
			.where(eq(schema.choreCompletions.id, c2.id))
			.run();
		expect(judge('2026-03-04').map((m) => `${m.title} ${m.periodKey}`)).not.toContain(
			'Bins 2026-03-03'
		);
	});

	it('clamps the deduction so the balance never goes below zero', () => {
		makeJob();
		give(2);
		const [m] = judge('2026-03-03');
		expect(m.starsRemoved).toBe(2);
		expect(bal()).toBe(0);
		// A later miss on an empty balance records the miss with nothing to remove.
		const [m2] = judge('2026-03-04');
		expect(m2.starsRemoved).toBe(0);
		expect(bal()).toBe(0);
		expect(
			db
				.select()
				.from(schema.starTransactions)
				.all()
				.filter((t) => t.delta < 0)
		).toHaveLength(1);
	});

	it('ignores stars still pending approval when clamping', () => {
		makeJob();
		db.insert(schema.starTransactions)
			.values({ id: 'p', memberId: 'kid', delta: 9, reason: 'chore', status: 'pending' })
			.run();
		expect(judge('2026-03-03')[0].starsRemoved).toBe(0);
	});
});

describe('judgeMissedPeriods: who and what is exempt', () => {
	it('never judges habits, archived jobs, adults or unassigned kids', () => {
		makeJob({ kind: 'habit' });
		const arch = makeJob({ title: 'Old' });
		db.update(schema.chores).set({ archived: true }).where(eqId(arch)).run();
		makeJob({ title: 'Mum only', memberIds: ['mum'] });
		makeJob({ title: 'Nobody', memberIds: [] });
		give(10);
		expect(judge('2026-03-05')).toEqual([]);
		expect(bal()).toBe(10);
	});

	it('does not judge periods before a job was created or before the schedule start', () => {
		makeJob({ title: 'New' }, '2026-03-04');
		makeJob({
			title: 'Later',
			schedule: 'DTSTART:20260304T000000Z\nRRULE:FREQ=DAILY'
		});
		expect(judge('2026-03-05').map((m) => [m.title, m.periodKey])).toEqual([
			['Later', '2026-03-04']
		]);
	});

	it('does not judge history from before the feature first ran or older than 14 days', () => {
		db.delete(schema.settings).run();
		makeJob();
		expect(judge('2026-03-10')).toEqual([]); // first run baselines "today"
		expect(judge('2026-03-11').map((m) => m.periodKey)).toEqual(['2026-03-10']);
		db.delete(schema.settings).run();
		since('2026-01-01');
		const keys = judge('2026-03-30').map((m) => m.periodKey);
		expect(keys[0]).toBe('2026-03-16');
		expect(keys).toHaveLength(14);
	});

	it('recovers from a corrupt baseline setting', () => {
		db.delete(schema.settings).run();
		db.insert(schema.settings).values({ key: MISSED_SINCE_KEY, value: '{oops' }).run();
		makeJob();
		expect(judge('2026-03-10')).toEqual([]);
		db.update(schema.settings).set({ value: '5' }).run();
		expect(judge('2026-03-10')).toEqual([]);
	});

	it('judges only the due days of a weekday schedule', () => {
		makeJob({ title: 'Mon', schedule: 'DTSTART:20260302T000000Z\nRRULE:FREQ=WEEKLY;BYDAY=MO' });
		give(10);
		expect(judge('2026-03-11').map((m) => m.periodKey)).toEqual(['2026-03-02', '2026-03-09']);
	});
});

describe('judgeMissedPeriods: flexible weekly and fortnightly to-dos', () => {
	const flex = (every: 1 | 2, title = 'Room') =>
		makeJob(
			{
				title,
				schedule: `DTSTART:20260302T000000Z\nRRULE:FREQ=WEEKLY;INTERVAL=${every}\nX-HUB-FLEX:1`
			},
			'2026-03-01'
		);

	it('judges a weekly to-do at the end of its Monday to Sunday period, not before', () => {
		flex(1);
		give(10);
		expect(judge('2026-03-08')).toEqual([]); // Sunday: the period is still open
		const [m] = judge('2026-03-09');
		expect(m.periodKey).toBe('flex:2026-03-02');
		expect(m.periodEnd).toBe('2026-03-08');
		expect(bal()).toBe(7);
	});

	it('counts a completion on any day of the period', () => {
		const id = flex(1);
		done(id, '2026-03-07');
		expect(judge('2026-03-09')).toEqual([]);
	});

	it('uses a two-week period, judged once', () => {
		flex(2);
		give(10);
		expect(judge('2026-03-15')).toEqual([]);
		expect(judge('2026-03-16').map((m) => m.periodKey)).toEqual(['flex:2026-03-02']);
		expect(judge('2026-03-16')).toEqual([]);
		expect(bal()).toBe(7);
	});

	it('does not judge the period a job was created in, only later ones', () => {
		makeJob(
			{
				title: 'Mid',
				schedule: 'DTSTART:20260304T000000Z\nRRULE:FREQ=WEEKLY;INTERVAL=1\nX-HUB-FLEX:1'
			},
			'2026-03-04'
		);
		expect(judge('2026-03-09')).toEqual([]);
		expect(judge('2026-03-16').map((m) => m.periodKey)).toEqual(['flex:2026-03-09']);
	});

	it('skips days before the schedule starts', () => {
		makeJob({
			title: 'Future',
			schedule: 'DTSTART:20260316T000000Z\nRRULE:FREQ=WEEKLY;INTERVAL=1\nX-HUB-FLEX:1'
		});
		expect(judge('2026-03-10')).toEqual([]);
	});
});

describe('judgeMissedPeriods: household time zone and DST', () => {
	it('judges a day when it ends locally, not in UTC', () => {
		makeJob();
		give(10);
		const zone = 'America/Los_Angeles';
		// 2026-03-03 06:00 UTC is still 2026-03-02 22:00 in LA: 03-02 has not ended yet.
		expect(judgeMissedPeriods(db, Date.parse('2026-03-03T06:00:00Z'), zone)).toEqual([]);
		// 08:30 UTC is 00:30 on 03-03 in LA: 03-02 ended.
		const m = judgeMissedPeriods(db, Date.parse('2026-03-03T08:30:00Z'), zone);
		expect(m.map((x) => x.periodKey)).toEqual(['2026-03-02']);
	});

	it('does not skip or repeat a day across the spring-forward change', () => {
		makeJob();
		give(20);
		const zone = 'America/Los_Angeles';
		const keys: string[] = [];
		for (const iso of ['2026-03-08T09:00:00Z', '2026-03-09T09:00:00Z', '2026-03-10T09:00:00Z'])
			keys.push(...judgeMissedPeriods(db, Date.parse(iso), zone).map((m) => m.periodKey));
		expect(keys).toEqual([
			'2026-03-02',
			'2026-03-03',
			'2026-03-04',
			'2026-03-05',
			'2026-03-06',
			'2026-03-07',
			'2026-03-08',
			'2026-03-09'
		]);
		expect(new Set(keys).size).toBe(keys.length);
		expect(keys).toContain('2026-03-08');
	});

	it('defaults to the household time zone and the real clock', () => {
		db.delete(schema.settings).run();
		makeJob();
		expect(judgeMissedPeriods(db)).toEqual([]);
	});
});

describe('weekly summary', () => {
	it('shows the deduction under Removed', () => {
		makeJob();
		give(10);
		judge('2026-03-03');
		const week = weeklySummary(db, { week: '2026-03-03', now: noon('2026-03-03'), timeZone: TZ });
		expect(JSON.stringify(week)).toContain('"removed":3');
	});
});
