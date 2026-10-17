/** Picture routines (CHO-13): pure logic for icons, the active window and step progress. */

export const ROUTINE_ICONS = [
	{ key: 'toothbrush', label: 'Brush teeth' },
	{ key: 'shirt', label: 'Get dressed' },
	{ key: 'shoes', label: 'Shoes on' },
	{ key: 'backpack', label: 'Backpack' },
	{ key: 'bed', label: 'Bed' },
	{ key: 'book', label: 'Book' },
	{ key: 'bath', label: 'Bath' },
	{ key: 'hairbrush', label: 'Brush hair' },
	{ key: 'breakfast', label: 'Breakfast' },
	{ key: 'water', label: 'Water' },
	{ key: 'pajamas', label: 'Pajamas' },
	{ key: 'potty', label: 'Potty' },
	{ key: 'star', label: 'Other' }
] as const;

export type RoutineIconKey = (typeof ROUTINE_ICONS)[number]['key'];

export const isRoutineIcon = (v: unknown): v is RoutineIconKey =>
	ROUTINE_ICONS.some((i) => i.key === v);

export const MAX_STEPS = 12;
export const NAME_MAX = 40;
export const LABEL_MAX = 40;

export interface RoutineStep {
	label: string;
	icon: RoutineIconKey;
}

export interface KidRoutine {
	id: string;
	name: string;
	windowStart: string | null;
	windowEnd: string | null;
	steps: RoutineStep[];
	/** Steps finished today. */
	done: number;
}

export function parseMinutes(hhmm: unknown): number | null {
	const m = typeof hhmm === 'string' ? /^(\d{1,2}):(\d{2})$/.exec(hhmm) : null;
	if (!m) return null;
	const h = Number(m[1]);
	const min = Number(m[2]);
	return h < 24 && min < 60 ? h * 60 + min : null;
}

export function minutesInZone(now: number, timeZone: string): number {
	const parts = new Intl.DateTimeFormat('en-GB', {
		timeZone,
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23'
	}).formatToParts(new Date(now));
	const n = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
	return n('hour') * 60 + n('minute');
}

/** Active when there is no (valid) window, or `nowMinutes` falls inside it. Windows may wrap midnight. */
export function isRoutineActive(
	nowMinutes: number,
	start: string | null,
	end: string | null
): boolean {
	const s = parseMinutes(start);
	const e = parseMinutes(end);
	if (s === null || e === null || s === e) return true;
	return s < e ? nowMinutes >= s && nowMinutes < e : nowMinutes >= s || nowMinutes < e;
}

export const activeRoutines = (routines: KidRoutine[], nowMinutes: number): KidRoutine[] =>
	routines.filter(
		(r) =>
			r.steps.length > 0 &&
			isRoutineActive(nowMinutes, r.windowStart, r.windowEnd) &&
			!isRoutineComplete(r.done, r.steps.length)
	);

export const clampDone = (done: unknown, total: number): number =>
	Number.isInteger(done) ? Math.min(Math.max(done as number, 0), total) : 0;

export const isRoutineComplete = (done: number, total: number): boolean =>
	total > 0 && done >= total;

export function currentStep(done: number, total: number): number | null {
	const d = clampDone(done, total);
	return d < total ? d : null;
}

/** Progress after tapping Done on step `index` (taps on past steps never go backwards). */
export function advance(done: number, index: number, total: number): number {
	return clampDone(Math.max(done, index + 1), total);
}

/** Trims and checks a routine body; returns an error message or the clean value. */
export function validateRoutine(input: {
	name: unknown;
	windowStart?: unknown;
	windowEnd?: unknown;
	steps: unknown;
}):
	| { error: string }
	| { name: string; windowStart: string | null; windowEnd: string | null; steps: RoutineStep[] } {
	const text = (v: unknown, max: number) =>
		typeof v === 'string' && v.trim().length >= 1 && v.trim().length <= max ? v.trim() : null;
	const time = (v: unknown) => (v === undefined || v === null || v === '' ? null : v);
	const name = text(input.name, NAME_MAX);
	const [windowStart, windowEnd] = [time(input.windowStart), time(input.windowEnd)];
	const bad = (windowStart === null) !== (windowEnd === null);
	if (!name) return { error: `Name must be 1-${NAME_MAX} characters` };
	if (
		bad ||
		(windowStart !== null &&
			(parseMinutes(windowStart) === null || parseMinutes(windowEnd) === null))
	)
		return { error: 'Give both a start and an end time like 07:30, or neither' };
	if (!Array.isArray(input.steps) || input.steps.length < 1 || input.steps.length > MAX_STEPS)
		return { error: `A routine needs 1-${MAX_STEPS} steps` };
	const steps: RoutineStep[] = [];
	for (const raw of input.steps as Record<string, unknown>[]) {
		const label = text(raw?.label, LABEL_MAX);
		if (!label || !isRoutineIcon(raw.icon))
			return { error: `Each step needs a name (up to ${LABEL_MAX} letters) and a picture` };
		steps.push({ label, icon: raw.icon });
	}
	return {
		name,
		windowStart: windowStart as string | null,
		windowEnd: windowEnd as string | null,
		steps
	};
}

/** True when two ordered step lists are identical (same labels and pictures in the same order). */
export const sameSteps = (a: RoutineStep[], b: RoutineStep[]): boolean =>
	a.length === b.length && a.every((s, i) => s.label === b[i].label && s.icon === b[i].icon);
