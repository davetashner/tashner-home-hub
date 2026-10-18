/** Shower-music rules (hub-txj.4): curation, device pick, volume cap, timer. Plain TypeScript, no I/O. */

export const MUSIC_SETTING_KEY = 'music.config';
export const HUB_DEVICE_NAME = 'Hub';
export const TIMER_CHOICES = [0, 10, 15, 20, 30] as const;
export const DEFAULT_VOLUME_CAP = 70;
export const MIN_VOLUME_CAP = 20;
export const MAX_PLAYLISTS = 60;

export interface CuratedPlaylist {
	id: string;
	name: string;
	/** https image URL, or null when the playlist has no cover. */
	cover: string | null;
	tracks: number;
}

export interface MusicConfig {
	playlists: CuratedPlaylist[];
	/** Loudest volume kids can pick, percent. */
	volumeCap: number;
	/** Minutes of music per start; 0 = no timer. */
	timerMinutes: number;
	/** Name of the Spotify Connect device to play on; null = automatic (Hub when present). */
	device: string | null;
}

export interface SpotifyDevice {
	id: string;
	name: string;
	isActive?: boolean;
	volumePercent?: number | null;
}

/** Why a music action failed; the UI maps `no_device` to "the speaker is asleep". */
export type MusicErrorCode = 'no_device' | 'not_allowed' | 'not_connected' | 'invalid' | 'spotify';

export class MusicError extends Error {
	constructor(
		readonly code: MusicErrorCode,
		message: string
	) {
		super(message);
		this.name = 'MusicError';
	}
}

export function defaultConfig(): MusicConfig {
	return { playlists: [], volumeCap: DEFAULT_VOLUME_CAP, timerMinutes: 0, device: null };
}

export function clamp(n: number, lo: number, hi: number): number {
	return Math.min(hi, Math.max(lo, n));
}

export function normalizeVolumeCap(v: unknown): number {
	if (typeof v !== 'number' || !Number.isFinite(v)) return DEFAULT_VOLUME_CAP;
	return clamp(Math.round(v / 10) * 10, MIN_VOLUME_CAP, 100);
}

export function normalizeTimer(v: unknown): number {
	return (TIMER_CHOICES as readonly number[]).includes(v as number) ? (v as number) : 0;
}

function parsePlaylist(v: unknown): CuratedPlaylist | null {
	if (!v || typeof v !== 'object') return null;
	const o = v as Record<string, unknown>;
	if (typeof o.id !== 'string' || !/^[A-Za-z0-9]{1,64}$/.test(o.id)) return null;
	if (typeof o.name !== 'string' || !o.name.trim()) return null;
	const cover = typeof o.cover === 'string' && /^https:\/\//.test(o.cover) ? o.cover : null;
	const tracks =
		typeof o.tracks === 'number' && Number.isFinite(o.tracks)
			? Math.max(0, Math.floor(o.tracks))
			: 0;
	return { id: o.id, name: o.name.trim().slice(0, 120), cover, tracks };
}

/** Drops malformed and duplicate playlists. */
export function parsePlaylists(v: unknown): CuratedPlaylist[] {
	if (!Array.isArray(v)) return [];
	const seen = new Set<string>();
	const out: CuratedPlaylist[] = [];
	for (const item of v) {
		const p = parsePlaylist(item);
		if (!p || seen.has(p.id)) continue;
		seen.add(p.id);
		out.push(p);
		if (out.length >= MAX_PLAYLISTS) break;
	}
	return out;
}

/** Reads stored (or submitted) config, repairing anything out of range. */
export function parseConfig(v: unknown): MusicConfig {
	const o = v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
	const device =
		typeof o.device === 'string' && o.device.trim() ? o.device.trim().slice(0, 120) : null;
	return {
		playlists: parsePlaylists(o.playlists),
		volumeCap: normalizeVolumeCap(o.volumeCap ?? DEFAULT_VOLUME_CAP),
		timerMinutes: normalizeTimer(o.timerMinutes ?? 0),
		device
	};
}

/** Only parent-approved playlists may be played. */
export function isCurated(config: MusicConfig, playlistId: string): boolean {
	return config.playlists.some((p) => p.id === playlistId);
}

/** Spotify device ids change, so the choice is stored by name: chosen name, else "Hub", else none. */
export function pickDevice(
	devices: SpotifyDevice[],
	preferredName: string | null
): SpotifyDevice | null {
	const byName = (n: string) => devices.find((d) => d.name.toLowerCase() === n.toLowerCase());
	return (preferredName ? byName(preferredName) : undefined) ?? byName(HUB_DEVICE_NAME) ?? null;
}

/** Kids can never go above the parent's cap. */
export function clampVolume(percent: unknown, cap: number): number {
	const n = typeof percent === 'number' && Number.isFinite(percent) ? Math.round(percent) : 0;
	return clamp(n, 0, cap);
}

export function timerEndsAt(startedAt: number, minutes: number): number | null {
	return minutes > 0 ? startedAt + minutes * 60_000 : null;
}

/** Whole seconds left (rounded up), or null when no timer runs. */
export function timerRemainingSec(endsAt: number | null, now: number): number | null {
	return endsAt === null ? null : Math.max(0, Math.ceil((endsAt - now) / 1000));
}

/** Reads a Spotify playlist object; the API names the track count `tracks` or (newer) `items`. */
export function playlistFromSpotify(v: unknown): CuratedPlaylist | null {
	if (!v || typeof v !== 'object') return null;
	const o = v as Record<string, unknown>;
	const count = (k: string) => {
		const t = o[k];
		return t && typeof t === 'object' ? (t as { total?: unknown }).total : undefined;
	};
	const images = Array.isArray(o.images) ? (o.images as { url?: unknown }[]) : [];
	// Prefer a mid-size image: the tiles are about 300 px.
	const pick = images.length > 1 ? images[Math.min(1, images.length - 1)] : images[0];
	return parsePlaylist({
		id: o.id,
		name: o.name,
		cover: pick?.url,
		tracks: count('tracks') ?? count('items') ?? 0
	});
}
