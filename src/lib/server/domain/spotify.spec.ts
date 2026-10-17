import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createKeyring } from './secrets.js';
import {
	authUrl,
	challengeFor,
	createPkce,
	openPending,
	openRefreshToken,
	redirectUriFor,
	sealPending,
	sealRefreshToken,
	SCOPES,
	SpotifyError
} from './spotify.js';

const ring = () => createKeyring('a', { a: randomBytes(32) });

describe('PKCE', () => {
	it('matches the RFC 7636 appendix B vector', () => {
		expect(challengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
			'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
		);
	});
	it('creates a verifier whose S256 challenge matches, with a fresh state', () => {
		const a = createPkce();
		const b = createPkce();
		expect(a.verifier.length).toBeGreaterThanOrEqual(43);
		expect(a.challenge).toBe(createHash('sha256').update(a.verifier).digest('base64url'));
		expect(a.state).not.toBe(b.state);
		expect(a.verifier).not.toBe(b.verifier);
	});
});

describe('redirectUriFor', () => {
	it('accepts https and loopback http, rejects LAN http', () => {
		expect(redirectUriFor('https://hub.example.com')).toBe(
			'https://hub.example.com/api/spotify/callback'
		);
		expect(redirectUriFor('http://127.0.0.1:4173')).toBe(
			'http://127.0.0.1:4173/api/spotify/callback'
		);
		expect(() => redirectUriFor('http://192.168.1.5:3000')).toThrow(SpotifyError);
		expect(() => redirectUriFor('http://hub.local:3000')).toThrow(/https/);
	});
});

describe('authUrl', () => {
	it('carries PKCE, state, redirect and all scopes', () => {
		const u = new URL(
			authUrl({ clientId: 'cid', redirectUri: 'https://h/cb', state: 's1', challenge: 'ch' })
		);
		expect(u.origin + u.pathname).toBe('https://accounts.spotify.com/authorize');
		expect(u.searchParams.get('client_id')).toBe('cid');
		expect(u.searchParams.get('code_challenge_method')).toBe('S256');
		expect(u.searchParams.get('code_challenge')).toBe('ch');
		expect(u.searchParams.get('state')).toBe('s1');
		expect(u.searchParams.get('redirect_uri')).toBe('https://h/cb');
		expect(u.searchParams.get('scope')!.split(' ')).toEqual([...SCOPES]);
		expect(u.searchParams.has('client_secret')).toBe(false);
	});
});

describe('sealed login cookie and refresh token', () => {
	const p = { state: 's', verifier: 'v', redirectUri: 'https://h/cb', expiresAt: 2000 };
	it('round-trips until expiry', () => {
		const r = ring();
		const c = sealPending(r, p);
		expect(c).not.toContain('"v"');
		expect(openPending(r, c, 1000)).toEqual(p);
		expect(openPending(r, c, 2001)).toBeNull();
	});
	it('rejects missing, garbled, wrong-key and wrong-purpose values', () => {
		const r = ring();
		expect(openPending(r, undefined, 0)).toBeNull();
		expect(openPending(r, 'junk', 0)).toBeNull();
		expect(openPending(ring(), sealPending(r, p), 0)).toBeNull();
		expect(openPending(r, sealRefreshToken(r, JSON.stringify(p)), 0)).toBeNull();
		expect(openPending(r, sealPending(r, { ...p, state: '' }), 0)).toBeNull();
	});
	it('round-trips the refresh token without exposing it', () => {
		const r = ring();
		const s = sealRefreshToken(r, 'refresh-fake');
		expect(s).not.toContain('refresh-fake');
		expect(openRefreshToken(r, s)).toBe('refresh-fake');
	});
});
