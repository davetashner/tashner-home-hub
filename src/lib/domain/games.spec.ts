import { describe, expect, it } from 'vitest';
import {
	checkImage,
	checkNewGame,
	checkPatch,
	checkTitle,
	cleanHttpsUrl,
	isHubOrigin,
	isPrivateGameUrl,
	isPrivateHost,
	GAME_TITLE_MAX,
	MAX_GAMES,
	moveGame,
	parseGames,
	type Game
} from './games.js';

const URL1 = 'https://games.example.com/space-hop/index.html';
const g = (id: string): Game => ({ id, title: id, url: URL1, image: null });

describe('cleanHttpsUrl', () => {
	it('accepts https and normalises', () => {
		expect(cleanHttpsUrl(`  ${URL1}  `)).toBe(URL1);
		expect(cleanHttpsUrl('https://games.example.com')).toBe('https://games.example.com/');
	});
	it.each([
		'http://games.example.com/a',
		'javascript:alert(1)',
		'data:text/html,<p>x</p>',
		'/relative/path.html',
		'games.example.com/a',
		'https://user:pw@games.example.com/',
		'',
		'   '
	])('rejects %s', (v) => expect(cleanHttpsUrl(v)).toBeNull());
	it('rejects non-strings and absurd lengths', () => {
		expect(cleanHttpsUrl(42)).toBeNull();
		expect(cleanHttpsUrl(`https://a.example/${'x'.repeat(2000)}`)).toBeNull();
	});
});

describe('field checks', () => {
	it('trims titles and bounds their length', () => {
		expect(checkTitle('  Space Hop ')).toEqual({ ok: true, value: 'Space Hop' });
		expect(checkTitle('   ').ok).toBe(false);
		expect(checkTitle(7).ok).toBe(false);
		expect(checkTitle('x'.repeat(GAME_TITLE_MAX)).ok).toBe(true);
		expect(checkTitle('x'.repeat(GAME_TITLE_MAX + 1)).ok).toBe(false);
	});
	it('treats a missing or blank image as none, and rejects a bad one', () => {
		expect(checkImage(undefined)).toEqual({ ok: true, value: null });
		expect(checkImage(null)).toEqual({ ok: true, value: null });
		expect(checkImage(' ')).toEqual({ ok: true, value: null });
		expect(checkImage('http://img.example.com/a.png').ok).toBe(false);
		expect(checkImage('https://img.example.com/a.png')).toEqual({
			ok: true,
			value: 'https://img.example.com/a.png'
		});
	});
});

describe('checkNewGame', () => {
	it('returns a clean game', () => {
		expect(checkNewGame({ title: ' A ', url: URL1 })).toEqual({
			ok: true,
			value: { title: 'A', url: URL1, image: null }
		});
	});
	it('reports the first problem', () => {
		expect(checkNewGame({ title: '', url: URL1 })).toMatchObject({ ok: false });
		expect(checkNewGame({ title: 'A', url: 'http://x.example/' })).toMatchObject({ ok: false });
		expect(checkNewGame({ title: 'A', url: URL1, image: 'javascript:1' })).toMatchObject({
			ok: false
		});
	});
});

describe('checkPatch', () => {
	it('only checks the fields present', () => {
		expect(checkPatch({})).toEqual({ ok: true, value: {} });
		expect(checkPatch({ title: ' B ', image: null })).toEqual({
			ok: true,
			value: { title: 'B', image: null }
		});
		expect(checkPatch({ url: URL1 })).toEqual({ ok: true, value: { url: URL1 } });
	});
	it('rejects bad fields', () => {
		expect(checkPatch({ title: '' }).ok).toBe(false);
		expect(checkPatch({ url: 'http://x.example/' }).ok).toBe(false);
		expect(checkPatch({ image: 'data:image/png;base64,AA' }).ok).toBe(false);
	});
});

describe('parseGames', () => {
	it('drops junk and caps the list', () => {
		expect(parseGames('nope')).toEqual([]);
		expect(
			parseGames([null, 3, { id: '', title: 'A', url: URL1 }, { id: 'a', title: 'A' }])
		).toEqual([]);
		expect(parseGames([{ id: 'a', title: 'A', url: URL1, image: null }])).toEqual([
			{ id: 'a', title: 'A', url: URL1, image: null }
		]);
		const many = Array.from({ length: MAX_GAMES + 5 }, (_, i) => g(`g${i}`));
		expect(parseGames(many)).toHaveLength(MAX_GAMES);
	});
});

