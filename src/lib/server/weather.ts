import { eq } from 'drizzle-orm';
import { Cron } from 'croner';
import { getDb, type Db } from './db/index.js';
import { settings } from './db/schema.js';
import {
	forecastUrl,
	needsRefresh,
	parseForecast,
	parseGeocoding,
	parseLocation,
	type GeoResult,
	type WeatherLocation,
	type WeatherSnapshot
} from '#lib/domain/weather.js';

const LOCATION_KEY = 'weather.location';
const CACHE_KEY = 'weather.cache';
const TIMEOUT_MS = 8000;

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

function readJsonSetting(db: Db, key: string): unknown {
	const row = db.select().from(settings).where(eq(settings.key, key)).get();
	if (!row) return null;
	try {
		return JSON.parse(row.value);
	} catch {
		return null;
	}
}

function writeJsonSetting(db: Db, key: string, value: unknown): void {
	const json = JSON.stringify(value);
	db.insert(settings)
		.values({ key, value: json })
		.onConflictDoUpdate({ target: settings.key, set: { value: json, updatedAt: Date.now() } })
		.run();
}

/** The household location, or null while weather is off. */
export function readWeatherLocation(db: Db): WeatherLocation | null {
	return parseLocation(readJsonSetting(db, LOCATION_KEY));
}

/** Saves the location (and unit); drops the cache so the next read refetches. */
export function saveWeatherLocation(db: Db, raw: unknown): WeatherLocation | null {
	const loc = parseLocation(raw);
	if (!loc) return null;
	writeJsonSetting(db, LOCATION_KEY, loc);
	db.delete(settings).where(eq(settings.key, CACHE_KEY)).run();
	return loc;
}

/** Turns weather off by forgetting the location and cache. */
export function clearWeatherLocation(db: Db): void {
	db.delete(settings).where(eq(settings.key, LOCATION_KEY)).run();
	db.delete(settings).where(eq(settings.key, CACHE_KEY)).run();
}

function readCache(db: Db, loc: WeatherLocation): WeatherSnapshot | null {
	const raw = readJsonSetting(db, CACHE_KEY) as {
		lat?: number;
		lon?: number;
		snapshot?: WeatherSnapshot;
	} | null;
	if (!raw?.snapshot || raw.lat !== loc.lat || raw.lon !== loc.lon) return null;
	return raw.snapshot;
}

async function getJson(url: string, doFetch: Fetch): Promise<unknown> {
	const res = await doFetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
	if (!res.ok) throw new Error(`weather HTTP ${res.status}`);
	return res.json();
}

/** Fetches fresh data and stores it. Resolves to the new snapshot, or null on any failure. */
export async function refreshWeather(
	db: Db,
	doFetch: Fetch = fetch,
	now = Date.now()
): Promise<WeatherSnapshot | null> {
	const loc = readWeatherLocation(db);
	if (!loc) return null;
	try {
		const snap = parseForecast(await getJson(forecastUrl(loc), doFetch), loc.unit, now);
		if (!snap) return null;
		writeJsonSetting(db, CACHE_KEY, { lat: loc.lat, lon: loc.lon, snapshot: snap });
		return snap;
	} catch {
		return null; // offline: the last good snapshot keeps being served
	}
}

let inflight: Promise<unknown> | null = null;

export interface WeatherView {
	location: { name: string; unit: WeatherLocation['unit'] };
	snapshot: WeatherSnapshot | null;
}

/**
 * What the widget shows. Never waits on the network: returns the cached snapshot at once
 * and kicks off a background refresh when it is stale. Null while no location is set.
 */
export function getWeather(db: Db, doFetch: Fetch = fetch, now = Date.now()): WeatherView | null {
	const loc = readWeatherLocation(db);
	if (!loc) return null;
	const snapshot = readCache(db, loc);
	if (needsRefresh(snapshot, loc, now) && !inflight) {
		const p = refreshWeather(db, doFetch, now).finally(() => {
			if (inflight === p) inflight = null;
		});
		inflight = p;
	}
	return { location: { name: loc.name, unit: loc.unit }, snapshot };
}

/** Place search through Open-Meteo's keyless geocoder. Empty on failure. */
export async function searchPlaces(query: string, doFetch: Fetch = fetch): Promise<GeoResult[]> {
	const q = query.trim().slice(0, 80);
	if (q.length < 2) return [];
	try {
		const url = `https://geocoding-api.open-meteo.com/v1/search?${new URLSearchParams({ name: q, count: '6', language: 'en' })}`;
		return parseGeocoding(await getJson(url, doFetch));
	} catch {
		return [];
	}
}

/** Every 20 minutes, keeps the cache warm so the first page load after a gap is fresh. */
export function startWeatherScheduler(env: NodeJS.ProcessEnv = process.env): Cron | undefined {
	if (env.HUB_WEATHER === 'off') return undefined;
	const tick = () => void refreshWeather(getDb()).catch(() => undefined);
	return new Cron('*/20 * * * *', { protect: true, catch: true }, tick);
}
