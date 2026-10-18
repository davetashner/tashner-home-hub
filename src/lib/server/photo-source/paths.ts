import { eq } from 'drizzle-orm';
import { isAbsolute, join } from 'node:path';
import { realpath, stat } from 'node:fs/promises';
import { schema, type Db } from '../db/index.js';
import { allowedRoots, isInside, parseConfig, safeJoin } from '../domain/photo-folder.js';

export class PhotoSourceError extends Error {}

/**
 * Validates a folder root: absolute, an existing directory, and, after resolving symlinks,
 * inside one of the allowed (also symlink-resolved) bases. Returns the resolved path.
 */
export async function validateRoot(root: unknown, env = process.env): Promise<string> {
	if (typeof root !== 'string' || !isAbsolute(root) || root.includes('\0'))
		throw new PhotoSourceError('Folder must be an absolute path');
	let real: string;
	try {
		real = await realpath(root);
		if (!(await stat(real)).isDirectory()) throw new Error('not a directory');
	} catch {
		throw new PhotoSourceError('Folder not found or is not a directory');
	}
	for (const base of allowedRoots(env)) {
		const realBase = await realpath(isAbsolute(base) ? base : join(process.cwd(), base)).catch(
			() => null
		);
		if (realBase && isInside(realBase, real)) return real;
	}
	throw new PhotoSourceError('Folder is outside the allowed photo locations (HUB_PHOTO_ROOTS)');
}

/** Cache resolver: folder-source paths are relative to the source root; others are absolute or cwd-relative. */
export function resolvePhotoPath(
	db: Db,
	photo: typeof schema.photos.$inferSelect,
	rel = photo.filePath
): string {
	const source = db
		.select()
		.from(schema.photoSources)
		.where(eq(schema.photoSources.id, photo.sourceId))
		.get();
	const root = source?.kind === 'folder' ? parseConfig(source.config).root : '';
	if (root) {
		const full = safeJoin(root, rel);
		if (!full) throw new PhotoSourceError('Photo path escapes its folder');
		return full;
	}
	return isAbsolute(rel) ? rel : join(process.cwd(), rel);
}

/** The Live Photo clip of a photo, or null; held to the same path-safety checks as the still. */
export function resolveMotionPath(db: Db, photo: typeof schema.photos.$inferSelect): string | null {
	return photo.motionPath ? resolvePhotoPath(db, photo, photo.motionPath) : null;
}
