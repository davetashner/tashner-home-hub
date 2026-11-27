import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import type { Db } from '../db/index.js';
import { photoSources } from '../db/schema.js';
import { parseExifTakenAt } from '../domain/photo-fit.js';
import { parseConfig } from '../domain/photo-folder.js';
import {
	MAX_EDGE,
	UPLOAD_ALBUM,
	UPLOAD_LABEL,
	checkUpload,
	exifDateTime,
	uploadFileName,
	uploadRoot
} from '../domain/phone-upload.js';
import { validateRoot } from './paths.js';
import { scanAndPrerender } from './service.js';

export class UploadError extends Error {}

export interface UploadDeps {
	env?: Record<string, string | undefined>;
	now?: () => number;
}

let creating: Promise<string> | null = null;

/** The "From phones" folder source, created (with its folder) on first use. Returns its id. */
export function ensureUploadSource(db: Db, env = process.env): Promise<string> {
	// One at a time, so two photos sent together cannot create two sources.
	const run = (creating ?? Promise.resolve('')).then(() => findOrCreate(db, env));
	creating = run.catch(() => '');
	return run;
}

async function findOrCreate(db: Db, env: Record<string, string | undefined>): Promise<string> {
	const dir = resolve(uploadRoot(env.DATA_DIR));
	await mkdir(join(dir, UPLOAD_ALBUM), { recursive: true });
	const root = await validateRoot(dir, env);
	const found = db
		.select()
		.from(photoSources)
		.all()
		.find((s) => s.kind === 'folder' && parseConfig(s.config).root === root);
	if (found) return found.id;
	const id = randomUUID();
	db.insert(photoSources)
		.values({
			id,
			kind: 'folder',
			label: UPLOAD_LABEL,
			config: JSON.stringify({ root, albums: [], recursive: true })
		})
		.run();
	return id;
}

/**
 * Re-encodes the photo as JPEG: upright, at most MAX_EDGE on the long side, and with every
 * metadata tag dropped (GPS, device, faces) except the capture time the slideshow sorts by.
 */
export async function normalizePhoto(bytes: Uint8Array): Promise<Buffer> {
	let takenAt: string | undefined;
	try {
		takenAt = exifDateTime(parseExifTakenAt((await sharp(bytes).metadata()).exif));
	} catch {
		throw new UploadError('That photo could not be read');
	}
	let img = sharp(bytes, { failOn: 'error' })
		.rotate()
		.resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true });
	if (takenAt) img = img.withExif({ IFD2: { DateTimeOriginal: takenAt } });
	return img
		.jpeg({ quality: 88, mozjpeg: true })
		.toBuffer()
		.catch(() => {
			throw new UploadError('That photo could not be read');
		});
}

/** Stores one sent photo in the "From phones" album and adds it to the library. */
export async function saveUpload(
	db: Db,
	bytes: Uint8Array,
	deps: UploadDeps = {}
): Promise<{ sourceId: string; file: string }> {
	const check = checkUpload(bytes);
	if (!check.ok) throw new UploadError(check.message);
	const jpeg = await normalizePhoto(bytes);
	const env = deps.env ?? process.env;
	const sourceId = await ensureUploadSource(db, env);
	const dir = join(resolve(uploadRoot(env.DATA_DIR)), UPLOAD_ALBUM);
	const file = uploadFileName((deps.now ?? Date.now)(), randomBytes(6).toString('hex'));
	const part = join(dir, `.part-${randomUUID()}`);
	await writeFile(part, jpeg);
	await rename(part, join(dir, file)).catch(async (e) => {
		await rm(part, { force: true });
		throw e;
	});
	await scanAndPrerender(db, sourceId);
	return { sourceId, file };
}
