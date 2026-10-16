export type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'anytime';
export type Status = 'none' | 'pending' | 'approved' | 'rejected' | 'undone';

export interface KidChore {
	id: string;
	title: string;
	icon: string | null;
	stars: number;
	status: Status;
	completionId: string | null;
}

export interface KidGroup {
	timeOfDay: TimeOfDay;
	chores: KidChore[];
}

/** How long a kid can take a tap back (matches KID_UNDO_WINDOW_MS on the server). */
export const UNDO_WINDOW_MS = 10_000;
export const MAX_JAR_SLOTS = 24;

export const GROUP_HEADINGS: Record<TimeOfDay, { emoji: string; label: string }> = {
	morning: { emoji: '🌅', label: 'This morning' },
	afternoon: { emoji: '☀️', label: 'This afternoon' },
	evening: { emoji: '🌙', label: 'Tonight' },
	anytime: { emoji: '⭐', label: 'Anytime today' }
};

/** The local calendar day (YYYY-MM-DD) for an instant in an IANA time zone. */
export function localDate(now: number, timeZone: string): string {
	return new Intl.DateTimeFormat('en-CA', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).format(new Date(now));
}

export function isDoable(status: Status): boolean {
	return status === 'none' || status === 'rejected' || status === 'undone';
}

function mapChore(groups: KidGroup[], choreId: string, fn: (c: KidChore) => KidChore): KidGroup[] {
	return groups.map((g) => ({
		...g,
		chores: g.chores.map((c) => (c.id === choreId ? fn(c) : c))
	}));
}

export function setStatus(
	groups: KidGroup[],
	choreId: string,
	status: Status,
	completionId: string | null
): KidGroup[] {
	return mapChore(groups, choreId, (c) => ({ ...c, status, completionId }));
}

export function undoSecondsLeft(startedAt: number, now: number): number {
	return Math.max(0, Math.ceil((UNDO_WINDOW_MS - (now - startedAt)) / 1000));
}

export interface JarSlots {
	total: number;
	gold: number;
	pending: number;
}

export function jarSlots(balance: number, pending: number, goalCost: number | null): JarSlots {
	const b = Math.max(0, Math.floor(balance));
	const p = Math.max(0, Math.floor(pending));
	const wanted = goalCost && goalCost > 0 ? goalCost : Math.ceil((b + p) / 5) * 5;
	const total = Math.min(MAX_JAR_SLOTS, Math.max(10, wanted));
	const gold = Math.min(b, total);
	return { total, gold, pending: Math.min(p, total - gold) };
}

/** Members worth showing: those with chores today; if nobody has any, everyone. */
export function switcherMembers<T extends { id: string }>(
	members: T[],
	boards: Record<string, KidGroup[]>
): T[] {
	const withChores = members.filter((m) => (boards[m.id]?.length ?? 0) > 0);
	return withChores.length > 0 ? withChores : members;
}
