/** Pure weather helpers: Open-Meteo parsing, WMO code mapping, cache freshness (WX-1, PHO-7). */

export type WeatherUnit = 'F' | 'C';

export interface WeatherLocation {
	lat: number;
	lon: number;
	/** Display label only, e.g. "Springfield, Illinois". */
	name: string;
	unit: WeatherUnit;
}

export interface WeatherCurrent {
	temp: number;
	feelsLike: number;
	wind: number;
	code: number;
	isDay: boolean;
}

export interface WeatherDay {
	/** Local date, YYYY-MM-DD, in the forecast location's zone. */
	date: string;
	code: number;
	high: number;
	low: number;
	/** Chance of precipitation, 0 to 100, or null when unknown. */
	precip: number | null;
}

export interface WeatherSnapshot {
	unit: WeatherUnit;
	current: WeatherCurrent;
	days: WeatherDay[];
	/** Epoch ms of the successful fetch. */
	fetchedAt: number;
}

export interface WeatherCondition {
	label: string;
	icon: string;
}

/** Refresh when older than this. */
export const WEATHER_TTL_MS = 20 * 60 * 1000;
/** After this long without a refresh the widget marks the data as out of date. */
export const WEATHER_STALE_MS = 3 * 60 * 60 * 1000;

const CONDITIONS: Record<number, WeatherCondition> = {
	0: { label: 'Clear', icon: '☀️' },
	1: { label: 'Mostly clear', icon: '🌤️' },
	2: { label: 'Partly cloudy', icon: '⛅' },
	3: { label: 'Overcast', icon: '☁️' },
	45: { label: 'Fog', icon: '🌫️' },
	48: { label: 'Freezing fog', icon: '🌫️' },
	51: { label: 'Light drizzle', icon: '🌦️' },
	53: { label: 'Drizzle', icon: '🌦️' },
	55: { label: 'Heavy drizzle', icon: '🌧️' },
	56: { label: 'Freezing drizzle', icon: '🌧️' },
	57: { label: 'Freezing drizzle', icon: '🌧️' },
	61: { label: 'Light rain', icon: '🌦️' },
	63: { label: 'Rain', icon: '🌧️' },
	65: { label: 'Heavy rain', icon: '🌧️' },
	66: { label: 'Freezing rain', icon: '🌧️' },
	67: { label: 'Freezing rain', icon: '🌧️' },
	71: { label: 'Light snow', icon: '🌨️' },
	73: { label: 'Snow', icon: '❄️' },
	75: { label: 'Heavy snow', icon: '❄️' },
	77: { label: 'Snow grains', icon: '🌨️' },
	80: { label: 'Light showers', icon: '🌦️' },
	81: { label: 'Showers', icon: '🌧️' },
	82: { label: 'Heavy showers', icon: '🌧️' },
	85: { label: 'Snow showers', icon: '🌨️' },
	86: { label: 'Heavy snow showers', icon: '❄️' },
	95: { label: 'Thunderstorm', icon: '⛈️' },
	96: { label: 'Thunderstorm, hail', icon: '⛈️' },
	99: { label: 'Thunderstorm, hail', icon: '⛈️' }
};

