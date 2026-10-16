import { describe, expect, it } from 'vitest';
import { hashPin, validatePin, verifyPin } from './pin';

describe('validatePin', () => {
	it.each(['4817', '90213', '738204', '1357', '2468'])('accepts %s', (pin) => {
		expect(validatePin(pin)).toEqual({ ok: true });
	});
	it.each(['', '123', '1234567', 'abcd', '12 34', '12.4'])('rejects bad shape %j', (pin) => {
		expect(validatePin(pin)).toMatchObject({
			ok: false,
			message: expect.stringContaining('4 to 6')
		});
	});
	it('rejects non-strings', () => {
		expect(validatePin(1234)).toMatchObject({ ok: false });
	});
	it.each(['0000', '1111', '999999'])('rejects repeated digit %s', (pin) => {
		expect(validatePin(pin)).toMatchObject({
			ok: false,
			message: expect.stringContaining('repeating')
		});
	});
	it.each(['1234', '123456', '4321', '654321', '3456', '0123'])('rejects sequence %s', (pin) => {
		expect(validatePin(pin)).toMatchObject({
			ok: false,
			message: expect.stringContaining('counting')
		});
	});
});

describe('hashPin / verifyPin', () => {
	it('round-trips and uses a versioned encoding', () => {
		const h = hashPin('4817');
		expect(h).toMatch(/^scrypt\$v1\$16384\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
		expect(verifyPin('4817', h)).toBe(true);
		expect(verifyPin('4818', h)).toBe(false);
	});
	it('salts each hash', () => {
		expect(hashPin('4817')).not.toBe(hashPin('4817'));
	});
	it.each([
		null,
		undefined,
		'',
		'plain',
		'scrypt$v1$bad',
		'scrypt$v1$0$0$0$$',
		'scrypt$v1$1$1$1$AAAA$AAAA'
	])('never matches malformed hash %j', (enc) => {
		expect(verifyPin('4817', enc)).toBe(false);
	});
	it('rejects absurd cost parameters instead of throwing', () => {
		expect(verifyPin('4817', 'scrypt$v1$3$8$1$AAAA$AAAA')).toBe(false);
	});
	it('rejects a non-string pin', () => {
		expect(verifyPin(undefined as unknown as string, hashPin('4817'))).toBe(false);
	});
});
