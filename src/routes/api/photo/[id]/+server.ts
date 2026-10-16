import { error } from '@sveltejs/kit';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { getPhotoCache } from '#lib/server/photo-cache/cache.js';
import {
	DEFAULT_TARGET,
	FORMATS,
	PARTS,
	parseDimension,
	type PhotoFormat,
	type PhotoPart
} from '#lib/server/domain/photo-fit.js';
import type { RequestHandler } from './$types';

const TYPES: Record<PhotoFormat, string> = { avif: 'image/avif', webp: 'image/webp' };

/** Open to the LAN: the wall display has no session (LAN gate is in hooks.server.ts). */
export const GET: RequestHandler = async ({ params, url, request }) => {
	const q = url.searchParams;
	const width = q.has('w') ? parseDimension(q.get('w')) : DEFAULT_TARGET.width;
	const height = q.has('h') ? parseDimension(q.get('h')) : DEFAULT_TARGET.height;
	const fmt = q.get('fmt') ?? 'avif';
	const part = q.get('part') ?? 'main';
	if (width === undefined || height === undefined) error(400, 'w and h must be 64-4096');
	if (!FORMATS.includes(fmt as PhotoFormat)) error(400, 'fmt must be avif or webp');
	if (!PARTS.includes(part as PhotoPart)) error(400, 'part must be main or bg');
	const target = { width, height };

	const cache = getPhotoCache();
	let hit = await cache.cachedVariant(params.id, target, fmt as PhotoFormat, part as PhotoPart);
	if (!hit) {
		let rendered;
		try {
			rendered = await cache.ensureRendered(params.id, target, [fmt as PhotoFormat]);
		} catch {
			error(404, 'Photo file is unavailable');
		}
		if (!rendered) error(404, 'Photo not found');
		hit = await cache.cachedVariant(params.id, target, fmt as PhotoFormat, part as PhotoPart);
		if (!hit) error(404, part === 'bg' ? 'No background for this photo' : 'Photo not found');
	}

	const etag = `"${hit.hash}-${width}x${height}-${part}-${fmt}"`;
	const headers = {
		ETag: etag,
		'Cache-Control': 'public, max-age=31536000, immutable',
		'Content-Type': TYPES[fmt as PhotoFormat]
	};
	if (request.headers.get('if-none-match') === etag)
		return new Response(null, { status: 304, headers });
	return new Response(Readable.toWeb(createReadStream(hit.path)) as ReadableStream, {
		headers: { ...headers, 'Content-Length': String(hit.size) }
	});
};
