import { describe, expect, it } from 'vitest';
import {
	checkImage,
	checkNewGame,
	checkPatch,
	checkTitle,
	cleanHttpsUrl,
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
