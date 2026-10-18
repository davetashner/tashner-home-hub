/** Playback, shower timer and now-playing state (hub-txj.4). Config and Spotify plumbing: `./index.js`. */
import {
	clampVolume,
	isCurated,
	MusicError,
	pickDevice,
	timerEndsAt,
	timerRemainingSec,
	type MusicConfig,
	type SpotifyDevice
} from '../domain/music.js';
import { command, getMusicConfig, listDevices, nowOf, request, type MusicDeps } from './index.js';

// --- shower timer ----------------------------------------------------------

let timer: { endsAt: number; handle: ReturnType<typeof setTimeout> } | null = null;

export function cancelTimer(): void {
	if (timer) clearTimeout(timer.handle);
	timer = null;
}

/** Starts (or restarts) the auto-stop; the server pauses playback when it fires. */
export function startTimer(minutes: number, deps: MusicDeps = {}): void {
	cancelTimer();
	const endsAt = timerEndsAt(nowOf(deps), minutes);
	if (endsAt === null) return;
	const handle = setTimeout(
		() => {
			timer = null;
			void command(deps, '/v1/me/player/pause', 'PUT').catch(() => undefined);
		},
		endsAt - nowOf(deps)
	);
	handle.unref?.();
	timer = { endsAt, handle };
}

// --- playback --------------------------------------------------------------

async function deviceFor(d: MusicDeps, config: MusicConfig): Promise<SpotifyDevice> {
	const device = pickDevice(await listDevices(d), config.device);
	if (!device) throw new MusicError('no_device', 'The speaker is asleep');
	return device;
}

export async function playPlaylist(playlistId: string, deps: MusicDeps = {}): Promise<void> {
	const config = getMusicConfig(deps);
	if (!isCurated(config, playlistId))
		throw new MusicError('invalid', 'That playlist is not on the kids list');
	const device = await deviceFor(deps, config);
	await command(deps, '/v1/me/player', 'PUT', { device_ids: [device.id], play: false });
	await command(deps, `/v1/me/player/play?device_id=${encodeURIComponent(device.id)}`, 'PUT', {
		context_uri: `spotify:playlist:${playlistId}`
	});
	if ((device.volumePercent ?? 0) > config.volumeCap)
		await setVolume(config.volumeCap, deps).catch(() => undefined);
	startTimer(config.timerMinutes, deps);
}

export async function pause(deps: MusicDeps = {}): Promise<void> {
	cancelTimer();
	await command(deps, '/v1/me/player/pause', 'PUT');
}

export async function resume(deps: MusicDeps = {}): Promise<void> {
	const config = getMusicConfig(deps);
	await command(deps, '/v1/me/player/play', 'PUT');
	startTimer(config.timerMinutes, deps);
}

export const next = (deps: MusicDeps = {}) => command(deps, '/v1/me/player/next', 'POST');
export const previous = (deps: MusicDeps = {}) => command(deps, '/v1/me/player/previous', 'POST');

/** Sets the volume, never above the parent's cap. Returns what was applied. */
export async function setVolume(percent: unknown, deps: MusicDeps = {}): Promise<number> {
	const applied = clampVolume(percent, getMusicConfig(deps).volumeCap);
	await command(deps, `/v1/me/player/volume?volume_percent=${applied}`, 'PUT');
	return applied;
}

export interface MusicState {
	connected: boolean;
	online: boolean;
	isPlaying: boolean;
	track: string | null;
	artist: string | null;
	playlist: { id: string; name: string } | null;
	volume: number | null;
	volumeCap: number;
	timerRemainingSec: number | null;
	device: string | null;
}

/** What the kid screen polls. Never throws: a Spotify problem reads as an offline speaker. */
export async function musicState(deps: MusicDeps = {}): Promise<MusicState> {
	const config = getMusicConfig(deps);
	const base: MusicState = {
		connected: true,
		online: false,
		isPlaying: false,
		track: null,
		artist: null,
		playlist: null,
		volume: null,
		volumeCap: config.volumeCap,
		timerRemainingSec: timerRemainingSec(timer?.endsAt ?? null, nowOf(deps)),
		device: null
	};
	try {
		const devices = await listDevices(deps);
		const device = pickDevice(devices, config.device);
		if (!device) return base;
		base.online = true;
		base.device = device.name;
		base.volume = device.volumePercent ?? null;
		const res = await request(deps, '/v1/me/player');
		if (res.status === 204 || !res.ok) {
			void res.body?.cancel();
			return base;
		}
		const p = (await res.json().catch(() => ({}))) as {
			is_playing?: boolean;
			device?: { id?: string; volume_percent?: number };
			item?: { name?: string; artists?: { name?: string }[] } | null;
			context?: { uri?: string } | null;
		};
		// Only report playback that is on our speaker.
		if (p.device?.id !== device.id) return base;
		base.isPlaying = p.is_playing === true;
		base.volume = p.device?.volume_percent ?? base.volume;
		base.track = p.item?.name ?? null;
		base.artist =
			p.item?.artists
				?.map((a) => a.name)
				.filter(Boolean)
				.join(', ') || null;
		const id = p.context?.uri?.match(/^spotify:playlist:(\w+)$/)?.[1];
		const hit = id ? config.playlists.find((x) => x.id === id) : undefined;
		base.playlist = hit ? { id: hit.id, name: hit.name } : null;
		if (!base.isPlaying) base.timerRemainingSec = null;
		return base;
	} catch (e) {
		if (e instanceof MusicError && e.code === 'not_connected') return { ...base, connected: false };
		return base;
	}
}
