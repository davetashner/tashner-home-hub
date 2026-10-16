export interface Size {
	width: number;
	height: number;
}

export const DEFAULT_TARGET: Size = { width: 2560, height: 1440 };
export const MIN_DIMENSION = 64;
export const MAX_DIMENSION = 4096;
export const FILL_TOLERANCE_PX = 2;

export const FORMATS = ['avif', 'webp'] as const;
export type PhotoFormat = (typeof FORMATS)[number];
export const PARTS = ['main', 'bg'] as const;
export type PhotoPart = (typeof PARTS)[number];

/** EXIF orientations 5-8 transpose the image, swapping width and height. */
export function orientedSize(size: Size, orientation: number | undefined): Size {
	return orientation !== undefined && orientation >= 5 && orientation <= 8
		? { width: size.height, height: size.width }
		: size;
}

/**
 * Largest size that fits inside `target` keeping aspect ratio, never upscaling
 * (scale is capped at 1.0). Each side is at least 1px (extreme panoramas).
 */
export function fitWithin(source: Size, target: Size): Size {
	if (source.width <= 0 || source.height <= 0) throw new RangeError('Invalid source size');
	const scale = Math.min(target.width / source.width, target.height / source.height, 1);
	return {
		width: Math.max(1, Math.round(source.width * scale)),
		height: Math.max(1, Math.round(source.height * scale))
	};
}

/** True when the fitted image leaves bars (portrait on landscape, panorama, small image). */
export function needsBackground(fitted: Size, target: Size): boolean {
	return (
		target.width - fitted.width > FILL_TOLERANCE_PX ||
		target.height - fitted.height > FILL_TOLERANCE_PX
	);
}

export interface RenderPlan {
	main: Size;
	background: boolean;
}

export function planRender(
	source: Size,
	orientation: number | undefined,
	target: Size
): RenderPlan {
	const main = fitWithin(orientedSize(source, orientation), target);
	return { main, background: needsBackground(main, target) };
}

/** Clamps a requested dimension to a sane integer; returns undefined if not a number. */
export function parseDimension(raw: string | null | undefined): number | undefined {
	if (raw === null || raw === undefined || !/^\d{1,5}$/.test(raw)) return undefined;
	const n = Number(raw);
	if (n < MIN_DIMENSION || n > MAX_DIMENSION) return undefined;
	return n;
}

/** Idempotent file name: same content + size + part + format always maps to the same file. */
export function variantName(hash: string, target: Size, part: PhotoPart, format: PhotoFormat) {
	return `${hash}-${target.width}x${target.height}-${part}.${format}`;
}

export interface CacheEntry {
	key: string;
	size: number;
	/** Last access time, epoch ms. */
	usedAt: number;
}

/** Keys to delete (least recently used first) so the remaining total is <= maxBytes. */
export function selectEvictions(entries: CacheEntry[], maxBytes: number): string[] {
	let total = entries.reduce((sum, e) => sum + e.size, 0);
	if (total <= maxBytes) return [];
	const out: string[] = [];
	for (const e of [...entries].sort((a, b) => a.usedAt - b.usedAt || a.key.localeCompare(b.key))) {
		if (total <= maxBytes) break;
		out.push(e.key);
		total -= e.size;
	}
	return out;
}

/**
 * DateTimeOriginal from a raw EXIF block (as returned by sharp's `metadata().exif`).
 * EXIF stores local time without a zone; it is interpreted as UTC so values are stable
 * regardless of server zone. Returns undefined when absent or malformed.
 */
export function parseExifTakenAt(exif: Uint8Array | undefined): number | undefined {
	if (!exif) return undefined;
	try {
		const view = new DataView(exif.buffer, exif.byteOffset, exif.byteLength);
		const base = String.fromCharCode(...exif.subarray(0, 4)) === 'Exif' ? 6 : 0;
		const le = exif[base] === 0x49; // 'II' little-endian, 'MM' big-endian
		const u16 = (o: number) => view.getUint16(base + o, le);
		const u32 = (o: number) => view.getUint32(base + o, le);
		const findTag = (ifd: number, tag: number) => {
			for (let i = 0, n = u16(ifd); i < n; i++)
				if (u16(ifd + 2 + i * 12) === tag) return ifd + 2 + i * 12;
			throw new RangeError('tag not found');
		};
		const entry = findTag(u32(findTag(u32(4), 0x8769) + 8), 0x9003);
		const at = base + (u32(entry + 4) > 4 ? u32(entry + 8) : entry + 8);
		const text = String.fromCharCode(...exif.subarray(at, at + 19));
		const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(text);
		if (!m) return undefined;
		const [y, mo, d, h, mi, sec] = m.slice(1).map(Number);
		return mo < 1 || mo > 12 || d < 1 || d > 31 ? undefined : Date.UTC(y, mo - 1, d, h, mi, sec);
	} catch {
		return undefined;
	}
}
