import { getDb } from '#lib/server/db/index.js';
import { publish } from '#lib/server/domain/events.js';
import { MAX_UPLOAD_BYTES } from '#lib/server/domain/phone-upload.js';
import { UploadError, saveUpload } from '#lib/server/photo-source/phone-upload.js';
import { authenticate, reply } from '#lib/server/siri.js';
import type { RequestHandler } from './$types';

/**
 * iPhone Share Sheet shortcut (hub-5yt.3): one photo per request as the raw image body, bearer
 * token with `photos:add`. It lands in the "From phones" album like the Send photos page.
 * `?show=1` also puts it on the wall displays at once ("Show now").
 */
export const POST: RequestHandler = async ({ request, url }) => {
	const auth = authenticate(request, 'photos:add');
	if ('response' in auth) return auth.response;
	const type = request.headers.get('content-type') ?? '';
	if (!type.toLowerCase().startsWith('image/'))
		return reply({ ok: false, speak: 'Send the photo as the request body.' }, 415);
	if (Number(request.headers.get('content-length')) > MAX_UPLOAD_BYTES)
		return reply({ ok: false, speak: 'That photo is too large.' }, 413);
	const bytes = new Uint8Array(await request.arrayBuffer());
	try {
		const saved = await saveUpload(getDb(), bytes);
		const show = url.searchParams.get('show') === '1' && saved.photoId;
		if (show) publish('frame', { photo: saved.photoId! });
		return reply({
			ok: true,
			photoId: saved.photoId,
			speak: show ? 'Sent to the hub and on the wall.' : 'Sent to the hub.'
		});
	} catch (e) {
		if (e instanceof UploadError) return reply({ ok: false, speak: `${e.message}.` }, 400);
		throw e;
	}
};
