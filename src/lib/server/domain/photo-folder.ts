import { isAbsolute, join, relative } from 'node:path';

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
	recursive: true;
}

export function parseConfig(raw: string): SourceConfig {
	try {
		const c = JSON.parse(raw) as Partial<SourceConfig>;
		return {
			root: typeof c.root === 'string' ? c.root : '',
			albums: Array.isArray(c.albums) ? c.albums.filter((a) => typeof a === 'string') : [],
			recursive: true
		};
	} catch {
		return { root: '', albums: [], recursive: true };
	}
}
