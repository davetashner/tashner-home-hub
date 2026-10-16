import { mkdirSync } from 'node:fs';
import Database from 'better-sqlite3';

const SOURCE = 'e2e-cal-source';

function localKey(offsetDays: number): { y: number; m: number; d: number } {
	const t = new Date();
	t.setDate(t.getDate() + offsetDays);
	return { y: t.getFullYear(), m: t.getMonth() + 1, d: t.getDate() };
}

/** Local wall-clock time on today+offset, as epoch ms (the browser runs in this machine's zone). */
const at = (offsetDays: number, hour: number, minute = 0) => {
	const { y, m, d } = localKey(offsetDays);
	return new Date(y, m - 1, d, hour, minute).getTime();
};
/** All-day events are stored as UTC midnights of the date; the end is exclusive. */
const day = (offsetDays: number) => {
	const { y, m, d } = localKey(offsetDays);
	return Date.UTC(y, m - 1, d);
};

/**
 * Seeds a synthetic calendar source, three members and a few events straight
 * into the server's SQLite file. `fresh: false` leaves the source stale.
 */
export function seedCalendar(options: { fresh?: boolean } = {}): void {
	mkdirSync('data', { recursive: true });
	const db = new Database('data/hub.db');
	db.pragma('busy_timeout = 5000');
	const member = db.prepare(
		"INSERT OR REPLACE INTO members (id, name, role, color) VALUES (?, ?, 'child', ?)"
	);
	member.run('e2e-cal-m1', 'Avery', 'member-1');
	member.run('e2e-cal-m2', 'Blake', 'member-3');
	member.run('e2e-cal-m3', 'Casey', 'member-5');
	db.prepare('DELETE FROM calendar_sources WHERE id = ?').run(SOURCE);
	db.prepare(
		"INSERT INTO calendar_sources (id, provider, label, calendars, last_sync_at) VALUES (?, 'ics', 'Family', '[]', ?)"
	).run(SOURCE, options.fresh === false ? Date.now() - 42 * 60_000 : Date.now());
	const event = db.prepare(
		`INSERT INTO events (id, source_id, external_id, title, starts_at, ends_at, all_day, location, notes, member_ids)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	);
	const rows: [string, number, number, boolean, string | null, string | null, string[]][] = [
		[
			'Soccer practice',
			at(0, 16),
			at(0, 17, 30),
			false,
			'Maple Park',
			'Bring water.',
			['e2e-cal-m1']
		],
		['Dentist', at(0, 9), at(0, 10), false, null, null, ['e2e-cal-m2', 'e2e-cal-m3']],
		['Grandma visits', day(0), day(2), true, null, null, ['e2e-cal-m3']],
		['School holiday', day(0), day(1), true, null, null, []]
	];
	rows.forEach(([title, s, e, allDay, location, notes, ids], i) => {
		event.run(
			`e2e-cal-ev${i}`,
			SOURCE,
			`ext${i}`,
			title,
			s,
			e,
			allDay ? 1 : 0,
			location,
			notes,
			JSON.stringify(ids)
		);
	});
	db.close();
}
