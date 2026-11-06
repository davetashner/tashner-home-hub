/**
 * The house floor plan for the Network page (NET-2/NET-3): rooms as rectangles in feet on two
 * floors, and where each device sits. Household data: stored only in runtime settings.
 */
import type { DeviceState, NetDevice } from './lan-monitor.js';

/** A listed device joined to its last sweep, as the Network page receives it. */
export type DeviceView = NetDevice & { state: DeviceState | null };

export type Floor = 1 | 2;

export interface Room {
	id: string;
	name: string;
	x: number;
	y: number;
	w: number;
	h: number;
	floor: Floor;
}

export interface Placement {
	id: string;
	x: number;
	y: number;
	floor: Floor;
}

export interface NetLayout {
	rooms: Room[];
	placements: Placement[];
}

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/i;
/** Plenty for a house: coordinates are feet and a room can't be bigger than a field. */
const LIMIT = 500;
const MAX_ROOMS = 120;

const isObj = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);
const coord = (v: unknown): v is number =>
	typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= LIMIT;
const floorOf = (v: unknown): Floor | null => (v === 1 || v === 2 ? v : null);
const half = (v: number) => Math.round(v * 2) / 2;

/**
 * Validates a layout. Accepts the plan builder's export too, where placements are called
 * `devices` and an unplaced device has `x: null`. Bad rows are dropped, not fatal.
 */
export function parseLayout(raw: unknown): NetLayout | null {
	if (!isObj(raw) || !Array.isArray(raw.rooms)) return null;
	const rooms: Room[] = [];
	const ids = new Set<string>();
	for (const r of raw.rooms) {
		if (rooms.length >= MAX_ROOMS) break;
		if (!isObj(r) || typeof r.id !== 'string' || !ID_RE.test(r.id) || ids.has(r.id)) continue;
		const floor = floorOf(r.floor);
		if (!floor || !coord(r.x) || !coord(r.y) || !coord(r.w) || !coord(r.h) || r.w <= 0 || r.h <= 0)
			continue;
		const name = typeof r.name === 'string' && r.name.trim() ? r.name.trim().slice(0, 40) : r.id;
		ids.add(r.id);
		rooms.push({ id: r.id, name, x: half(r.x), y: half(r.y), w: half(r.w), h: half(r.h), floor });
	}
	const list = Array.isArray(raw.placements)
		? raw.placements
		: Array.isArray(raw.devices)
			? raw.devices
			: [];
	const placements: Placement[] = [];
	const seen = new Set<string>();
	for (const p of list) {
		if (!isObj(p) || typeof p.id !== 'string' || !ID_RE.test(p.id) || seen.has(p.id)) continue;
		const floor = floorOf(p.floor);
		if (!floor || !coord(p.x) || !coord(p.y)) continue;
		seen.add(p.id);
		placements.push({ id: p.id, x: half(p.x), y: half(p.y), floor });
	}
	return { rooms, placements };
}

/** The smallest room on `floor` that contains the point, so a closet wins over the house around it. */
export function roomAt(layout: NetLayout, x: number, y: number, floor: Floor): Room | null {
	let best: Room | null = null;
	for (const r of layout.rooms) {
		if (r.floor !== floor || x < r.x || x > r.x + r.w || y < r.y || y > r.y + r.h) continue;
		if (!best || r.w * r.h < best.w * best.h) best = r;
	}
	return best;
}

/** A viewBox that fits every room and placement on both floors, so switching floors never jumps. */
export function planBounds(
	layout: NetLayout,
	pad = 3
): { x: number; y: number; w: number; h: number } {
	const xs: number[] = [];
	const ys: number[] = [];
	for (const r of layout.rooms) {
		xs.push(r.x, r.x + r.w);
		ys.push(r.y, r.y + r.h);
	}
	for (const p of layout.placements) {
		xs.push(p.x);
		ys.push(p.y);
	}
	if (!xs.length) return { x: 0, y: 0, w: 10, h: 10 };
	const x = Math.min(...xs) - pad;
	const y = Math.min(...ys) - pad;
	return { x, y, w: Math.max(...xs) + pad - x, h: Math.max(...ys) + pad - y };
}

export type Tone = 'up' | 'down' | 'stale' | 'unknown';

/** How a device should look. A sweep older than five minutes means the monitor itself stopped. */
export function toneOf(state: DeviceState | null, checkedAt: number | null, now: number): Tone {
	if (!state || state.reach === 'unknown' || checkedAt === null) return 'unknown';
	if (now - checkedAt > 5 * 60_000) return 'stale';
	return state.reach;
}

/** "3 min", "5 h", "12 days": short spans for status lines. */
export function shortSpan(ms: number): string {
	const m = Math.max(0, Math.floor(ms / 60_000));
	if (m < 1) return 'under a minute';
	if (m < 60) return `${m} min`;
	const h = Math.floor(m / 60);
	if (h < 48) return `${h} h`;
	return `${Math.floor(h / 24)} days`;
}

/** One line under a device's name: what state it's in and for how long. */
export function statusLine(
	state: DeviceState | null,
	checkedAt: number | null,
	now: number
): string {
	const tone = toneOf(state, checkedAt, now);
	if (tone === 'unknown' || !state) return 'Not checked yet';
	if (tone === 'stale') return `Last checked ${shortSpan(now - (checkedAt ?? now))} ago`;
	if (tone === 'down') return `Not answering for ${shortSpan(now - state.since)}`;
	const up = state.nest
		? `Up ${shortSpan(state.nest.uptimeS * 1000)}`
		: `Answering for ${shortSpan(now - state.since)}`;
	const restart =
		state.restartedAt && now - state.restartedAt < 24 * 3600_000 ? ' · restarted today' : '';
	return up + restart;
}
