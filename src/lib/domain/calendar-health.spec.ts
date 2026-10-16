import { describe, expect, it } from 'vitest';
import {
	STALE_AFTER_MS,
	classifyHealth,
	looksLikeGoogleAddress,
	reconnectMessage,
	relativeTime
} from './calendar-health';

const NOW = 1_000_000_000_000;
const MIN = 60_000;

describe('relativeTime', () => {
	it.each([
		[null, 'never'],
		[NOW - 10_000, 'just now'],
		[NOW + 5 * MIN, 'just now'],
		[NOW - 5 * MIN, '5 min ago'],
		[NOW - 60 * MIN, '1 hour ago'],
		[NOW - 150 * MIN, '2 hours ago'],
		[NOW - 24 * 60 * MIN, '1 day ago'],
		[NOW - 3 * 24 * 60 * MIN, '3 days ago']
	])('%s -> %s', (at, text) => expect(relativeTime(at, NOW)).toBe(text));
});

describe('classifyHealth', () => {
	const base = { needsReauth: false, lastError: null, lastSyncAt: NOW - 5 * MIN };
	it('is OK when recently synced', () => {
		expect(classifyHealth(base, NOW)).toMatchObject({ kind: 'ok', chip: 'OK', tone: 'success' });
		expect(classifyHealth(base, NOW).text).toContain('5 min ago');
	});
	it('is stale past the threshold', () => {
		const h = classifyHealth({ ...base, lastSyncAt: NOW - STALE_AFTER_MS - MIN }, NOW);
		expect(h.kind).toBe('stale');
	});
	it('is new before the first sync', () => {
		expect(classifyHealth({ ...base, lastSyncAt: null }, NOW).kind).toBe('new');
	});
	it('reports errors', () => {
		expect(classifyHealth({ ...base, lastError: 'boom' }, NOW).kind).toBe('error');
	});
	it('prefers reconnect over everything', () => {
		const h = classifyHealth({ needsReauth: true, lastError: 'x', lastSyncAt: null }, NOW);
		expect(h).toMatchObject({ kind: 'reauth', chip: 'Needs reconnect', tone: 'danger' });
	});
});

it('words the reconnect message with the label', () => {
	expect(reconnectMessage("Mom's Google")).toBe("Mom's Google calendar needs reconnecting.");
});

describe('looksLikeGoogleAddress', () => {
	it('accepts the redirect address and a bare code', () => {
		expect(looksLikeGoogleAddress('http://127.0.0.1:9004/?code=4/abc&state=x')).toBe(true);
		expect(looksLikeGoogleAddress('4/0AbCdEfGhIjKlMnOpQrStUv')).toBe(true);
	});
	it('rejects other text', () => {
		expect(looksLikeGoogleAddress('')).toBe(false);
		expect(looksLikeGoogleAddress('hello there')).toBe(false);
		expect(looksLikeGoogleAddress('https://example.com/page')).toBe(false);
	});
});
