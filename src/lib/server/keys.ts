import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { createKeyring, SecretsError, type Keyring } from '#lib/server/domain/secrets.js';

/** Id of the key loaded from env or the key file. Add new ids when rotating. */
export const DEFAULT_KEY_ID = 'k1';

function decodeKey(b64: string, source: string): Buffer {
	const trimmed = b64.trim();
	const key = Buffer.from(trimmed, 'base64');
	// Round-trip check rejects garbage that Buffer.from would silently truncate.
	if (key.length !== 32 || key.toString('base64') !== trimmed) {
		throw new SecretsError(
			`${source} must be base64 for exactly 32 bytes (e.g. openssl rand -base64 32)`
		);
	}
	return key;
}

export interface KeyEnv {
	HUB_SECRET_KEY?: string | undefined;
	DATA_DIR?: string | undefined;
}

/** Load the keyring from HUB_SECRET_KEY, else `${DATA_DIR}/secret.key` (created 0600 on first run). */
export function loadKeyring(env: KeyEnv): Keyring {
	let key: Buffer;
	if (env.HUB_SECRET_KEY) {
		key = decodeKey(env.HUB_SECRET_KEY, 'HUB_SECRET_KEY');
	} else {
		const file = join(env.DATA_DIR || './data', 'secret.key');
		if (existsSync(file)) {
			key = decodeKey(readFileSync(file, 'utf8'), `Key file ${file}`);
		} else {
			mkdirSync(dirname(file), { recursive: true });
			key = randomBytes(32);
			writeFileSync(file, key.toString('base64') + '\n', { mode: 0o600, flag: 'wx' });
			chmodSync(file, 0o600);
		}
	}
	return createKeyring(DEFAULT_KEY_ID, { [DEFAULT_KEY_ID]: key });
}

let cached: Keyring | undefined;

/** Process-wide keyring, loaded lazily from the real environment. */
export function getKeyring(): Keyring {
	cached ??= loadKeyring({
		HUB_SECRET_KEY: process.env.HUB_SECRET_KEY,
		DATA_DIR: process.env.DATA_DIR
	});
	return cached;
}
