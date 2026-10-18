/**
 * Yearly album windows: an album that only shows between two calendar days each year (e.g. ten
 * days either side of an anniversary). While any window is open the frame shows only those albums.
 */

/** Month and day, `MM-DD`. */
export type MonthDay = string;

export interface AlbumWindow {
	from: MonthDay;
	to: MonthDay;
}

export type AlbumWindows = Record<string, AlbumWindow>;

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** A real calendar day (Feb 29 allowed: it simply only matches in leap years). */
export function isMonthDay(v: unknown): v is MonthDay {
	if (typeof v !== 'string' || !/^\d{2}-\d{2}$/.test(v)) return false;
	const month = Number(v.slice(0, 2));
	const day = Number(v.slice(3));
	return month >= 1 && month <= 12 && day >= 1 && day <= DAYS_IN_MONTH[month - 1]!;
}

function isWindow(v: unknown): v is AlbumWindow {
	if (typeof v !== 'object' || v === null) return false;
	const w = v as Record<string, unknown>;
	return isMonthDay(w.from) && isMonthDay(w.to);
}

/** Lenient read of stored config: anything malformed is dropped. */
export function parseWindows(v: unknown): AlbumWindows {
	if (typeof v !== 'object' || v === null || Array.isArray(v)) return {};
	const out: AlbumWindows = {};
	for (const [album, w] of Object.entries(v))
		if (isWindow(w)) out[album] = { from: w.from, to: w.to };
	return out;
}

/**
 * Applies a PATCH `{ [album]: { from, to } | null }` onto the stored windows (null clears one).
 * Returns an error message for bad input.
 */
export function patchWindows(current: AlbumWindows, patch: unknown): AlbumWindows | string {
	if (typeof patch !== 'object' || patch === null || Array.isArray(patch))
		return 'windows must be an object of album name to { from, to }';
	const next = { ...current };
	for (const [album, w] of Object.entries(patch)) {
		if (!album) return 'windows needs album names';
		if (w === null) delete next[album];
		else if (isWindow(w)) next[album] = { from: w.from, to: w.to };
		else return 'each window needs from and to as MM-DD';
	}
	return next;
}

/** Inclusive at both ends; a window whose end comes before its start wraps the new year. */
export function isWindowOpen(w: AlbumWindow, today: MonthDay): boolean {
	return w.from <= w.to ? today >= w.from && today <= w.to : today >= w.from || today <= w.to;
}

export interface AlbumRules {
	/** The album checkbox selection (empty = every album). */
	selected: (album: string) => boolean;
	windows: AlbumWindows;
}

/** True when any selected album's window is open today: those albums take over the frame. */
export function anyWindowOpen(sources: AlbumRules[], today: MonthDay): boolean {
	return sources.some((s) =>
		Object.entries(s.windows).some(([album, w]) => s.selected(album) && isWindowOpen(w, today))
	);
}

/**
 * Whether an album shows today. A windowed album shows only inside its window; the others show
 * only while no window is open anywhere. Unticked albums never show.
 */
export function albumShows(
	album: string,
	rules: AlbumRules,
	today: MonthDay,
	takeover: boolean
): boolean {
	if (!rules.selected(album)) return false;
	const w = rules.windows[album];
	return w ? isWindowOpen(w, today) : !takeover;
}
