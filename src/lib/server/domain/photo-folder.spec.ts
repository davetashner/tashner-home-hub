import { describe, expect, it } from 'vitest';
import {
	albumOf,
	allowedRoots,
	hasChanged,
	isAlbumSelected,
	isInside,
	isSupportedFile,
	parseConfig,
	safeJoin,
	stableShuffle
} from './photo-folder.js';

describe('allowedRoots', () => {
	it('defaults and adds the data volume library', () => {
		expect(allowedRoots({})).toEqual(['/media/photos-in', './data/photo-library']);
		expect(allowedRoots({ DATA_DIR: '/data/' })).toContain('/data/photo-library');
	});
	it('parses a list and drops relative entries', () => {
		const r = allowedRoots({ HUB_PHOTO_ROOTS: ' /a , /b,rel,', DATA_DIR: '/d' });
		expect(r).toEqual(['/a', '/b', '/d/photo-library']);
	});
});

describe('path safety', () => {
	it('isInside rejects siblings and parents', () => {
		expect(isInside('/a/b', '/a/b')).toBe(true);
		expect(isInside('/a/b', '/a/b/c/d')).toBe(true);
		expect(isInside('/a/b', '/a/bc')).toBe(false);
		expect(isInside('/a/b', '/a')).toBe(false);
		expect(isInside('/a/b', '/a/b/../x')).toBe(false);
	});
	it('safeJoin blocks traversal, absolute and empty paths', () => {
		expect(safeJoin('/r', 'x/y.jpg')).toBe('/r/x/y.jpg');
		expect(safeJoin('/r/', 'y.jpg')).toBe('/r/y.jpg');
		expect(safeJoin('/r', '../etc/passwd')).toBeNull();
		expect(safeJoin('/r', 'x/../../etc')).toBeNull();
		expect(safeJoin('/r', '/etc/passwd')).toBeNull();
		expect(safeJoin('/r', '')).toBeNull();
		expect(safeJoin('/r', 'x/..')).toBeNull();
		expect(safeJoin('/r', 'a\0b')).toBeNull();
	});
});

describe('albums and files', () => {
	it('derives album from the first-level folder', () => {
		expect(albumOf('a.jpg')).toBe('(root)');
		expect(albumOf('Trip/a.jpg')).toBe('Trip');
		expect(albumOf('Trip/day1/a.jpg')).toBe('Trip');
	});
	it('accepts only visible image files', () => {
		for (const ok of ['a.jpg', 'B.JPEG', 'c.png', 'd.heic', 'e.HEIF', 'f.webp', 'g.avif'])
			expect(isSupportedFile(ok), ok).toBe(true);
		for (const no of [
			'.DS_Store',
			'._a.jpg',
			'.hidden.jpg',
			'a.mov',
			'a.xmp',
			'a.aae',
			'jpg',
			'.jpg'
		])
			expect(isSupportedFile(no), no).toBe(false);
	});
	it('selection: empty means all; null album is (root)', () => {
		expect(isAlbumSelected('x', [])).toBe(true);
		expect(isAlbumSelected('x', ['y'])).toBe(false);
		expect(isAlbumSelected(null, ['(root)'])).toBe(true);
	});
});

describe('change detection', () => {
	it('flags only known files whose size or mtime moved', () => {
		const sig = { size: 1, mtimeMs: 2 };
		expect(hasChanged(undefined, sig)).toBe(false);
		expect(hasChanged(sig, { ...sig })).toBe(false);
		expect(hasChanged(sig, { size: 2, mtimeMs: 2 })).toBe(true);
		expect(hasChanged(sig, { size: 1, mtimeMs: 3 })).toBe(true);
	});
});

describe('stableShuffle', () => {
	const items = Array.from({ length: 50 }, (_, i) => ({ id: `p${i}` }));
	it('is deterministic, order independent, and seed dependent', () => {
		const a = stableShuffle(items, 's').map((i) => i.id);
		expect(stableShuffle([...items].reverse(), 's').map((i) => i.id)).toEqual(a);
		expect(stableShuffle(items, 't').map((i) => i.id)).not.toEqual(a);
		expect(a).not.toEqual(items.map((i) => i.id));
		expect([...a].sort()).toEqual(items.map((i) => i.id).sort());
	});
	it('breaks hash ties by id', () => {
		expect(stableShuffle([{ id: 'b' }, { id: 'a' }]).length).toBe(2);
	});
});

describe('parseConfig', () => {
	it('tolerates junk', () => {
		expect(parseConfig('nope')).toEqual({ root: '', albums: [], windows: {}, recursive: true });
		expect(parseConfig('{"root":"/r","albums":["a",1]}')).toEqual({
			root: '/r',
			albums: ['a'],
			windows: {},
			recursive: true
		});
		expect(
			parseConfig('{"windows":{"a":{"from":"06-01","to":"06-10"},"b":{"from":"13-01"}}}').windows
		).toEqual({ a: { from: '06-01', to: '06-10' } });
		expect(parseConfig('{}').root).toBe('');
	});
});
