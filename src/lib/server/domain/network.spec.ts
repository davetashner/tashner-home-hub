import { describe, expect, it } from 'vitest';
import { isPrivateAddress, isRequestAllowed } from './network.js';

describe('isPrivateAddress', () => {
	it.each([
		'127.0.0.1',
		'127.8.9.10',
		'10.0.0.5',
		'172.16.0.1',
		'172.31.255.254',
		'192.168.1.20',
		'169.254.10.10',
		'::1',
		'0:0:0:0:0:0:0:1',
		'fc00::1',
		'fd12:3456:789a::1',
		'fe80::1',
		'febf::1',
		'fe80::1%en0',
		'[::1]',
		'::ffff:127.0.0.1',
		'::ffff:192.168.1.5',
		'::ffff:c0a8:0105',
		'::ffff:10.1.2.3'
	])('treats %s as private', (ip) => {
		expect(isPrivateAddress(ip)).toBe(true);
	});

	it.each([
		'8.8.8.8',
		'172.15.0.1',
		'172.32.0.1',
		'192.169.0.1',
		'169.253.0.1',
		'11.0.0.1',
		'2001:4860:4860::8888',
		'fec0::1',
		'::',
		'::2',
		'::ffff:8.8.8.8',
		'::ffff:0808:0808',
		'64:ff9b::7f00:1',
		'not-an-ip',
		'999.1.1.1',
		'',
		undefined,
		null
	])('treats %j as public/invalid', (ip) => {
		expect(isPrivateAddress(ip)).toBe(false);
	});
});

describe('isRequestAllowed', () => {
	it('allows private by default and blocks public', () => {
		expect(isRequestAllowed('127.0.0.1', { allowPublic: false })).toBe(true);
		expect(isRequestAllowed('8.8.8.8', { allowPublic: false })).toBe(false);
		expect(isRequestAllowed(undefined, { allowPublic: false })).toBe(false);
	});
	it('allows everything when public access is enabled', () => {
		expect(isRequestAllowed('8.8.8.8', { allowPublic: true })).toBe(true);
	});
});