/** Maps a WMO weather code to a label and icon. Clear nights get a moon. Unknown codes degrade. */
export function describeWeather(code: number, isDay = true): WeatherCondition {
	const found = CONDITIONS[code];
	if (!found) return { label: 'Unknown', icon: '🌡️' };
	if (!isDay && code === 0) return { label: 'Clear', icon: '🌙' };
	if (!isDay && (code === 1 || code === 2)) return { label: found.label, icon: '☁️' };
	return found;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Validates a saved or submitted location. Returns null when it is not usable. */
export function parseLocation(raw: unknown): WeatherLocation | null {
	if (!raw || typeof raw !== 'object') return null;
	const o = raw as Record<string, unknown>;
	const lat = typeof o.lat === 'string' && o.lat.trim() !== '' ? Number(o.lat) : o.lat;
	const lon = typeof o.lon === 'string' && o.lon.trim() !== '' ? Number(o.lon) : o.lon;
	if (!isNum(lat) || !isNum(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
	const name = typeof o.name === 'string' ? o.name.trim().slice(0, 80) : '';
	return {
		lat: Math.round(lat * 1000) / 1000,
		lon: Math.round(lon * 1000) / 1000,
		name,
		unit: o.unit === 'C' ? 'C' : 'F'
	};
}

/** The Open-Meteo forecast URL for a location. Keyless. */
export function forecastUrl(loc: WeatherLocation): string {
	const q = new URLSearchParams({
		latitude: String(loc.lat),
		longitude: String(loc.lon),
		current: 'temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m',
		daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
		forecast_days: '5',
		timezone: 'auto',
		temperature_unit: loc.unit === 'C' ? 'celsius' : 'fahrenheit',
		wind_speed_unit: loc.unit === 'C' ? 'kmh' : 'mph'
	});
	return `https://api.open-meteo.com/v1/forecast?${q}`;
}

/** Turns an Open-Meteo forecast response into a snapshot, or null when it is malformed. */
export function parseForecast(
	raw: unknown,
	unit: WeatherUnit,
	fetchedAt: number
): WeatherSnapshot | null {
	if (!raw || typeof raw !== 'object') return null;
	const r = raw as { current?: Record<string, unknown>; daily?: Record<string, unknown> };
	const c = r.current;
	const d = r.daily;
	if (!c || !d) return null;
	if (!isNum(c.temperature_2m) || !isNum(c.weather_code)) return null;
	const times = d.time;
	const codes = d.weather_code;
	const highs = d.temperature_2m_max;
	const lows = d.temperature_2m_min;
	if (!Array.isArray(times) || !Array.isArray(codes) || !Array.isArray(highs)) return null;
	if (!Array.isArray(lows)) return null;
	const precips = Array.isArray(d.precipitation_probability_max)
		? d.precipitation_probability_max
		: [];
	const days: WeatherDay[] = [];
	for (let i = 0; i < times.length && days.length < 5; i++) {
		const date: unknown = times[i];
		if (typeof date !== 'string' || !isNum(codes[i]) || !isNum(highs[i]) || !isNum(lows[i]))
			continue;
		const p: unknown = precips[i];
		days.push({
			date,
			code: codes[i],
			high: Math.round(highs[i]),
			low: Math.round(lows[i]),
			precip: isNum(p) ? Math.round(p) : null
		});
	}
	if (days.length === 0) return null;
	return {
		unit,
		fetchedAt,
		current: {
			temp: Math.round(c.temperature_2m),
			feelsLike: Math.round(
				isNum(c.apparent_temperature) ? c.apparent_temperature : c.temperature_2m
			),
			wind: Math.round(isNum(c.wind_speed_10m) ? c.wind_speed_10m : 0),
			code: c.weather_code,
			isDay: c.is_day !== 0
		},
		days
	};
}

export interface GeoResult {
	lat: number;
	lon: number;
	name: string;
}

/** Parses an Open-Meteo geocoding response into pickable places. */
export function parseGeocoding(raw: unknown): GeoResult[] {
	const results = (raw as { results?: unknown } | null)?.results;
	if (!Array.isArray(results)) return [];
	const out: GeoResult[] = [];
	for (const item of results) {
		const o = (item ?? {}) as Record<string, unknown>;
		if (!isNum(o.latitude) || !isNum(o.longitude) || typeof o.name !== 'string') continue;
		const parts = [o.name, o.admin1, o.country].filter(
			(p): p is string => typeof p === 'string' && p !== ''
		);
		out.push({ lat: o.latitude, lon: o.longitude, name: parts.join(', ') });
	}
	return out;
}

/** True when the cached snapshot should be refreshed. */
export function needsRefresh(
	snap: Pick<WeatherSnapshot, 'fetchedAt' | 'unit'> | null,
	loc: WeatherLocation,
	now: number
): boolean {
	if (!snap) return true;
	if (snap.unit !== loc.unit) return true;
	return now - snap.fetchedAt >= WEATHER_TTL_MS || snap.fetchedAt > now;
}

/** True when the data is old enough that the widget should say so. */
export function isOutOfDate(snap: Pick<WeatherSnapshot, 'fetchedAt'>, now: number): boolean {
	return now - snap.fetchedAt >= WEATHER_STALE_MS;
}

/** Short day label from a YYYY-MM-DD date: "Today" for index 0, else "Mon". */
export function dayLabel(date: string, index: number): string {
	if (index === 0) return 'Today';
	const [y, m, d] = date.split('-').map(Number);
	if (!y || !m || !d) return date;
	return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
		weekday: 'short',
		timeZone: 'UTC'
	});
}

export const unitSymbol = (unit: WeatherUnit): string => (unit === 'C' ? '°C' : '°F');
