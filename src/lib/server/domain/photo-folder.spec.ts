import { describe, expect, it } from 'vitest';
import {
	albumOf,
	allowedRoots,
	hasChanged,
	isAlbumSelected,
	isInside,
	isMotionFile,
	pairMotion,
	parseRange,
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

describe('Live Photo pairs', () => {
	it('pairs a still with the clip of the same basename in the same folder', () => {
		const pairs = pairMotion(
			['IMG_1.HEIC', 'Trip/IMG_2.jpg', 'Trip/IMG_3.jpg', 'img_4.jpg'],
			['IMG_1.MOV', 'Trip/IMG_2.mov', 'Other/IMG_3.mov', 'IMG_4.mp4']
		);
		expect([...pairs]).toEqual([
			['IMG_1.HEIC', 'IMG_1.MOV'],
			['Trip/IMG_2.jpg', 'Trip/IMG_2.mov'],
			['img_4.jpg', 'IMG_4.mp4']
		]);
	});
	it('prefers a .mov over a .mp4 and lets sibling stills share a clip', () => {
		const pairs = pairMotion(['a.jpg', 'a.heic'], ['a.mp4', 'a.mov']);
		expect(pairs.get('a.jpg')).toBe('a.mov');
		expect(pairs.get('a.heic')).toBe('a.mov');
	});
	it('leaves photos without a clip, and standalone clips, alone', () => {
		expect(pairMotion(['a.jpg'], ['b.mov']).size).toBe(0);
		expect(pairMotion([], ['b.mov']).size).toBe(0);
	});
	it('only counts visible .mov/.mp4 files as clips', () => {
		expect(isMotionFile('IMG_1.MOV')).toBe(true);
		expect(isMotionFile('x.mp4')).toBe(true);
		expect(isMotionFile('._IMG_1.mov')).toBe(false);
		expect(isMotionFile('.hidden.mov')).toBe(false);
		expect(isMotionFile('x.jpg')).toBe(false);
		expect(isMotionFile('mov')).toBe(false);
	});
});

describe('parseRange', () => {
	it('serves everything when there is no usable header', () => {
		expect(parseRange(null, 100)).toBeNull();
		expect(parseRange('bytes=0-1,5-6', 100)).toBeNull();
		expect(parseRange('items=0-1', 100)).toBeNull();
		expect(parseRange('bytes=-', 100)).toBeNull();
	});
	it('parses closed, open-ended and suffix ranges, clamped to the file', () => {
		expect(parseRange('bytes=0-9', 100)).toEqual({ start: 0, end: 9 });
		expect(parseRange('bytes=90-', 100)).toEqual({ start: 90, end: 99 });
		expect(parseRange('bytes=90-500', 100)).toEqual({ start: 90, end: 99 });
		expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 });
		expect(parseRange('bytes=-500', 100)).toEqual({ start: 0, end: 99 });
	});
	it('rejects ranges outside the file', () => {
		expect(parseRange('bytes=100-', 100)).toBe('unsatisfiable');
		expect(parseRange('bytes=9-2', 100)).toBe('unsatisfiable');
		expect(parseRange('bytes=-0', 100)).toBe('unsatisfiable');
	});
});
