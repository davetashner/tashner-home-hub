/**
 * Adult PIN hashing and validation (FAM-3, NFR-3).
 *
 * Stored format: `scrypt$v1$<N>$<r>$<p>$<salt b64>$<hash b64>`. The parameters are
 * embedded so they can be raised later without invalidating existing PINs.
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const SCRYPT = { N: 16384, r: 8, p: 1 } as const;
const SALT_BYTES = 16;
const HASH_BYTES = 32;
const PREFIX = 'scrypt$v1$';

export type PinCheck = { ok: true } | { ok: false; message: string };

export function validatePin(pin: unknown): PinCheck {
	if (typeof pin !== 'string' || !/^\d{4,6}$/.test(pin)) {
		return { ok: false, message: 'PIN must be 4 to 6 digits.' };
	}
	if (/^(\d)\1+$/.test(pin)) {
		return { ok: false, message: 'PIN is too easy to guess: avoid repeating one digit.' };
	}
	// Ascending or descending runs such as 1234, 4321, 123456, 6543.
	const diffs = [...pin].slice(1).map((c, i) => Number(c) - Number(pin[i]));
	if (diffs.every((d) => d === 1) || diffs.every((d) => d === -1)) {
		return { ok: false, message: 'PIN is too easy to guess: avoid counting up or down.' };
	}
	return { ok: true };
}

export function hashPin(pin: string): string {
	const salt = randomBytes(SALT_BYTES);
	const hash = scryptSync(pin, salt, HASH_BYTES, SCRYPT);
	const { N, r, p } = SCRYPT;
	return `${PREFIX}${N}$${r}$${p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

/** Constant-time check of a PIN against a stored hash. Malformed hashes never match. */
export function verifyPin(pin: string, encoded: string | null | undefined): boolean {
	if (typeof pin !== 'string' || !encoded?.startsWith(PREFIX)) return false;
	const parts = encoded.slice(PREFIX.length).split('$');
	if (parts.length !== 5) return false;
	const [N, r, p] = parts.slice(0, 3).map(Number);
	const salt = Buffer.from(parts[3], 'base64');
	const expected = Buffer.from(parts[4], 'base64');
	if (!N || !r || !p || salt.length === 0 || expected.length === 0) return false;
	try {
		const actual = scryptSync(pin, salt, expected.length, { N, r, p, maxmem: 128 * N * r * 2 });
		return timingSafeEqual(actual, expected);
	} catch {
		return false;
	}
}
