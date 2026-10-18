/**
 * Tonight's plan for the sitter's wall view (hub-7pj.2): dinner, evening routines, each child's
 * bedtime and the parents coming home, in clock order. Pure: callers pass the clock.
 */
import { isRoutineComplete, parseMinutes, type KidRoutine } from './routines.js';
import { routineColumn } from './kid-chores.js';

/** Dinner has no time in the meal plan: it opens the evening at about this time. */
export const DINNER_MINUTES = 18 * 60;

export type PlanKind = 'dinner' | 'routine' | 'bedtime' | 'pet' | 'home';

export interface PlanItem {
	key: string;
	kind: PlanKind;
	label: string;
	/** Minutes since local midnight, shifted by a day when after midnight. */
	at: number;
	/** Minutes from now until it starts (negative once it has). */
	inMinutes: number;
	/** The routine to open from its Start pill. */
	routineId?: string;
	/** A routine already finished tonight. */
	done?: boolean;
	/** The one the evening is at right now. */
	now: boolean;
}

export interface PlanInput {
	/** Minutes since local midnight, and the clock in epoch ms. */
	nowMinutes: number;
	nowMs: number;
	endAt: number;
	/** The local minutes of `endAt`, and whether it falls on a later day than now. */
	endMinutes: number;
	endsLater: boolean;
	dinner: string | null;
	routines: (KidRoutine & { kidName: string })[];
	bedtimes: { name: string; bedtime: string }[];
	/** Pet feeding times ("HH:MM"), one entry per pet and time. */
	feedings?: { name: string; time: string }[];
	/** "Parent One and Parent Two" or "The grown-ups". */
	parents: string;
}

/** "in 45 min", "in 1 h 20 min", "now", "5 min ago". */
export function countdownLabel(minutes: number): string {
	const m = Math.round(minutes);
	if (m === 0) return 'now';
	const abs = Math.abs(m);
	const text =
		abs < 60 ? `${abs} min` : `${Math.floor(abs / 60)} h${abs % 60 ? ` ${abs % 60} min` : ''}`;
	return m > 0 ? `in ${text}` : `${text} ago`;
}

/** Joins first names for the header: "A", "A and B", "A, B and C". */
export function parentsLabel(names: string[]): string {
	const list = names.map((n) => n.trim()).filter(Boolean);
	if (list.length === 0) return 'The grown-ups';
	if (list.length === 1) return list[0];
	return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

/** Whether the header says "is" or "are" after `parentsLabel`. */
export const parentsVerb = (names: string[]): 'is' | 'are' =>
	names.map((n) => n.trim()).filter(Boolean).length === 1 ? 'is' : 'are';

export function buildPlan(i: PlanInput): PlanItem[] {
	const base = (at: number) => ({ at, inMinutes: at - i.nowMinutes, now: false });
	const items: PlanItem[] = [];
	if (i.dinner) {
		items.push({
			key: 'dinner',
			kind: 'dinner',
			label: `Dinner: ${i.dinner}`,
			...base(DINNER_MINUTES)
		});
	}
	for (const r of i.routines) {
		if (r.steps.length === 0 || routineColumn(r, i.nowMinutes) !== 'evening') continue;
		const at = parseMinutes(r.windowStart) ?? Math.max(i.nowMinutes, DINNER_MINUTES);
		items.push({
			key: `routine-${r.id}`,
			kind: 'routine',
			label: `${r.name} (${r.kidName})`,
			routineId: r.id,
			done: isRoutineComplete(r.done, r.steps.length),
			...base(at)
		});
	}
	for (const b of i.bedtimes) {
		const at = parseMinutes(b.bedtime);
		if (at === null) continue;
		items.push({
			key: `bed-${b.name}`,
			kind: 'bedtime',
			label: `${b.name}'s bedtime`,
			...base(at)
		});
	}
	for (const f of i.feedings ?? []) {
		const at = parseMinutes(f.time);
		if (at === null) continue;
		items.push({
			key: `pet-${f.name}-${f.time}`,
			kind: 'pet',
			label: `Feed ${f.name}`,
			...base(at)
		});
	}
	items.sort((a, b) => a.at - b.at || a.key.localeCompare(b.key));
	// The evening is "at" the last thing that has started; before anything starts, the first.
	const started = items.filter((x) => x.inMinutes <= 0);
	const current = started.length > 0 ? started[started.length - 1] : items[0];
	if (current) current.now = true;
	const homeIn = Math.round((i.endAt - i.nowMs) / 60_000);
	items.push({
		key: 'home',
		kind: 'home',
		label: `${i.parents} home`,
		at: i.endMinutes + (i.endsLater ? 1440 : 0),
		inMinutes: homeIn,
		now: false
	});
	return items;
}
