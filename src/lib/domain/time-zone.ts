/**
 * Household time zone: the one zone that decides what "today" is for chores and where floating
 * calendar times sit. The wall's browser and the server container may run in other zones, so
 * this setting is the source of truth. Pure: no storage or clock access.
 */

export const HOUSEHOLD_TZ_KEY = 'household.timeZone';

/** IANA names only ("America/Chicago", "Etc/GMT+5", "UTC"); no raw offsets like "+05:00". */
const NAME_RE = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/;

/** The canonical spelling of an IANA zone name, or null when it is not one. */
export function canonicalZone(value: unknown): string | null {
	if (typeof value !== 'string' || value.length > 64 || !NAME_RE.test(value)) return null;
	try {
		return new Intl.DateTimeFormat('en-US', { timeZone: value }).resolvedOptions().timeZone;
	} catch {
		return null;
	}
}

export const isTimeZone = (value: unknown): value is string => canonicalZone(value) !== null;

/** This runtime's own zone (the server container's, or the kiosk browser's). */
export const runtimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * The zone to use before a grown-up picks one: the `TZ` environment variable (POSIX allows a
 * leading colon), else the runtime's zone, else UTC.
 */
export function defaultTimeZone(env?: string, system: () => string = runtimeZone): string {
	return canonicalZone(env?.replace(/^:/, '')) ?? canonicalZone(system()) ?? 'UTC';
}

/** A stored setting wins when valid; anything else falls back to the default. */
export function resolveTimeZone(stored: unknown, fallback: string): string {
	return canonicalZone(stored) ?? fallback;
}

/** Zones a family is likely to want, shown before anything is typed. */
export const COMMON_ZONES = [
	'America/New_York',
	'America/Chicago',
	'America/Denver',
	'America/Phoenix',
	'America/Los_Angeles',
	'America/Anchorage',
	'Pacific/Honolulu',
	'America/Toronto',
	'Europe/London',
	'Europe/Paris',
	'Asia/Tokyo',
	'Australia/Sydney',
	'UTC'
] as const;

/** Every zone the runtime knows, sorted, always including UTC. */
export function listTimeZones(
	supported: () => string[] = () => Intl.supportedValuesOf('timeZone')
): string[] {
	let zones: string[];
	try {
		zones = supported();
	} catch {
		zones = [...COMMON_ZONES];
	}
	return [...new Set([...zones, 'UTC'])].sort();
}

const words = (s: string) => s.toLowerCase().replace(/[_/]+/g, ' ');

/** Zones whose name contains every typed word ("new york", "chicago", "europe par"). */
export function searchZones(zones: readonly string[], query: string, limit = 40): string[] {
	const terms = words(query).split(/\s+/).filter(Boolean);
	if (terms.length === 0) return COMMON_ZONES.filter((z) => zones.includes(z)).slice(0, limit);
	return zones.filter((z) => terms.every((t) => words(z).includes(t))).slice(0, limit);
}

/** "America/Argentina/Buenos_Aires" -> { city: "Buenos Aires", region: "America · Argentina" }. */
export function zoneLabel(zone: string): { city: string; region: string } {
	const parts = zone.split('/').map((p) => p.replace(/_/g, ' '));
	const city = parts.pop() ?? zone;
	return { city, region: parts.join(' · ') };
}

/** "UTC−5", "UTC+5:30" or "UTC" for a zone at an instant (DST-aware). */
export function offsetLabel(zone: string, now: number): string {
	const name =
		new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' })
			.formatToParts(new Date(now))
			.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
	return name
		.replace(/^GMT([+-]0)?$/, 'UTC')
		.replace('GMT', 'UTC')
		.replace('-', '−');
}
