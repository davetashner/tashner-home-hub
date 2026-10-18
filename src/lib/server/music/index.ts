/** Shower-music playback on the household Spotify account (hub-txj.4). Rules live in `../domain/music.ts`. */
import { eq } from 'drizzle-orm';
import { getDb, type Db } from '../db/index.js';
import { settings } from '../db/schema.js';
import {
	MUSIC_SETTING_KEY,
	MusicError,
	parseConfig,
	playlistFromSpotify,
	type CuratedPlaylist,
	type MusicConfig,
	type SpotifyDevice
} from '../domain/music.js';
import { SpotifyError } from '../domain/spotify.js';
import { spotifyFetch } from '../spotify/index.js';

export interface MusicDeps {
	db?: Db;
	api?: (path: string, init?: RequestInit) => Promise<Response>;
	now?: () => number;
}

const api = (d: MusicDeps) => d.api ?? ((p: string, i?: RequestInit) => spotifyFetch(p, i));
export const nowOf = (d: MusicDeps) => (d.now ?? Date.now)();

// --- config ----------------------------------------------------------------

export function getMusicConfig(deps: MusicDeps = {}): MusicConfig {
	const row = (deps.db ?? getDb())
		.select()
		.from(settings)
		.where(eq(settings.key, MUSIC_SETTING_KEY))
		.get();
	try {
		return parseConfig(row ? JSON.parse(row.value) : null);
	} catch {
		return parseConfig(null);
	}
}

/** Merges a partial update (already adult-checked) and stores the repaired result. */
export function saveMusicConfig(patch: Record<string, unknown>, deps: MusicDeps = {}): MusicConfig {
	const next = parseConfig({ ...getMusicConfig(deps), ...patch });
	const value = JSON.stringify(next);
	(deps.db ?? getDb())
		.insert(settings)
		.values({ key: MUSIC_SETTING_KEY, value })
		.onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: Date.now() } })
		.run();
	return next;
}

// --- Spotify plumbing ------------------------------------------------------

/** Turns a failed Spotify answer into a MusicError (never leaks tokens). */
async function fail(res: Response): Promise<never> {
	void res.body?.cancel();
	if (res.status === 404) throw new MusicError('no_device', 'The speaker is asleep');
	if (res.status === 403)
		throw new MusicError('not_allowed', 'Spotify Premium is needed to play music');
	throw new MusicError('spotify', `Spotify answered ${res.status}`);
}

export async function request(d: MusicDeps, path: string, init?: RequestInit): Promise<Response> {
	try {
		return await api(d)(path, init);
	} catch (e) {
		if (e instanceof SpotifyError)
			throw new MusicError(
				e.needsReauth || /not connected|set up/.test(e.message) ? 'not_connected' : 'spotify',
				e.message
			);
		throw e;
	}
}

export async function command(
	d: MusicDeps,
	path: string,
	method: 'PUT' | 'POST',
	body?: unknown
): Promise<void> {
	const res = await request(d, path, {
		method,
		headers: body ? { 'content-type': 'application/json' } : undefined,
		body: body ? JSON.stringify(body) : undefined
	});
	if (!res.ok) await fail(res);
	void res.body?.cancel();
}

/** All of the parent's playlists, across Spotify's pages. */
export async function listLibrary(deps: MusicDeps = {}): Promise<CuratedPlaylist[]> {
	const out: CuratedPlaylist[] = [];
	for (let offset = 0; offset < 500; offset += 50) {
		const res = await request(deps, `/v1/me/playlists?limit=50&offset=${offset}`);
		if (!res.ok) await fail(res);
		const page = (await res.json().catch(() => ({}))) as {
			items?: unknown[];
			next?: string | null;
		};
		for (const item of page.items ?? []) {
			const p = playlistFromSpotify(item);
			if (p) out.push(p);
		}
		if (!page.next) break;
	}
	return out;
}

export async function listDevices(deps: MusicDeps = {}): Promise<SpotifyDevice[]> {
	const res = await request(deps, '/v1/me/player/devices');
	if (!res.ok) await fail(res);
	const body = (await res.json().catch(() => ({}))) as { devices?: Record<string, unknown>[] };
	return (body.devices ?? []).flatMap((d) =>
		typeof d.id === 'string' && typeof d.name === 'string'
			? [
					{
						id: d.id,
						name: d.name,
						isActive: d.is_active === true,
						volumePercent: typeof d.volume_percent === 'number' ? d.volume_percent : null
					}
				]
			: []
	);
}
