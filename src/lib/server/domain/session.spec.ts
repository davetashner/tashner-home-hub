import { describe, expect, it } from 'vitest';
import {
	PHONE_TTL_MS,
	WALL_IDLE_MS,
	deriveSessionKey,
	newSession,
	refreshSession,
	safeNext,
	shouldRefresh,
	signSession,
	verifySession
} from './session';

const key = deriveSessionKey(Buffer.alloc(32, 7));

describe('sessions', () => {
	it('derives a distinct key from the master', () => {
		expect(key.equals(Buffer.alloc(32, 7))).toBe(false);
		expect(key.length).toBe(32);
	});
	it('uses 2 min for wall and 30 days for remembered phones', () => {
		expect(newSession('m1', false, 1000).exp).toBe(1000 + WALL_IDLE_MS);
		expect(newSession('m1', true, 1000).exp).toBe(1000 + PHONE_TTL_MS);
	});
	it('round-trips a valid token', () => {
		const p = newSession('m1', false, 1000);
		expect(verifySession(key, signSession(key, p), 2000)).toEqual(p);
	});
	it('rejects expired tokens', () => {
		const p = newSession('m1', false, 1000);
		expect(verifySession(key, signSession(key, p), p.exp)).toBeNull();
	});
	it('rejects tampered payloads and signatures', () => {
		const p = newSession('m1', false, 1000);
		const [body, sig] = signSession(key, p).split('.');
		const forged = Buffer.from(JSON.stringify({ ...p, m: 'm2' })).toString('base64url');
		expect(verifySession(key, `${forged}.${sig}`, 2000)).toBeNull();
		expect(verifySession(key, `${body}.${sig.slice(0, -2)}AA`, 2000)).toBeNull();
		expect(verifySession(key, `${body}.`, 2000)).toBeNull();
	});
	it('rejects a token signed with another key', () => {
		const other = deriveSessionKey(Buffer.alloc(32, 9));
		expect(verifySession(key, signSession(other, newSession('m1', true, 0)), 1)).toBeNull();
	});
	it('rejects garbage and wrongly shaped payloads', () => {
		expect(verifySession(key, '', 0)).toBeNull();
		expect(verifySession(key, 'a.b.c', 0)).toBeNull();
		const body = Buffer.from('{"m":1}').toString('base64url');
		const sig = Buffer.from(signSession(key, newSession('x', false, 0)).split('.')[1], 'base64url');
		expect(verifySession(key, `${body}.${sig.toString('base64url')}`, 0)).toBeNull();
	});
	it('rejects correctly signed non-JSON bodies', async () => {
		const { createHmac } = await import('node:crypto');
		const body = Buffer.from('not json').toString('base64url');
		const sig = createHmac('sha256', key).update(body).digest('base64url');
		expect(verifySession(key, `${body}.${sig}`, 0)).toBeNull();
	});
	it('slides expiry only when meaningfully old', () => {
		const p = newSession('m1', false, 0);
		expect(shouldRefresh(p, 1000)).toBe(false);
		expect(shouldRefresh(p, 6000)).toBe(true);
		const r = refreshSession(p, 6000);
		expect(r.exp).toBe(6000 + WALL_IDLE_MS);
		expect(r.m).toBe('m1');
	});
});

describe('safeNext', () => {
	it('allows local paths only', () => {
		expect(safeNext('/settings?tab=1')).toBe('/settings?tab=1');
		for (const bad of [
			null,
			undefined,
			'',
			'https://evil.test',
			'//evil.test',
			'/\\evil.test',
			'x'
		])
			expect(safeNext(bad)).toBe('/');
	});
});
