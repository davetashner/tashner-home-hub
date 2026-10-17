import { openPending, PENDING_COOKIE, SpotifyError } from '#lib/server/domain/spotify.js';
import { getKeyring } from '#lib/server/keys.js';
import { completeLogin } from '#lib/server/spotify/index.js';
import type { RequestHandler } from './$types';

const NEXT = '/settings/music';

/**
 * Not session-gated: the session cookie is SameSite=Strict, so the browser withholds it on this
 * redirect from Spotify. The sealed login cookie, which only an adult could have been issued,
 * plus the matching state, is the proof. Answers with a page that navigates on (a same-site hop)
 * so the session cookie is sent again when Settings loads.
 */
export const GET: RequestHandler = async (event) => {
	const pending = openPending(getKeyring(), event.cookies.get(PENDING_COOKIE), Date.now());
	event.cookies.delete(PENDING_COOKIE, { path: '/api/spotify' });
	const q = event.url.searchParams;
	let result = 'error';
	if (q.get('error')) result = 'denied';
	else if (pending && q.get('state') === pending.state && q.get('code')) {
		try {
			await completeLogin({
				code: q.get('code')!,
				verifier: pending.verifier,
				redirectUri: pending.redirectUri
			});
			result = 'connected';
		} catch (e) {
			if (!(e instanceof SpotifyError)) throw e;
			result = 'failed';
		}
	}
	const target = `${NEXT}?spotify=${result}`;
	return new Response(
		`<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${target}"><title>Spotify</title><a href="${target}">Continue</a>`,
		{ headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } }
	);
};
