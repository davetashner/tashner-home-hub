/** Pure helpers for photos sent from a phone (hub-5yt.1). */

/** Name of the photo-library source (and its single album) that phone uploads land in. */
export const UPLOAD_LABEL = 'From phones';
export const UPLOAD_ALBUM = 'From phones';

/** adapter-node caps bodies at BODY_SIZE_LIMIT (20M in the image); stay just under it. */
export const MAX_UPLOAD_BYTES = 19 * 1024 * 1024;

/** Longest edge kept on disk: sharper than the 4K panel needs, a fraction of a 48 MP original. */
export const MAX_EDGE = 4096;

export type ImageKind = 'jpeg' | 'png' | 'webp' | 'avif' | 'heic';

const ascii = (b: Uint8Array, from: number, to: number) =>
	String.fromCharCode(...b.subarray(from, to));

/** The image type from its first bytes, ignoring whatever the client claimed. */
export function sniffImage(b: Uint8Array): ImageKind | null {
	if (b.length < 12) return null;
	if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
	if (ascii(b, 0, 8) === '\x89PNG\r\n\x1a\n') return 'png';
	if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') return 'webp';
	if (ascii(b, 4, 8) === 'ftyp') {
		const brand = ascii(b, 8, 12);
		if (brand === 'avif' || brand === 'avis') return 'avif';
		if (['heic', 'heix', 'hevc', 'heim', 'heis', 'mif1', 'msf1'].includes(brand)) return 'heic';
	}
	return null;
}

export type UploadCheck = { ok: true; kind: ImageKind } | { ok: false; message: string };

/** Whether these bytes are a photo the hub can store. HEIC needs a decoder the server lacks. */
export function checkUpload(b: Uint8Array): UploadCheck {
	if (b.length === 0) return { ok: false, message: 'That file is empty' };
	if (b.length > MAX_UPLOAD_BYTES) return { ok: false, message: 'That photo is too large' };
	const kind = sniffImage(b);
	if (!kind) return { ok: false, message: 'That file is not a photo' };
	if (kind === 'heic')
		return {
			ok: false,
			message: 'HEIC photos are not supported yet. Send it as JPEG (Most Compatible)'
		};
	return { ok: true, kind };
}

/** Unique, sortable file name: `phone-<epoch ms>-<suffix>.jpg`, suffix reduced to [a-z0-9]. */
export function uploadFileName(now: number, suffix: string): string {
	const tail =
		suffix
			.toLowerCase()
			.replace(/[^a-z0-9]/g, '')
			.slice(0, 12) || 'x';
	return `phone-${Math.max(0, Math.trunc(now))}-${tail}.jpg`;
}

/**
 * Where uploads live: inside the data volume's always-allowed photo-library folder, in a dot
 * folder so a library source rooted at photo-library (whose scan skips dot entries) does not
 * pick the same photos up a second time.
 */
export function uploadRoot(dataDir = './data'): string {
	return `${dataDir.replace(/\/+$/, '')}/photo-library/.phone-uploads`;
}

/**
 * The capture time (as read by parseExifTakenAt: local wall time stored as UTC ms) back in EXIF
 * `YYYY:MM:DD HH:MM:SS` form, so it survives re-encoding while every other tag is dropped.
 */
export function exifDateTime(takenAt: number | undefined): string | undefined {
	if (takenAt === undefined || !Number.isFinite(takenAt)) return undefined;
	const iso = new Date(takenAt).toISOString();
	return `${iso.slice(0, 10).replaceAll('-', ':')} ${iso.slice(11, 19)}`;
}
