import { describe, expect, it } from 'vitest';
import {
	MAX_UPLOAD_BYTES,
	checkUpload,
	exifDateTime,
	sniffImage,
	uploadFileName,
	uploadRoot
} from './phone-upload.js';

const bytes = (head: number[] | string, len = 16) => {
	const h = typeof head === 'string' ? [...head].map((c) => c.charCodeAt(0)) : head;
	const b = new Uint8Array(Math.max(len, h.length));
	b.set(h);
	return b;
};
const ftyp = (brand: string) => bytes(`\0\0\0\x18ftyp${brand}`);

describe('sniffImage', () => {
	it('recognises photo formats by their bytes', () => {
		expect(sniffImage(bytes([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpeg');
		expect(sniffImage(bytes('\x89PNG\r\n\x1a\n'))).toBe('png');
		expect(sniffImage(bytes('RIFF\0\0\0\0WEBP'))).toBe('webp');
		expect(sniffImage(ftyp('avif'))).toBe('avif');
		expect(sniffImage(ftyp('avis'))).toBe('avif');
		expect(sniffImage(ftyp('heic'))).toBe('heic');
		expect(sniffImage(ftyp('mif1'))).toBe('heic');
	});

	it('rejects everything else', () => {
		expect(sniffImage(bytes('<svg xmlns="x">'))).toBeNull();
		expect(sniffImage(ftyp('qt  '))).toBeNull();
		expect(sniffImage(bytes('RIFF\0\0\0\0WAVE'))).toBeNull();
		expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff]))).toBeNull();
	});
});

describe('checkUpload', () => {
	it('accepts decodable photos', () => {
		expect(checkUpload(bytes([0xff, 0xd8, 0xff]))).toEqual({ ok: true, kind: 'jpeg' });
	});

	it('explains why a file is refused', () => {
		expect(checkUpload(new Uint8Array())).toMatchObject({ ok: false, message: /empty/ });
		expect(checkUpload(bytes([0xff, 0xd8, 0xff], MAX_UPLOAD_BYTES + 1))).toMatchObject({
			ok: false,
			message: /too large/
		});
		expect(checkUpload(bytes('hello world, plain'))).toMatchObject({
			ok: false,
			message: /not a photo/
		});
		expect(checkUpload(ftyp('heic'))).toMatchObject({ ok: false, message: /HEIC/ });
	});
});

describe('uploadFileName', () => {
	it('is sortable, unique per suffix and safe', () => {
		expect(uploadFileName(1_700_000_000_123.9, 'AB-c/../d')).toBe('phone-1700000000123-abcd.jpg');
		expect(uploadFileName(-5, '!!!')).toBe('phone-0-x.jpg');
		expect(uploadFileName(1, 'abcdefghijklmnop')).toBe('phone-1-abcdefghijkl.jpg');
	});
});

describe('uploadRoot', () => {
	it('is a dot folder inside the data volume photo library', () => {
		expect(uploadRoot()).toBe('./data/photo-library/.phone-uploads');
		expect(uploadRoot('/data//')).toBe('/data/photo-library/.phone-uploads');
	});
});

describe('exifDateTime', () => {
	it('round-trips the capture time into EXIF form', () => {
		expect(exifDateTime(Date.UTC(2019, 4, 6, 7, 8, 9))).toBe('2019:05:06 07:08:09');
		expect(exifDateTime(undefined)).toBeUndefined();
		expect(exifDateTime(Number.NaN)).toBeUndefined();
	});
});
