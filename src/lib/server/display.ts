import { eq } from 'drizzle-orm';
import { getDb, schema } from '#lib/server/db/index.js';
import { ROTATION_KEY, resolveRotation, type Rotation } from '#lib/domain/orientation.js';
import {
	SLEEP_NOW_KEY,
	SLEEP_SCHEDULE_KEY,
	WAKE_KEY,
	displayPower,
	resolveSleepSchedule,
	type DisplayPower,
	type SleepSchedule
} from '#lib/domain/display-power.js';
import {
	NIGHT_CLOCK_KEY,
	displayMode,
	resolveNightClock,
	type DisplayMode
} from '#lib/domain/night-clock.js';
import { householdTimeZone } from '#lib/server/household.js';

/** The stored display rotation; landscape ("normal") until a grown-up changes it. */
export function readRotation(): Rotation {
	const row = getDb()
		.select()
		.from(schema.settings)
		.where(eq(schema.settings.key, ROTATION_KEY))
		.get();
	if (!row) return resolveRotation(undefined);
	try {
		return resolveRotation(JSON.parse(row.value));
	} catch {
		return resolveRotation(undefined);
	}
}

export function writeRotation(rotation: Rotation): void {
	const value = JSON.stringify(rotation);
	getDb()
		.insert(schema.settings)
		.values({ key: ROTATION_KEY, value })
		.onConflictDoUpdate({ target: schema.settings.key, set: { value, updatedAt: Date.now() } })
		.run();
}

function readSetting(key: string): unknown {
	const row = getDb().select().from(schema.settings).where(eq(schema.settings.key, key)).get();
	if (!row) return undefined;
	try {
		return JSON.parse(row.value);
	} catch {
		return undefined;
	}
}

function writeSetting(key: string, data: unknown): void {
	const value = JSON.stringify(data);
	getDb()
		.insert(schema.settings)
		.values({ key, value })
		.onConflictDoUpdate({ target: schema.settings.key, set: { value, updatedAt: Date.now() } })
		.run();
}

export const readSleepSchedule = (): SleepSchedule =>
	resolveSleepSchedule(readSetting(SLEEP_SCHEDULE_KEY));

export const writeSleepSchedule = (schedule: SleepSchedule): void =>
	writeSetting(SLEEP_SCHEDULE_KEY, schedule);

const asTime = (v: unknown): number | null => (typeof v === 'number' && v > 0 ? v : null);

export function currentDisplayPower(now = Date.now()): DisplayPower {
	return displayPower(now, householdTimeZone(getDb()), readSleepSchedule(), {
		sleepNowAt: asTime(readSetting(SLEEP_NOW_KEY)),
		wakeAt: asTime(readSetting(WAKE_KEY))
	});
}

export function recordPowerEvent(kind: 'sleep' | 'wake', now = Date.now()): DisplayPower {
	writeSetting(kind === 'sleep' ? SLEEP_NOW_KEY : WAKE_KEY, now);
	return currentDisplayPower(now);
}

export const readNightClock = (): boolean => resolveNightClock(readSetting(NIGHT_CLOCK_KEY));

export const writeNightClock = (enabled: boolean): void =>
	writeSetting(NIGHT_CLOCK_KEY, { enabled });

export interface DisplayState extends DisplayPower {
	mode: DisplayMode;
}

/**
 * What the Pi agent and the wall UI act on (SLP-4): with night clock on, a scheduled night keeps
 * the monitor powered ("on") and the UI shows the dim clock; the agent needs no change.
 */
export function currentDisplayState(now = Date.now()): DisplayState {
	const power = currentDisplayPower(now);
	const mode = displayMode(power, readNightClock());
	return { ...power, power: mode === 'off' ? 'off' : 'on', mode };
}
