import { error, redirect } from '@sveltejs/kit';
import { overHttps, requireAdult } from '#lib/server/auth.js';
import {
	authUrl,
	createPkce,
	PENDING_COOKIE,
	PENDING_TTL_MS,
	redirectUriFor,
	sealPending,
	SpotifyError
} from '#lib/server/domain/spotify.js';
import { getKeyring } from '#lib/server/keys.js';
import { spotifyClientId } from '#lib/server/spotify/index.js';
import type { RequestHandler } from './$types';

/**
 * Starts the Spotify login. The PKCE verifier and state ride in a sealed cookie: SameSite=Lax
 * (not Strict like the session) so it survives Spotify's redirect back to the callback.
 */
export const GET: RequestHandler = (event) => {
	requireAdult(event);
	const clientId = spotifyClientId();
	if (!clientId) error(400, 'Spotify is not set up yet: add HUB_SPOTIFY_CLIENT_ID to the hub .env');
	let redirectUri: string;
	try {
		redirectUri = redirectUriFor(event.url.origin);
	} catch (e) {
		if (e instanceof SpotifyError) error(400, e.message);
		throw e;
	}
	const { verifier, challenge, state } = createPkce();
	event.cookies.set(
		PENDING_COOKIE,
		sealPending(getKeyring(), {
			state,
			verifier,
			redirectUri,
			expiresAt: Date.now() + PENDING_TTL_MS
		}),
		{
			path: '/api/spotify',
			httpOnly: true,
			sameSite: 'lax',
			secure: overHttps(event),
			maxAge: PENDING_TTL_MS / 1000
		}
	);
	redirect(303, authUrl({ clientId, redirectUri, state, challenge }), {
		external: ['https://accounts.spotify.com']
	});
};