describe('moveGame', () => {
	const list = [g('a'), g('b'), g('c')];
	it('swaps with a neighbour', () => {
		expect(moveGame(list, 'b', -1).map((x) => x.id)).toEqual(['b', 'a', 'c']);
		expect(moveGame(list, 'b', 1).map((x) => x.id)).toEqual(['a', 'c', 'b']);
	});
	it('does nothing at the ends or for unknown ids, and never mutates', () => {
		expect(moveGame(list, 'a', -1).map((x) => x.id)).toEqual(['a', 'b', 'c']);
		expect(moveGame(list, 'c', 1).map((x) => x.id)).toEqual(['a', 'b', 'c']);
		expect(moveGame(list, 'zzz', 1).map((x) => x.id)).toEqual(['a', 'b', 'c']);
		expect(list.map((x) => x.id)).toEqual(['a', 'b', 'c']);
	});
});

describe("the hub's own origin is never a game (hub-wzg review)", () => {
	const HUB = 'https://hub.example.com';
	it('matches the origin only, port included', () => {
		expect(isHubOrigin('https://hub.example.com/games/x', HUB)).toBe(true);
		expect(isHubOrigin('https://hub.example.com:8443/', HUB)).toBe(false);
		expect(isHubOrigin('https://games.example.com/', HUB)).toBe(false);
		expect(isHubOrigin('https://hub.example.com/', undefined)).toBe(false);
		expect(isHubOrigin('not a url', HUB)).toBe(false);
	});

	it('is refused on create and edit, and dropped when read', () => {
		expect(checkNewGame({ title: 'x', url: `${HUB}/x` }, HUB)).toMatchObject({ ok: false });
		expect(checkPatch({ url: `${HUB}/` }, HUB)).toMatchObject({ ok: false });
		const stored = [
			{ id: 'a', title: 'Ours', url: `${HUB}/settings`, image: null },
			{ id: 'b', title: 'Theirs', url: 'https://games.example.com/', image: null }
		];
		expect(parseGames(stored, HUB).map((g) => g.id)).toEqual(['b']);
		expect(parseGames(stored).map((g) => g.id)).toEqual(['a', 'b']);
	});
});

describe('isPrivateHost (hub-84i)', () => {
	it.each([
		'10.0.0.1',
		'10.255.255.255',
		'172.16.0.1',
		'172.31.255.1',
		'192.168.1.50',
		'127.0.0.1',
		'127.8.9.10',
		'169.254.1.1',
		'100.64.0.1',
		'100.127.255.254',
		'::1',
		'[::1]',
		'fc00::1',
		'fd12:3456::1',
		'[fd12:3456::1]',
		'fe80::1',
		'[febf::1]',
		'::ffff:192.168.1.5',
		'[::ffff:c0a8:132]',
		'localhost',
		'LOCALHOST',
		'app.localhost',
		'nas.local',
		'Game-Box.LOCAL.',
		'  10.1.1.1  '
	])('%s is private', (h) => expect(isPrivateHost(h)).toBe(true));

	it.each([
		'',
		'games.example.com',
		'localhost.example.com',
		'notlocal',
		'8.8.8.8',
		'11.0.0.1',
		'172.15.0.1',
		'172.32.0.1',
		'192.167.1.1',
		'169.253.1.1',
		'100.63.0.1',
		'100.128.0.1',
		'2001:db8::1',
		'[2606:4700::1111]',
		'fe00::1',
		'fec0::1',
		'fb00::1',
		'::ffff:8.8.8.8',
		'[::ffff:808:808]',
		'xyz::1'
	])('%s is public', (h) => expect(isPrivateHost(h)).toBe(false));
});

describe('isPrivateGameUrl', () => {
	it('flags https URLs on private hosts only', () => {
		expect(isPrivateGameUrl('https://192.168.1.50/game')).toBe(true);
		expect(isPrivateGameUrl('https://[fd00::5]/game')).toBe(true);
		expect(isPrivateGameUrl('https://nas.local:8443/')).toBe(true);
		expect(isPrivateGameUrl('https://games.example.com/')).toBe(false);
		expect(isPrivateGameUrl('http://192.168.1.50/game')).toBe(false);
		expect(isPrivateGameUrl('not a url')).toBe(false);
		expect(isPrivateGameUrl('')).toBe(false);
	});

	it('still accepts private hosts as games', () => {
		expect(checkNewGame({ title: 'LAN', url: 'https://192.168.1.50/game' }).ok).toBe(true);
	});
});
