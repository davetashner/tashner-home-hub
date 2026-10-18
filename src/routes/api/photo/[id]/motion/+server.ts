import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { createReadStream } from 'node:fs';
import { lstat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { getDb, schema } from '#lib/server/db/index.js';
import { parseRange } from '#lib/server/domain/photo-folder.js';
import { resolveMotionPath } from '#lib/server/photo-source/paths.js';
import type { RequestHandler } from './$types';

/**
 * A Live Photo's companion clip, with Range support so Chromium can seek (PHO-10). Open to the
 * LAN like the still: the wall display has no session. Never cached by the service worker.
 */
export const GET: RequestHandler = async ({ params, request }) => {
	const db = getDb();
	const photo = db.select().from(schema.photos).where(eq(schema.photos.id, params.id)).get();
	if (!photo?.motionPath) error(404, 'No clip for this photo');
	let path: string | null;
	try {
		path = resolveMotionPath(db, photo);
	} catch {
		error(404, 'Clip is unavailable');
	}
	// lstat: a symlink swapped in after the scan is refused, like the scanner's own walk.
	const st = path ? await lstat(path).catch(() => null) : null;
	if (!path || !st?.isFile()) error(404, 'Clip is unavailable');

	const headers = {
		'Content-Type': 'video/mp4',
		'Accept-Ranges': 'bytes',
		'Cache-Control': 'private, no-store'
	};
	const range = parseRange(request.headers.get('range'), st.size);
	if (range === 'unsatisfiable')
		return new Response(null, {
			status: 416,
			headers: { ...headers, 'Content-Range': `bytes */${st.size}` }
		});
	if (!range)
		return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream, {
			headers: { ...headers, 'Content-Length': String(st.size) }
		});
	return new Response(
		Readable.toWeb(
			createReadStream(path, { start: range.start, end: range.end })
		) as ReadableStream,
		{
			status: 206,
			headers: {
				...headers,
				'Content-Length': String(range.end - range.start + 1),
				'Content-Range': `bytes ${range.start}-${range.end}/${st.size}`
			}
		}
	);
};
