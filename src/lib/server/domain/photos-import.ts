/** Pure helpers for importing picked Google Photos into a photo folder. */

const MAX_ALBUM_LENGTH = 80;

/** `Google Photos import YYYY-MM-DD` for the given local date. */
export function defaultAlbumName(localDate: string): string {
	return `Google Photos import ${localDate}`;
}

/**
 * A single safe folder name: no separators, control characters or leading dots, bounded length.
 * Falls back to `fallback` when nothing usable is left.
 */
export function sanitizeAlbumName(input: unknown, fallback: string): string {
	const text = typeof input === 'string' ? input : '';
	const cleaned = text
		// eslint-disable-next-line no-control-regex
		.replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, ' ')
		.replace(/\.{2,}/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/^\.+/, '')
		.trim()
		.slice(0, MAX_ALBUM_LENGTH)
		.trim();
	return cleaned || fallback;
}

const EXTENSIONS: Record<string, string> = {
	'image/jpeg': '.jpg',
	'image/jpg': '.jpg',
	'image/png': '.png',
	'image/webp': '.webp',
	'image/heic': '.heic',
	'image/heif': '.heif',
	'image/avif': '.avif'
};

export interface PickedItem {
	id: string;
	type?: string;
	mediaFile?: { baseUrl?: string; mimeType?: string; filename?: string };
}

/** Photos only (videos are skipped for now) and only formats the library scanner accepts. */
export function isImportable(item: PickedItem): boolean {
	const mime = item.mediaFile?.mimeType?.toLowerCase().split(';')[0]?.trim() ?? '';
	return (
		typeof item.id === 'string' &&
		item.id.length > 0 &&
		!!item.mediaFile?.baseUrl &&
		(item.type === undefined || item.type === 'PHOTO') &&
		mime in EXTENSIONS
	);
}

/** Stable file name carrying the media item id, so a rerun recognises what it already has. */
export function importFileName(item: PickedItem): string {
	const id = item.id.replace(/[^A-Za-z0-9_-]/g, '');
	const mime = item.mediaFile?.mimeType?.toLowerCase().split(';')[0]?.trim() ?? '';
	return `gp-${id}${EXTENSIONS[mime] ?? '.jpg'}`;
}

/** Google's polling hint is a duration string like "5s"; clamp it to something sane. */
export function parseDurationMs(text: unknown, fallbackMs: number): number {
	const m = typeof text === 'string' ? /^(\d+(?:\.\d+)?)s$/.exec(text) : null;
	const ms = m ? Number(m[1]) * 1000 : fallbackMs;
	return Math.min(30_000, Math.max(1_000, ms));
}
