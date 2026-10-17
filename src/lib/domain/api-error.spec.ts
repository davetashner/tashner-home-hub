import { describe, expect, it } from 'vitest';
import { UNREACHABLE_MESSAGE, errorMessage, isUnreachableStatus, safeFetch } from './api-error.js';

describe('isUnreachableStatus', () => {
	it('flags proxy gateway statuses only', () => {
		for (const s of [502, 503, 504]) expect(isUnreachableStatus(s)).toBe(true);
		for (const s of [200, 400, 404, 500]) expect(isUnreachableStatus(s)).toBe(false);
	});
});

describe('safeFetch', () => {
	it('passes a response through', async () => {
		const res = await safeFetch('/x', undefined, async () => new Response('{}', { status: 200 }));
		expect(res.status).toBe(200);
	});
	it('turns a network error into an unreachable response', async () => {
		const res = await safeFetch('/x', undefined, async () => {
			throw new TypeError('Failed to fetch');
		});
		expect(await errorMessage(res)).toBe(UNREACHABLE_MESSAGE);
	});
});

describe('errorMessage', () => {
	it('says the hub is unreachable for a 502 with an empty body', async () => {
		expect(await errorMessage(new Response('', { status: 502 }))).toBe(UNREACHABLE_MESSAGE);
	});
	it('prefers the unreachable hint over a proxy HTML body on 504', async () => {
		expect(await errorMessage(new Response('<html>', { status: 504 }))).toBe(UNREACHABLE_MESSAGE);
	});
	it('keeps the server message for a 4xx', async () => {
		const res = new Response(JSON.stringify({ message: 'Name is required' }), { status: 400 });
		expect(await errorMessage(res)).toBe('Name is required');
	});
	it('falls back when the body has no usable message', async () => {
		expect(await errorMessage(new Response('', { status: 500 }))).toBe('Something went wrong.');
		expect(await errorMessage(new Response('{"message":""}', { status: 400 }))).toBe(
			'Something went wrong.'
		);
	});
});
