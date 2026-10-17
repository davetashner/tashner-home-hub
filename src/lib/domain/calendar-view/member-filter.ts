import type { CalEvent } from './layout.js';

/** Member ids the calendar is narrowed to. Empty means "Everyone" (no filter). */
export type MemberSelection = readonly string[];

/** Reads a saved selection; anything that is not a JSON array of strings means no filter. */
export function parseSelection(raw: string | null | undefined): string[] {
	if (!raw) return [];
	try {
		const value: unknown = JSON.parse(raw);
		if (!Array.isArray(value)) return [];
		return [...new Set(value.filter((v): v is string => typeof v === 'string' && v !== ''))];
	} catch {
		return [];
	}
}

export function serializeSelection(selection: MemberSelection): string {
	return JSON.stringify(selection);
}

/** Adds the member if absent, removes it if present. */
export function toggleMember(selection: MemberSelection, id: string): string[] {
	return selection.includes(id) ? selection.filter((s) => s !== id) : [...selection, id];
}

/** Drops ids of members that no longer exist, so a removed member cannot hide everything. */
export function pruneSelection(selection: MemberSelection, knownIds: Iterable<string>): string[] {
	const known = new Set(knownIds);
	return selection.filter((id) => known.has(id));
}

/**
 * Events shared by several members show if any selected member is on them. With a filter
 * active, events with no member are hidden. No selection returns the events untouched.
 */
export function filterEvents(events: CalEvent[], selection: MemberSelection): CalEvent[] {
	if (selection.length === 0) return events;
	const wanted = new Set(selection);
	return events.filter((ev) => ev.members.some((m) => wanted.has(m.id)));
}
