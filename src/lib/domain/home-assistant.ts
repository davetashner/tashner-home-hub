/**
 * Home Assistant controls (hub-6pv.2): which entities the wall shows, and how a state
 * list from HA maps to tiles. Pure; the HTTP calls live in `server/home-assistant`.
 */

/** Domains an adult can tap (service calls). Anything else is read-only. */
export const CONTROL_DOMAINS = ['light', 'switch', 'scene'] as const;
/** Read-only domains: sensor values and door/window contacts. Never sent a service call. */
export const SENSOR_DOMAINS = ['sensor', 'binary_sensor'] as const;
export const HA_DOMAINS = [...CONTROL_DOMAINS, ...SENSOR_DOMAINS] as const;
export type HaDomain = (typeof HA_DOMAINS)[number];

/** sensor.* device classes the picker offers (value + unit). */
export const SENSOR_CLASSES = ['temperature', 'humidity'] as const;
/** binary_sensor.* device classes shown as Open/Closed. */
export const CONTACT_CLASSES = ['door', 'window', 'opening', 'garage_door'] as const;
/** A value-sensor that has not reported for this long reads as stale. */
export const STALE_MS = 6 * 60 * 60 * 1000;

/** Most tiles one household can pin (keeps the Home card and the payloads small). */
export const MAX_TILES = 24;

/** An entity an adult ticked: its id and the wall name they chose (empty = use HA's name). */
export interface HaSelection {
	entityId: string;
	name: string;
}

/** An entity HA offers, for the picker. */
export interface HaEntity {
	entityId: string;
	name: string;
	domain: HaDomain;
}

/** What the wall draws. `on` is null for scenes (no state) and when HA could not be reached. */
export interface HaTile {
	entityId: string;
	name: string;
	kind: 'toggle' | 'scene' | 'sensor' | 'contact';
	on: boolean | null;
	unavailable: boolean;
	/** Sensors only: "21.5 °C", or "Open" / "Closed" for contacts. Null when unknown. */
	reading: string | null;
	/** Contacts only: true when open. */
	open: boolean | null;
	/** Sensors only: the value has not updated in a long while. */
	stale: boolean;
}

const ENTITY_ID = /^(light|switch|scene|sensor|binary_sensor)\.[a-z0-9_]{1,100}$/;

export function domainOf(entityId: string): HaDomain | null {
	const m = /^([a-z_]+)\./.exec(entityId);
	return m && (HA_DOMAINS as readonly string[]).includes(m[1]!) ? (m[1] as HaDomain) : null;
}

export function isEntityId(v: unknown): v is string {
	return typeof v === 'string' && ENTITY_ID.test(v);
}

/** "kitchen_light" -> "Kitchen light" for entities HA gives no friendly name. */
export function fallbackName(entityId: string): string {
	const id = entityId
		.slice(entityId.indexOf('.') + 1)
		.replace(/_/g, ' ')
		.trim();
	return id ? id.charAt(0).toUpperCase() + id.slice(1) : entityId;
}

/**
 * Validates an HA address typed by an adult: http(s) only, no credentials, no query.
 * Returns the origin plus any path prefix (HA behind a reverse proxy), no trailing slash,
 * or null. Private and LAN hosts are fine: the hub itself is LAN-only.
 */
