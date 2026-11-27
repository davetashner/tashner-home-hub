import { error, json } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { requireAdult } from '#lib/server/auth.js';
import { MAX_UPLOAD_BYTES } from '#lib/server/domain/phone-upload.js';
import { UploadError, saveUpload } from '#lib/server/photo-source/phone-upload.js';
import type { RequestHandler } from './$types';

/**
 * One photo per request, sent as the raw image body (`content-type: image/*`), not a form. An
 * image content type is not CORS-safelisted, so a cross-origin page cannot send it without a
 * preflight this server never answers: the same protection the JSON endpoints rely on.
 */
export const POST: RequestHandler = async (event) => {
	requireAdult(event);
	const type = event.request.headers.get('content-type') ?? '';
	if (!type.toLowerCase().startsWith('image/')) error(415, 'Send the photo as an image body');
	const declared = Number(event.request.headers.get('content-length'));
	if (declared > MAX_UPLOAD_BYTES) error(413, 'That photo is too large');
	const bytes = new Uint8Array(await event.request.arrayBuffer());
	try {
		const saved = await saveUpload(getDb(), bytes);
		return json({ sourceId: saved.sourceId, photoId: saved.photoId }, { status: 201 });
	} catch (e) {
		if (e instanceof UploadError) error(400, e.message);
		throw e;
	}
};
