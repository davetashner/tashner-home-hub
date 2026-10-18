import { eq } from 'drizzle-orm';
import { getDb, type Db } from '../db/index.js';
import { settings } from '../db/schema.js';
import { decryptSecret, encryptSecret, type Keyring } from '../domain/secrets.js';
import { getKeyring } from '../keys.js';
import {
	buildTiles,
	normalizeBaseUrl,
	normalizeSelection,
	parseEntities,
	serviceFor,
	type HaEntity,
	type HaSelection,
	type HaTile
} from '../../domain/home-assistant.js';

const KEY = 'homeassistant.connection';
const TOKEN_AAD = 'homeassistant.token';
const TIMEOUT_MS = 5_000;

export type FetchFn = typeof fetch;

export interface Deps {
	db?: Db;
	keyring?: Keyring;
	fetch?: FetchFn;
}

interface Stored {
	baseUrl: string;
	/** Sealed with secret.key; the browser never receives it. */
	token: string;
	tiles: HaSelection[];
}

export class HaError extends Error {
	constructor(
		message: string,
		readonly kind: 'unreachable' | 'rejected' | 'invalid'
	) {
		super(message);
		this.name = 'HaError';
	}
}

function read(db: Db): Stored | null {
	const row = db.select().from(settings).where(eq(settings.key, KEY)).get();
	if (!row) return null;
	try {
		return JSON.parse(row.value) as Stored;
	} catch {
		return null;
	}
}

function write(db: Db, v: Stored): void {
	const value = JSON.stringify(v);
	db.insert(settings)
		.values({ key: KEY, value })
		.onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: Date.now() } })
		.run();
}

export interface HaConfig {
	configured: boolean;
	baseUrl: string;
	hasToken: boolean;
	tiles: HaSelection[];
}

/** What the settings page sees. Never includes the token. */
export function readConfig(deps: Deps = {}): HaConfig {
	const s = read(deps.db ?? getDb());
	return s
		? { configured: true, baseUrl: s.baseUrl, hasToken: !!s.token, tiles: s.tiles }
		: { configured: false, baseUrl: '', hasToken: false, tiles: [] };
}

/** Saves the address and, when given, a new token (blank keeps the saved one). Keeps the picks. */
export function saveConnection(
	input: { baseUrl: unknown; token: unknown },
	deps: Deps = {}
): HaConfig {
	const db = deps.db ?? getDb();
	const baseUrl = normalizeBaseUrl(input.baseUrl);
	if (!baseUrl)
		throw new HaError('Enter an address like http://homeassistant.local:8123', 'invalid');
	const old = read(db);
	const typed = typeof input.token === 'string' ? input.token.trim() : '';
	if (!typed && !old?.token) throw new HaError('Paste a long-lived access token', 'invalid');
	const token = typed ? encryptSecret(deps.keyring ?? getKeyring(), typed, TOKEN_AAD) : old!.token;
	write(db, { baseUrl, token, tiles: old?.tiles ?? [] });
	return readConfig({ db });
}

export function saveTiles(input: unknown, deps: Deps = {}): HaSelection[] {
	const db = deps.db ?? getDb();
	const old = read(db);
	if (!old) throw new HaError('Connect Home Assistant first', 'invalid');
	const tiles = normalizeSelection(input);
	write(db, { ...old, tiles });
	return tiles;
}

export function disconnect(deps: Deps = {}): void {
	(deps.db ?? getDb()).delete(settings).where(eq(settings.key, KEY)).run();
}

interface Creds {
	baseUrl: string;
	token: string;
}

function creds(deps: Deps, override?: { baseUrl: unknown; token: unknown }): Creds {
	const saved = read(deps.db ?? getDb());
	const baseUrl = override?.baseUrl ? normalizeBaseUrl(override.baseUrl) : saved?.baseUrl;
	if (!baseUrl) throw new HaError('Home Assistant is not set up', 'invalid');
	const typed = typeof override?.token === 'string' ? override.token.trim() : '';
	let token = typed;
	if (!token && saved?.token) {
		try {
			token = decryptSecret(deps.keyring ?? getKeyring(), saved.token, TOKEN_AAD);
		} catch {
			throw new HaError('The saved token cannot be read. Paste it again', 'rejected');
		}
	}
	if (!token) throw new HaError('Paste a long-lived access token', 'invalid');
	return { baseUrl, token };
}

async function call(c: Creds, path: string, init: RequestInit, f: FetchFn): Promise<Response> {
	let res: Response;
	try {
		res = await f(`${c.baseUrl}${path}`, {
			...init,
			// A redirect would re-send the token to wherever it points.
			redirect: 'manual',
			signal: AbortSignal.timeout(TIMEOUT_MS),
			headers: {
				authorization: `Bearer ${c.token}`,
				'content-type': 'application/json',
				...init.headers
			}
		});
	} catch {
		throw new HaError('Home Assistant unreachable', 'unreachable');
	}
	if (res.status === 401 || res.status === 403) {
		void res.body?.cancel();
		throw new HaError('Home Assistant rejected the token', 'rejected');
	}
	if (!res.ok) {
		void res.body?.cancel();
		throw new HaError(`Home Assistant answered ${res.status}`, 'unreachable');
	}
	return res;
}

/** GET /api/ on HA. `override` tests an address and token typed but not yet saved. */
export async function testConnection(
	override?: { baseUrl: unknown; token: unknown },
	deps: Deps = {}
): Promise<{ message: string }> {
	const res = await call(creds(deps, override), '/api/', { method: 'GET' }, deps.fetch ?? fetch);
	const body = (await res.json().catch(() => ({}))) as { message?: unknown };
	return { message: typeof body.message === 'string' ? body.message : 'Connected' };
}

export async function listEntities(deps: Deps = {}): Promise<HaEntity[]> {
	const res = await call(creds(deps), '/api/states', { method: 'GET' }, deps.fetch ?? fetch);
	return parseEntities(await res.json().catch(() => []));
}

export type TilesResult =
	{ configured: false } | { configured: true; reachable: boolean; tiles: HaTile[] };

/** The wall's tiles with live state. HA being down yields the tiles without state, not an error. */
export async function readTiles(deps: Deps = {}): Promise<TilesResult> {
	const saved = read(deps.db ?? getDb());
	if (!saved || saved.tiles.length === 0) return { configured: false };
	try {
		const res = await call(creds(deps), '/api/states', { method: 'GET' }, deps.fetch ?? fetch);
		return {
			configured: true,
			reachable: true,
			tiles: buildTiles(saved.tiles, await res.json().catch(() => []))
		};
	} catch (e) {
		if (!(e instanceof HaError)) throw e;
		return { configured: true, reachable: false, tiles: buildTiles(saved.tiles, null) };
	}
}

/** Toggles a light or switch, or activates a scene. Only entities an adult picked are allowed. */
export async function activate(entityId: unknown, deps: Deps = {}): Promise<void> {
	const saved = read(deps.db ?? getDb());
	const svc = typeof entityId === 'string' ? serviceFor(entityId) : null;
	if (!saved || !svc || !saved.tiles.some((t) => t.entityId === entityId))
		throw new HaError('That is not one of the Home controls', 'invalid');
	await call(
		creds(deps),
		`/api/services/${svc.domain}/${svc.service}`,
		{ method: 'POST', body: JSON.stringify({ entity_id: entityId }) },
		deps.fetch ?? fetch
	);
}
