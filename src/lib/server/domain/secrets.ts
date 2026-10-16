import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM envelope encryption for stored credentials (NFR-3).
 *
 * Ciphertext format: `v1:<keyId>:<iv>:<tag>:<ciphertext>` where iv, tag and
 * ciphertext are base64url. The key id lets us rotate keys: encrypt with the
 * active key, decrypt with whichever key produced the message.
 */

const VERSION = 'v1';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

export class SecretsError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'SecretsError';
	}
}

export interface Keyring {
	/** Id of the key used for new encryptions. Must exist in `keys`. */
	activeKeyId: string;
	/** Key id to 32-byte key. Keep old keys here so old ciphertext still decrypts. */
	keys: ReadonlyMap<string, Buffer>;
}

export function createKeyring(activeKeyId: string, keys: Record<string, Buffer>): Keyring {
	const map = new Map<string, Buffer>();
	for (const [id, key] of Object.entries(keys)) {
		if (!KEY_ID_PATTERN.test(id)) throw new SecretsError(`Invalid key id: ${id}`);
		if (key.length !== KEY_BYTES) throw new SecretsError(`Key "${id}" must be 32 bytes`);
		map.set(id, key);
	}
	if (!map.has(activeKeyId))
		throw new SecretsError(`Active key "${activeKeyId}" is not in the keyring`);
	return { activeKeyId, keys: map };
}

function aadBuffer(aad: string | undefined): Buffer | undefined {
	return aad === undefined ? undefined : Buffer.from(aad, 'utf8');
}

export function encryptSecret(keyring: Keyring, plaintext: string, aad?: string): string {
	const key = keyring.keys.get(keyring.activeKeyId);
	if (!key) throw new SecretsError(`Active key "${keyring.activeKeyId}" is not in the keyring`);
	const iv = randomBytes(IV_BYTES);
	const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
	const ad = aadBuffer(aad);
	if (ad) cipher.setAAD(ad);
	const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
	const tag = cipher.getAuthTag();
	return [
		VERSION,
		keyring.activeKeyId,
		iv.toString('base64url'),
		tag.toString('base64url'),
		ct.toString('base64url')
	].join(':');
}

/** Returns the id of the key that produced `ciphertext`, or throws if malformed. */
export function keyIdOf(ciphertext: string): string {
	return parse(ciphertext).keyId;
}

interface Parsed {
	keyId: string;
	iv: Buffer;
	tag: Buffer;
	ct: Buffer;
}

const B64URL = /^[A-Za-z0-9_-]*$/;

function parse(ciphertext: string): Parsed {
	const parts = ciphertext.split(':');
	if (parts.length !== 5 || parts[0] !== VERSION) {
		throw new SecretsError('Malformed or unsupported ciphertext');
	}
	const [, keyId, ivS, tagS, ctS] = parts as [string, string, string, string, string];
	if (!KEY_ID_PATTERN.test(keyId) || ![ivS, tagS, ctS].every((s) => B64URL.test(s))) {
		throw new SecretsError('Malformed or unsupported ciphertext');
	}
	const iv = Buffer.from(ivS, 'base64url');
	const tag = Buffer.from(tagS, 'base64url');
	if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
		throw new SecretsError('Malformed or unsupported ciphertext');
	}
	return { keyId, iv, tag, ct: Buffer.from(ctS, 'base64url') };
}

export function decryptSecret(keyring: Keyring, ciphertext: string, aad?: string): string {
	const { keyId, iv, tag, ct } = parse(ciphertext);
	const key = keyring.keys.get(keyId);
	if (!key) throw new SecretsError(`Unknown key id "${keyId}"`);
	const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
	const ad = aadBuffer(aad);
	if (ad) decipher.setAAD(ad);
	decipher.setAuthTag(tag);
	try {
		return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
	} catch {
		// Do not leak crypto internals; any auth failure looks the same.
		throw new SecretsError('Decryption failed (wrong key, wrong context, or tampered data)');
	}
}
