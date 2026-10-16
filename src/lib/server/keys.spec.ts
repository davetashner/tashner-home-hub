import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret } from '#lib/server/domain/secrets.js';
import { loadKeyring } from './keys.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'hub-keys-'));

describe('loadKeyring', () => {
	it('uses HUB_SECRET_KEY when set', () => {
		const ring = loadKeyring({ HUB_SECRET_KEY: randomBytes(32).toString('base64') });
		expect(decryptSecret(ring, encryptSecret(ring, 'x'))).toBe('x');
	});

	it.each(['abc', randomBytes(16).toString('base64'), 'not base64 !!!'])(
		'rejects malformed key %j',
		(k) => {
			expect(() => loadKeyring({ HUB_SECRET_KEY: k })).toThrow(/32 bytes/);
		}
	);

	it('creates a 0600 key file on first run and reuses it', () => {
		const dir = tmp();
		const first = loadKeyring({ DATA_DIR: dir });
		const file = join(dir, 'secret.key');
		expect(statSync(file).mode & 0o777).toBe(0o600);
		const second = loadKeyring({ DATA_DIR: dir });
		expect(decryptSecret(second, encryptSecret(first, 'x'))).toBe('x');
	});

	it('rejects a corrupt key file without echoing its contents', () => {
		const dir = tmp();
		writeFileSync(join(dir, 'secret.key'), 'oops-secret-ish');
		try {
			loadKeyring({ DATA_DIR: dir });
			expect.unreachable();
		} catch (e) {
			expect((e as Error).message).not.toContain('oops-secret-ish');
			expect((e as Error).message).toMatch(/32 bytes/);
		}
		expect(readFileSync(join(dir, 'secret.key'), 'utf8')).toBe('oops-secret-ish');
	});
});
