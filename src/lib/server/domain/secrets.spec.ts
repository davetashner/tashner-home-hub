import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createKeyring, decryptSecret, encryptSecret, keyIdOf, SecretsError } from './secrets.js';

const ring = () => createKeyring('a', { a: randomBytes(32) });

function mutate(ct: string, index: number): string {
	const parts = ct.split(':');
	const raw = Buffer.from(parts[index]!, 'base64url');
	raw[0] = raw[0]! ^ 1;
	parts[index] = raw.toString('base64url');
	return parts.join(':');
}

describe('secrets', () => {
	it('round-trips and uses a fresh IV each time', () => {
		const r = ring();
		const a = encryptSecret(r, 'refresh-token-fake');
		const b = encryptSecret(r, 'refresh-token-fake');
		expect(a).not.toBe(b);
		expect(a).toMatch(/^v1:a:[\w-]+:[\w-]+:[\w-]+$/);
		expect(a).not.toContain('refresh-token-fake');
		expect(decryptSecret(r, a)).toBe('refresh-token-fake');
		expect(keyIdOf(a)).toBe('a');
	});

	it('round-trips empty and unicode plaintext', () => {
		const r = ring();
		expect(decryptSecret(r, encryptSecret(r, ''))).toBe('');
		expect(decryptSecret(r, encryptSecret(r, 'pässwörd ✓'))).toBe('pässwörd ✓');
	});

	it('binds associated data', () => {
		const r = ring();
		const ct = encryptSecret(r, 'x', 'record-1');
		expect(decryptSecret(r, ct, 'record-1')).toBe('x');
		expect(() => decryptSecret(r, ct, 'record-2')).toThrow(SecretsError);
		expect(() => decryptSecret(r, ct)).toThrow(SecretsError);
	});

	it.each([
		['iv', 2],
		['tag', 3],
		['ciphertext', 4]
	])('detects tampered %s', (_n, idx) => {
		const r = ring();
		expect(() => decryptSecret(r, mutate(encryptSecret(r, 'secret'), idx))).toThrow(SecretsError);
	});

	it('rejects wrong key material and unknown key ids', () => {
		const r = ring();
		const ct = encryptSecret(r, 'secret');
		expect(() => decryptSecret(createKeyring('a', { a: randomBytes(32) }), ct)).toThrow(
			/Decryption failed/
		);
		expect(() => decryptSecret(createKeyring('b', { b: randomBytes(32) }), ct)).toThrow(
			/Unknown key id/
		);
	});

	it('supports rotation', () => {
		const oldKey = randomBytes(32);
		const old = createKeyring('a', { a: oldKey });
		const ct = encryptSecret(old, 'secret');
		const rotated = createKeyring('b', { a: oldKey, b: randomBytes(32) });
		expect(decryptSecret(rotated, ct)).toBe('secret');
		const fresh = encryptSecret(rotated, 'secret');
		expect(keyIdOf(fresh)).toBe('b');
		expect(decryptSecret(rotated, fresh)).toBe('secret');
	});

	it.each([
		'',
		'garbage',
		'v2:a:x:y:z',
		'v1:a:b:c',
		'v1:a:b:c:d:e',
		'v1:bad id!:AAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAA:AA',
		'v1:a:AAAA:AAAAAAAAAAAAAAAAAAAAAA:AA',
		'v1:a:AAAAAAAAAAAAAAAA:AAAA:AA',
		'v1:a:AAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAA:A+/='
	])('rejects malformed ciphertext %j', (bad) => {
		expect(() => decryptSecret(ring(), bad)).toThrow(SecretsError);
		expect(() => keyIdOf(bad)).toThrow(SecretsError);
	});

	it('validates keyrings', () => {
		expect(() => createKeyring('a', { a: randomBytes(16) })).toThrow(/32 bytes/);
		expect(() => createKeyring('a', { 'bad id': randomBytes(32) })).toThrow(/Invalid key id/);
		expect(() => createKeyring('missing', { a: randomBytes(32) })).toThrow(/not in the keyring/);
	});

	it('fails encrypt if active key vanished from a hand-built keyring', () => {
		expect(() => encryptSecret({ activeKeyId: 'z', keys: new Map() }, 'x')).toThrow(SecretsError);
	});
});
