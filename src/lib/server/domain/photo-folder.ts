import { isAbsolute, join, relative } from 'node:path';
import { parseWindows, type AlbumWindows } from './album-window.js';

export const ROOT_ALBUM = '(root)';
export const SUPPORTED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.heic', '.heif', '.webp', '.avif'];
export const DEFAULT_PHOTO_ROOT = '/media/photos-in';

/** Comma-separated absolute paths from HUB_PHOTO_ROOTS; the data volume's photo-library folder is always allowed. */
export function allowedRoots(env: Record<string, string | undefined> = process.env): string[] {
	const listed = (env.HUB_PHOTO_ROOTS ?? DEFAULT_PHOTO_ROOT)
		.split(',')
		.map((p) => p.trim())
		.filter((p) => isAbsolute(p));
	const dataDir = env.DATA_DIR ?? './data';
	return [...new Set([...listed, `${dataDir.replace(/\/+$/, '')}/photo-library`])];
}

/** Lexical containment: `child` is `base` itself or below it, with no `..` escape. */
export function isInside(base: string, child: string): boolean {
	const rel = relative(base, child);
	return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/** Joins a stored relative path onto `root`, or null if it would leave the root. */
export function safeJoin(root: string, rel: string): string | null {
	if (!rel || isAbsolute(rel) || rel.includes('\0')) return null;
	const full = join(root, rel);
	return full !== root && isInside(root, full) ? full : null;
}

/** Album is the first-level subfolder; files directly in the root belong to "(root)". */
export function albumOf(rel: string): string {
	const parts = rel.split(/[\\/]/);
	return parts.length > 1 ? parts[0]! : ROOT_ALBUM;
}

/** Visible image files only: no dotfiles, sidecars, or videos. */
export function isSupportedFile(name: string): boolean {
	if (name.startsWith('.') || name.startsWith('._')) return false;
	const dot = name.lastIndexOf('.');
	return dot > 0 && SUPPORTED_EXTENSIONS.includes(name.slice(dot).toLowerCase());
}

export const MOTION_EXTENSIONS = ['.mov', '.mp4'];

/** Companion clips of Live Photos: visible .mov/.mp4 files, never dotfiles or AppleDouble sidecars. */
export function isMotionFile(name: string): boolean {
	if (name.startsWith('.') || name.startsWith('._')) return false;
	const dot = name.lastIndexOf('.');
	return dot > 0 && MOTION_EXTENSIONS.includes(name.slice(dot).toLowerCase());
}

const stem = (rel: string) => rel.slice(0, rel.lastIndexOf('.')).toLowerCase();

/**
 * Live Photo pairs: IMG_1234.HEIC plus IMG_1234.MOV in the same folder (basename compared
 * case-insensitively). Returns photo path -> clip path. A .mov is preferred over a .mp4, and when
 * several photos share a stem (IMG_1.jpg and IMG_1.heic) each pairs with the same clip.
 */
export function pairMotion(photos: Iterable<string>, clips: Iterable<string>): Map<string, string> {
	const byStem = new Map<string, string>();
	for (const clip of [...clips].sort()) {
		const key = stem(clip);
		const have = byStem.get(key);
		if (!have || (!have.toLowerCase().endsWith('.mov') && clip.toLowerCase().endsWith('.mov')))
			byStem.set(key, clip);
	}
	const pairs = new Map<string, string>();
	for (const photo of photos) {
		const clip = byStem.get(stem(photo));
		if (clip) pairs.set(photo, clip);
	}
	return pairs;
}

export interface ByteRange {
	start: number;
	end: number;
}

/**
 * A single `bytes=` range against a file of `size` bytes. `null` = no (or unusable multi-range)
 * header, serve the whole file; 'unsatisfiable' = answer 416.
 */
export function parseRange(
	header: string | null,
	size: number
): ByteRange | null | 'unsatisfiable' {
	if (!header) return null;
	const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
	if (!m || (m[1] === '' && m[2] === '')) return null;
	let start: number;
	let end: number;
	if (m[1] === '') {
		const n = Number(m[2]);
		if (n === 0) return 'unsatisfiable';
		start = Math.max(0, size - n);
		end = size - 1;
	} else {
		start = Number(m[1]);
		end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
	}
	if (start >= size || start > end) return 'unsatisfiable';
	return { start, end };
}

export interface FileSig {
	size: number;
	mtimeMs: number;
}

/** A file is changed when its (size, mtime) differs from the last scan; unknown signatures count as unchanged. */
export function hasChanged(prev: FileSig | undefined, now: FileSig): boolean {
	return prev !== undefined && (prev.size !== now.size || prev.mtimeMs !== now.mtimeMs);
}

/** Empty selection means every album. */
export function isAlbumSelected(album: string | null, selected: string[]): boolean {
	return selected.length === 0 || selected.includes(album ?? ROOT_ALBUM);
}

function fnv(text: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
	return h;
}

/** Deterministic shuffle: same ids and seed always give the same order, regardless of input order. */
export function stableShuffle<T extends { id: string }>(items: T[], seed = ''): T[] {
	return items
		.map((item) => ({ item, key: fnv(`${seed}:${item.id}`) }))
		.sort((a, b) => a.key - b.key || (a.item.id < b.item.id ? -1 : 1))
		.map((x) => x.item);
}

export interface SourceConfig {
	root: string;
	albums: string[];
	/** Albums that only show between two days each year. */
	windows: AlbumWindows;
	recursive: true;
}

export function parseConfig(raw: string): SourceConfig {
	try {
		const c = JSON.parse(raw) as Partial<SourceConfig>;
		return {
			root: typeof c.root === 'string' ? c.root : '',
			albums: Array.isArray(c.albums) ? c.albums.filter((a) => typeof a === 'string') : [],
			windows: parseWindows(c.windows),
			recursive: true
		};
	} catch {
		return { root: '', albums: [], windows: {}, recursive: true };
	}
}
