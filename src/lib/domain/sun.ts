/**
 * Sunrise and sunset from coordinates (NOAA solar-position algorithm, good to about a minute).
 * Pure maths: no network, no clock. Same algorithm as the wave background's sunset palette
 * (PR 132); whichever lands second should import this one instead of keeping a copy.
 */

export interface GeoPoint {
	lat: number;
	lon: number;
}

/** The household location (`weather.location`): { lat, lon }, or null when unset or out of range. */
export function parseLocation(v: unknown): GeoPoint | null {
	if (!v || typeof v !== 'object') return null;
	const { lat, lon } = v as Record<string, unknown>;
	if (typeof lat !== 'number' || typeof lon !== 'number') return null;
	if (!(Math.abs(lat) <= 90) || !(Math.abs(lon) <= 180)) return null;
	return { lat, lon };
}

export interface SunTimes {
	/** UTC ms; null when the sun does not rise or set that day. */
	sunrise: number | null;
	sunset: number | null;
	polar: 'day' | 'night' | null;
}

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** Sunrise and sunset for a calendar date (month 1-12) at a place. */
export function sunTimes(p: GeoPoint, year: number, month: number, day: number): SunTimes {
	const midnight = Date.UTC(year, month - 1, day);
	const jd = midnight / 86400000 + 2440587.5 + 0.5 - p.lon / 360;
	const t = (jd - 2451545) / 36525;
	const l0 = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
	const m = rad(357.52911 + t * (35999.05029 - 0.0001537 * t));
	const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
	const c =
		Math.sin(m) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
		Math.sin(2 * m) * (0.019993 - 0.000101 * t) +
		Math.sin(3 * m) * 0.000289;
	const omega = rad(125.04 - 1934.136 * t);
	const lambda = rad(l0 + c - 0.00569 - 0.00478 * Math.sin(omega));
	const eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
	const eps = rad(eps0 + 0.00256 * Math.cos(omega));
	const decl = Math.asin(Math.sin(eps) * Math.sin(lambda));
	const y = Math.tan(eps / 2) ** 2;
	const l0r = rad(l0);
	const eqTime =
		4 *
		deg(
			y * Math.sin(2 * l0r) -
				2 * e * Math.sin(m) +
				4 * e * y * Math.sin(m) * Math.cos(2 * l0r) -
				0.5 * y * y * Math.sin(4 * l0r) -
				1.25 * e * e * Math.sin(2 * m)
		);
	const lat = rad(p.lat);
	const cosHa =
		Math.cos(rad(90.833)) / (Math.cos(lat) * Math.cos(decl)) - Math.tan(lat) * Math.tan(decl);
	if (cosHa > 1) return { sunrise: null, sunset: null, polar: 'night' };
	if (cosHa < -1) return { sunrise: null, sunset: null, polar: 'day' };
	const ha = deg(Math.acos(cosHa));
	const noon = 720 - 4 * p.lon - eqTime;
	return {
		sunrise: midnight + (noon - 4 * ha) * 60000,
		sunset: midnight + (noon + 4 * ha) * 60000,
		polar: null
	};
}
