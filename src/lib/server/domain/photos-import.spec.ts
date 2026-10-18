import { describe, expect, it } from 'vitest';
import {
	defaultAlbumName,
	importFileName,
	isImportable,
	parseDurationMs,
	sanitizeAlbumName
} from './photos-import.js';

describe('sanitizeAlbumName', () => {
	const fb = 'Fallback';
	it('keeps ordinary names', () => expect(sanitizeAlbumName('Beach 2026', fb)).toBe('Beach 2026'));
	it('strips separators and traversal', () => {
		expect(sanitizeAlbumName('../../etc/passwd', fb)).toBe('etc passwd');
		expect(sanitizeAlbumName('a\\b/c', fb)).toBe('a b c');
		expect(sanitizeAlbumName('..', fb)).toBe(fb);
		expect(sanitizeAlbumName('.hidden', fb)).toBe('hidden');
	});
	it('falls back for empty or non-string input', () => {
		expect(sanitizeAlbumName('   ', fb)).toBe(fb);
		expect(sanitizeAlbumName(undefined, fb)).toBe(fb);
		expect(sanitizeAlbumName('\u0000\u0001', fb)).toBe(fb);
	});
	it('bounds the length', () => expect(sanitizeAlbumName('x'.repeat(500), fb)).toHaveLength(80));
});

describe('items', () => {
	const item = (over = {}) => ({
		id: 'AbC_-123',
		type: 'PHOTO',
		mediaFile: { baseUrl: 'https://x/y', mimeType: 'image/jpeg' },
		...over
	});
	it('names the default album by date', () =>
		expect(defaultAlbumName('2026-10-18')).toBe('Google Photos import 2026-10-18'));
	it('accepts photos and rejects videos or unknown types', () => {
		expect(isImportable(item())).toBe(true);
		expect(isImportable(item({ type: 'VIDEO' }))).toBe(false);
		expect(isImportable(item({ mediaFile: { baseUrl: 'u', mimeType: 'video/mp4' } }))).toBe(false);
		expect(isImportable(item({ mediaFile: { mimeType: 'image/png' } }))).toBe(false);
	});
	it('builds a file name from the id and type', () => {
		expect(importFileName(item())).toBe('gp-AbC_-123.jpg');
		expect(importFileName(item({ id: '../x', mediaFile: { mimeType: 'image/heic' } }))).toBe(
			'gp-x.heic'
		);
	});
	it('parses polling durations within bounds', () => {
		expect(parseDurationMs('5s', 1)).toBe(5000);
		expect(parseDurationMs('0.2s', 1)).toBe(1000);
		expect(parseDurationMs('900s', 1)).toBe(30000);
		expect(parseDurationMs(undefined, 7000)).toBe(7000);
	});
});
