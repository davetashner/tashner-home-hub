import { eq } from 'drizzle-orm';
import { getDb, schema } from '#lib/server/db/index.js';
import {
	APPEARANCE_KEY,
	appearanceAt,
	resolveAppearance,
	type Appearance
} from '#lib/domain/appearance.js';
import type { GeoPoint } from '#lib/domain/sun.js';
import type { SleepSchedule } from '#lib/domain/display-power.js';
import { readSleepSchedule } from '#lib/server/display.js';
import { householdTimeZone } from '#lib/server/household.js';
import { readWeatherLocation } from '#lib/server/weather.js';

export function readAppearance(): Appearance {
	const row = getDb()
		.select()
		.from(schema.settings)
		.where(eq(schema.settings.key, APPEARANCE_KEY))
		.get();
	try {
		return resolveAppearance(row ? JSON.parse(row.value) : undefined);
	} catch {
		return resolveAppearance(undefined);
	}
}

export function writeAppearance(a: Appearance): void {
	const value = JSON.stringify(a);
	getDb()
		.insert(schema.settings)
		.values({ key: APPEARANCE_KEY, value })
		.onConflictDoUpdate({ target: schema.settings.key, set: { value, updatedAt: Date.now() } })
		.run();
}

export interface AppearanceData {
	appearance: Appearance;
	schedule: SleepSchedule;
	/** Coordinates only (never the place name); null while weather is off. */
	location: GeoPoint | null;
}

/** What the browser needs to pick the theme and dim factor itself, once a minute. */
export function readAppearanceData(): AppearanceData {
	const loc = readWeatherLocation(getDb());
	return {
		appearance: readAppearance(),
		schedule: readSleepSchedule(),
		location: loc ? { lat: loc.lat, lon: loc.lon } : null
	};
}

/** The theme to render on the server, so a reload at night never flashes light. */
export function serverTheme(now = Date.now()): 'light' | 'night' {
	const d = readAppearanceData();
	return appearanceAt(now, householdTimeZone(getDb()), d.appearance, d.schedule, d.location, false)
		.theme;
}
