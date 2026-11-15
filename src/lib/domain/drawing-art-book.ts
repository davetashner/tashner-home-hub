/**
 * Each kid's art book (hub-t27j.15): a kid's posted drawings grouped by month, and the pairs the
 * "Then and now" compare view shows side by side. Pure so the component only wires taps.
 */

/** One posted drawing as /api/drawings/posted serves it. */
export interface ArtEntry {
	id: string;
	/** Epoch ms the drawing was posted. */
	createdAt: number;
	/** URL of the PNG, served by this server. */
	src: string;
}

export interface ArtMonth {
	/** `YYYY-MM`, sorts the same as time. */
	key: string;
	label: string;
	/** Newest first. */
	entries: ArtEntry[];
}

const isEntry = (v: unknown): v is ArtEntry =>
	typeof v === 'object' &&
	v !== null &&
	typeof (v as ArtEntry).id === 'string' &&
	(v as ArtEntry).id !== '' &&
	Number.isFinite((v as ArtEntry).createdAt) &&
	typeof (v as ArtEntry).src === 'string' &&
	(v as ArtEntry).src.startsWith('/');

/** The valid entries of a server answer; anything malformed is dropped rather than shown broken. */
export function parseArtEntries(raw: unknown): ArtEntry[] {
	if (!Array.isArray(raw)) return [];
	return raw.filter(isEntry).map(({ id, createdAt, src }) => ({ id, createdAt, src }));
}

function parts(ms: number, timeZone?: string): { y: number; m: number } {
	const f = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'numeric', timeZone });
	const p = f.formatToParts(new Date(ms));
	const get = (t: string) => Number(p.find((x) => x.type === t)?.value);
	return { y: get('year'), m: get('month') };
}

export function monthKey(ms: number, timeZone?: string): string {
	const { y, m } = parts(ms, timeZone);
	return `${y}-${String(m).padStart(2, '0')}`;
}

const NAMES = [
	'January',
	'February',
	'March',
	'April',
	'May',
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December'
];

/** "March 2026" for a `YYYY-MM` key. */
export function monthLabel(key: string): string {
	const [y, m] = key.split('-');
	return `${NAMES[Number(m) - 1] ?? key} ${y}`;
}

/** Months with drawings, newest month first and newest drawing first within it. */
export function groupByMonth(entries: readonly ArtEntry[], timeZone?: string): ArtMonth[] {
	const by = new Map<string, ArtEntry[]>();
	for (const e of [...entries].sort((a, b) => b.createdAt - a.createdAt)) {
		const k = monthKey(e.createdAt, timeZone);
		by.set(k, [...(by.get(k) ?? []), e]);
	}
	return [...by.entries()]
		.sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
		.map(([key, list]) => ({ key, label: monthLabel(key), entries: list }));
}

/** The starting compare pair: the earliest drawing and the latest. Null with fewer than two drawings. */
export function thenAndNow(entries: readonly ArtEntry[]): { then: ArtEntry; now: ArtEntry } | null {
	if (entries.length < 2) return null;
	const sorted = [...entries].sort((a, b) => a.createdAt - b.createdAt);
	return { then: sorted[0], now: sorted[sorted.length - 1] };
}

/**
 * A month shown on one side of the compare view: the "then" side shows the month's first
 * drawing and the "now" side its latest, so a month against itself still compares.
 */
export function pick(month: ArtMonth | undefined, side: 'then' | 'now'): ArtEntry | null {
	if (!month || month.entries.length === 0) return null;
	return side === 'now' ? month.entries[0] : month.entries[month.entries.length - 1];
}

/** The month `step` places along `months` (newest first) from `key`, stopping at the ends. */
export function stepMonth(months: readonly ArtMonth[], key: string, step: 1 | -1): string {
	const i = months.findIndex((m) => m.key === key);
	if (i < 0) return months[0]?.key ?? key;
	return months[Math.min(months.length - 1, Math.max(0, i + step))].key;
}
