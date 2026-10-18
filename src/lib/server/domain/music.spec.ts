import { describe, expect, it } from 'vitest';
import {
	clampVolume,
	defaultConfig,
	isCurated,
	normalizeTimer,
	normalizeVolumeCap,
	parseConfig,
	parsePlaylists,
	pickDevice,
	playlistFromSpotify,
	timerEndsAt,
	timerRemainingSec,
	MusicError
} from './music.js';

describe('config', () => {
	it('defaults and repairs', () => {
		expect(parseConfig(null)).toEqual(defaultConfig());
		const c = parseConfig({ volumeCap: 3, timerMinutes: 7, device: '  Kitchen  ', playlists: 'x' });
		expect(c).toEqual({ playlists: [], volumeCap: 20, timerMinutes: 0, device: 'Kitchen' });
		expect(parseConfig({ device: '  ' }).device).toBeNull();
	});
	it('normalizes cap and timer', () => {
		expect(normalizeVolumeCap(64)).toBe(60);
		expect(normalizeVolumeCap(500)).toBe(100);
		expect(normalizeVolumeCap('x')).toBe(70);
		expect(normalizeTimer(15)).toBe(15);
		expect(normalizeTimer(12)).toBe(0);
	});
	it('keeps only valid unique playlists', () => {
		const out = parsePlaylists([
			{ id: 'a1', name: ' Wake up ', cover: 'https://img/x.jpg', tracks: 12.7 },
			{ id: 'a1', name: 'dup' },
			{ id: 'b2', name: 'Plain', cover: 'http://insecure', tracks: -3 },
			{ id: 'bad id', name: 'x' },
			{ id: 'c3', name: '  ' },
			{ id: 'd4', name: 'No tracks' },
			null,
			5
		]);
		expect(out).toEqual([
			{ id: 'a1', name: 'Wake up', cover: 'https://img/x.jpg', tracks: 12 },
			{ id: 'b2', name: 'Plain', cover: null, tracks: 0 },
			{ id: 'd4', name: 'No tracks', cover: null, tracks: 0 }
		]);
		expect(parsePlaylists(undefined)).toEqual([]);
		const many = Array.from({ length: 80 }, (_, i) => ({ id: `p${i}`, name: 'n' }));
		expect(parsePlaylists(many)).toHaveLength(60);
	});
	it('filters to curated', () => {
		const c = parseConfig({ playlists: [{ id: 'a1', name: 'A' }] });
		expect(isCurated(c, 'a1')).toBe(true);
		expect(isCurated(c, 'zz')).toBe(false);
	});
});

describe('pickDevice', () => {
	const hub = { id: '1', name: 'Hub' };
	const phone = { id: '2', name: 'Pixel' };
	it('prefers the chosen name, then Hub, else none', () => {
		expect(pickDevice([hub, phone], 'pixel')).toBe(phone);
		expect(pickDevice([hub, phone], null)).toBe(hub);
		expect(pickDevice([hub, phone], 'Gone')).toBe(hub);
		expect(pickDevice([phone], null)).toBeNull();
		expect(pickDevice([], 'Pixel')).toBeNull();
	});
});

describe('volume and timer', () => {
	it('clamps to the cap', () => {
		expect(clampVolume(95, 70)).toBe(70);
		expect(clampVolume(-5, 70)).toBe(0);
		expect(clampVolume(33.4, 70)).toBe(33);
		expect(clampVolume('loud', 70)).toBe(0);
		expect(clampVolume(NaN, 70)).toBe(0);
	});
	it('does timer math', () => {
		expect(timerEndsAt(1000, 0)).toBeNull();
		expect(timerEndsAt(1000, 10)).toBe(601_000);
		expect(timerRemainingSec(null, 5)).toBeNull();
		expect(timerRemainingSec(601_000, 1000)).toBe(600);
		expect(timerRemainingSec(601_000, 1001)).toBe(600);
		expect(timerRemainingSec(601_000, 700_000)).toBe(0);
	});
});

describe('playlistFromSpotify', () => {
	it('reads both track count shapes and picks a mid-size image', () => {
		const imgs = [{ url: 'https://i/640' }, { url: 'https://i/300' }, { url: 'https://i/60' }];
		expect(playlistFromSpotify({ id: 'a', name: 'N', images: imgs, tracks: { total: 9 } })).toEqual(
			{
				id: 'a',
				name: 'N',
				cover: 'https://i/300',
				tracks: 9
			}
		);
		expect(
			playlistFromSpotify({
				id: 'a',
				name: 'N',
				images: [{ url: 'https://i/1' }],
				items: { total: 4 }
			})
		).toMatchObject({
			cover: 'https://i/1',
			tracks: 4
		});
		expect(playlistFromSpotify({ id: 'a', name: 'N' })).toMatchObject({ cover: null, tracks: 0 });
		expect(playlistFromSpotify({ id: 'a', name: 'N', tracks: null })).toMatchObject({ tracks: 0 });
		expect(playlistFromSpotify(null)).toBeNull();
		expect(playlistFromSpotify('x')).toBeNull();
	});
	it('MusicError carries a code', () => {
		expect(new MusicError('no_device', 'x').code).toBe('no_device');
	});
});
