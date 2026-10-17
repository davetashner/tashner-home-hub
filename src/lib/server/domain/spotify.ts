import { createHash, randomBytes } from 'node:crypto';
import { decryptSecret, encryptSecret, type Keyring } from './secrets.js';

export const SCOPES = [
	'user-read-playback-state',
	'user-modify-playback-state',
	'playlist-read-private',
	'playlist-read-collaborative'
] as const;

export const endpoints = {
	auth: 'https://accounts.spotify.com/authorize',
	token: 'https://accounts.spotify.com/api/token',
	api: 'https://api.spotify.com'
};

/** How long an adult has to finish the Spotify consent screen. */
export const PENDING_COOKIE = 'hub_spotify_login';
export const PENDING_TTL_MS = 10 * 60_000;

/** A failure with a message that is safe to show an adult (never contains tokens). */
export class SpotifyError extends Error {
	constructor(
		message: string,
		readonly needsReauth = false
	) {
		super(message);
		this.name = 'SpotifyError';
	}
}

const b64url = (b: Buffer) => b.toString('base64url');

/** RFC 7636 S256 challenge for a verifier. */
export function challengeFor(verifier: string): string {
	return b64url(createHash('sha256').update(verifier).digest());
}

export function createPkce(): { verifier: string; challenge: string; state: string } {
	const verifier = b64url(randomBytes(48));
	return { verifier, challenge: challengeFor(verifier), state: b64url(randomBytes(24)) };
}

/** Spotify only accepts https redirect URIs (plus loopback for local development). */
export function redirectUriFor(origin: string): string {
	const u = new URL(origin);
	const loopback = ['127.0.0.1', '[::1]', 'localhost'].includes(u.hostname);
	if (u.protocol !== 'https:' && !(loopback && u.protocol === 'http:'))
		throw new SpotifyError(
			'Spotify needs a secure address: open the hub at its https address (for example https://hub.example.com) and connect from there'
		);
	return `${u.origin}/api/spotify/callback`;
}

export function authUrl(p: {
	clientId: string;
	redirectUri: string;
	state: string;
	challenge: string;
}): string {
	const u = new URL(endpoints.auth);
	u.search = new URLSearchParams({
		client_id: p.clientId,
		response_type: 'code',
		redirect_uri: p.redirectUri,
		scope: SCOPES.join(' '),
		state: p.state,
		code_challenge: p.challenge,
		code_challenge_method: 'S256'
	}).toString();
	return u.href;
}

export interface Pending {
	state: string;
	verifier: string;
	redirectUri: string;
	expiresAt: number;
}

const PENDING_AAD = 'spotify:oauth-pending';
const REFRESH_AAD = 'spotify:refresh-token';

/** The login cookie value: authenticated encryption keeps the verifier private and untampered. */
export function sealPending(keyring: Keyring, p: Pending): string {
	return encryptSecret(keyring, JSON.stringify(p), PENDING_AAD);
}

/** Null for anything forged, garbled, or older than its expiry. */
export function openPending(keyring: Keyring, sealed: string | undefined, now: number) {
	if (!sealed) return null;
	try {
		const p = JSON.parse(decryptSecret(keyring, sealed, PENDING_AAD)) as Pending;
		if (!p.state || !p.verifier || !p.redirectUri || p.expiresAt < now) return null;
		return p;
	} catch {
		return null;
	}
}

export const sealRefreshToken = (keyring: Keyring, token: string) =>
	encryptSecret(keyring, token, REFRESH_AAD);
export const openRefreshToken = (keyring: Keyring, sealed: string) =>
	decryptSecret(keyring, sealed, REFRESH_AAD);