export function normalizeBaseUrl(input: unknown): string | null {
	if (typeof input !== 'string') return null;
	const raw = input.trim();
	if (!raw) return null;
	let url: URL;
	try {
		url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`);
	} catch {
		return null;
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
	if (url.username || url.password || url.search || url.hash || !url.hostname) return null;
	const path = url.pathname.replace(/\/+$/, '').replace(/\/api$/, '');
	return `${url.origin}${path}`;
}

/** Keeps only valid, de-duplicated, allowed-domain picks in the order given. */
export function normalizeSelection(input: unknown): HaSelection[] {
	if (!Array.isArray(input)) return [];
	const seen = new Set<string>();
	const out: HaSelection[] = [];
	for (const item of input) {
		if (!item || typeof item !== 'object') continue;
		const { entityId, name } = item as Record<string, unknown>;
		if (!isEntityId(entityId) || seen.has(entityId)) continue;
		seen.add(entityId);
		out.push({ entityId, name: typeof name === 'string' ? name.trim().slice(0, 40) : '' });
		if (out.length >= MAX_TILES) break;
	}
	return out;
}

interface RawState {
	entity_id?: unknown;
	state?: unknown;
	last_updated?: unknown;
	attributes?: {
		friendly_name?: unknown;
		device_class?: unknown;
		unit_of_measurement?: unknown;
	} | null;
}

interface Raw {
	entityId: string;
	state: string;
	friendly: string;
	deviceClass: string;
	unit: string;
	updated: number | null;
}

function rawStates(body: unknown): Raw[] {
	if (!Array.isArray(body)) return [];
	const out: Raw[] = [];
	for (const r of body as RawState[]) {
		if (!r || !isEntityId(r.entity_id)) continue;
		const friendly = r.attributes?.friendly_name;
		const dc = r.attributes?.device_class;
		const unit = r.attributes?.unit_of_measurement;
		const updated = typeof r.last_updated === 'string' ? Date.parse(r.last_updated) : NaN;
		out.push({
			deviceClass: typeof dc === 'string' ? dc : '',
			unit: typeof unit === 'string' ? unit.trim().slice(0, 8) : '',
			updated: Number.isFinite(updated) ? updated : null,
			entityId: r.entity_id,
			state: typeof r.state === 'string' ? r.state : 'unknown',
			friendly: typeof friendly === 'string' ? friendly.trim() : ''
		});
	}
	return out;
}

function offered(s: Raw): boolean {
	const d = domainOf(s.entityId);
	if (d === 'sensor') return (SENSOR_CLASSES as readonly string[]).includes(s.deviceClass);
	if (d === 'binary_sensor') return (CONTACT_CLASSES as readonly string[]).includes(s.deviceClass);
	return true;
}

/** Entities the picker offers from a `GET /api/states` body, by domain then name. */
export function parseEntities(body: unknown): HaEntity[] {
	return rawStates(body)
		.filter(offered)
		.map((s) => ({
			entityId: s.entityId,
			name: s.friendly || fallbackName(s.entityId),
			domain: domainOf(s.entityId)!
		}))
		.sort(
			(a, b) =>
				HA_DOMAINS.indexOf(a.domain) - HA_DOMAINS.indexOf(b.domain) || a.name.localeCompare(b.name)
		);
}

const BAD = new Set(['unavailable', 'unknown']);

/** "21.54" + "°C" -> "21.5 °C". Non-numbers are shown as HA gave them. */
export function formatReading(state: string, unit: string): string {
	const n = Number(state);
	const v = state.trim() !== '' && Number.isFinite(n) ? String(Math.round(n * 10) / 10) : state;
	return unit ? `${v} ${unit}` : v;
}

function kindOf(entityId: string): HaTile['kind'] {
	const d = domainOf(entityId);
	if (d === 'scene') return 'scene';
	if (d === 'sensor') return 'sensor';
	if (d === 'binary_sensor') return 'contact';
	return 'toggle';
}

/** Tiles for the selection, in the adult's order. Entities HA no longer has show as unavailable. */
export function buildTiles(
	selection: readonly HaSelection[],
	body: unknown | null,
	now: number = Date.now()
): HaTile[] {
	const states = new Map(rawStates(body).map((s) => [s.entityId, s]));
	const reached = body !== null;
	return selection.map((sel) => {
		const s = states.get(sel.entityId);
		const kind = kindOf(sel.entityId);
		const missing = reached && !s;
		const bad = !!s && BAD.has(s.state);
		const readOnly = kind === 'sensor' || kind === 'contact';
		const live = !!s && !bad;
		return {
			entityId: sel.entityId,
			name: sel.name || s?.friendly || fallbackName(sel.entityId),
			kind,
			on: kind === 'toggle' && live ? s.state === 'on' : null,
			unavailable:
				missing || (kind === 'sensor' || kind === 'contact' ? bad : s?.state === 'unavailable'),
			reading:
				readOnly && live
					? kind === 'contact'
						? s.state === 'on'
							? 'Open'
							: 'Closed'
						: formatReading(s.state, s.unit)
					: null,
			open: kind === 'contact' && live ? s.state === 'on' : null,
			stale: kind === 'sensor' && live && s.updated !== null && now - s.updated > STALE_MS
		};
	});
}

/** The HA service a tap calls. Scenes are activated; lights and switches toggle. Null if read-only. */
export function serviceFor(entityId: string): { domain: HaDomain; service: string } | null {
	const domain = domainOf(entityId);
	// Sensors are read-only: no service exists for them here.
	if (!domain || !(CONTROL_DOMAINS as readonly string[]).includes(domain)) return null;
	return { domain, service: domain === 'scene' ? 'turn_on' : 'toggle' };
}

/** Optimistic flip of one tile: toggles flip, scenes and unknown states stay as they are. */
export function flipTile(tiles: readonly HaTile[], entityId: string): HaTile[] {
	return tiles.map((t) =>
		t.entityId === entityId && t.kind === 'toggle' && t.on !== null ? { ...t, on: !t.on } : t
	);
}

/** Moves item `index` by `delta` places, clamped; returns a new array. */
export function moveItem<T>(list: readonly T[], index: number, delta: number): T[] {
	const to = Math.max(0, Math.min(list.length - 1, index + delta));
	const out = [...list];
	if (index < 0 || index >= list.length || to === index) return out;
	const [item] = out.splice(index, 1);
	out.splice(to, 0, item!);
	return out;
}
