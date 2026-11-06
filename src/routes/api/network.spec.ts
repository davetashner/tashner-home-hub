import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'hub-network-api-'));

const route = await import('./network/+server.js');

const req = (method: string, body?: unknown) =>
	new Request('http://example.com/api/network', {
		method,
		body: body === undefined ? undefined : JSON.stringify(body)
	});
const call = async (h: unknown, ev: Record<string, unknown>, adult = true) =>
	(h as (e: unknown) => Promise<Response> | Response)({
		locals: { adult: adult ? { id: 'adult', name: 'Test Adult' } : null },
		...ev
	});

describe('network API', () => {
	it('needs an adult', async () => {
		await expect(call(route.GET, { request: req('GET') }, false)).rejects.toMatchObject({
			status: 401
		});
		await expect(
			call(route.PUT, { request: req('PUT', { devices: [] }) }, false)
		).rejects.toMatchObject({ status: 401 });
	});
	it('saves a device list, dropping invalid entries, and lists it', async () => {
		const res = await call(route.PUT, {
			request: req('PUT', {
				devices: [
					// 192.0.2.x is documentation space, not private: refused. 127.0.0.1 is not RFC 1918 either.
					{ id: 'loop', name: 'Loopback', ip: '127.0.0.1', probe: { kind: 'tcp', port: 9 } },
					{ id: 'lan', name: 'LAN box', ip: '10.255.255.1', probe: { kind: 'tcp', port: 9 } }
				]
			})
		});
		expect(await res.json()).toMatchObject({ dropped: 1, devices: [{ id: 'lan' }] });
		const view = await (await call(route.GET, { request: req('GET') })).json();
		expect(view.devices.map((d: { id: string }) => d.id)).toEqual(['lan']);
	});
	it('rejects a body without a device array', async () => {
		await expect(call(route.PUT, { request: req('PUT', { devices: 'x' }) })).rejects.toMatchObject({
			status: 400
		});
	});
});

const layoutRoute = await import('./network/layout/+server.js');

describe('network layout API', () => {
	it('needs an adult', async () => {
		await expect(
			call(layoutRoute.PUT, { request: req('PUT', { rooms: [] }) }, false)
		).rejects.toMatchObject({ status: 401 });
	});
	it('saves a plan and returns it with the network view', async () => {
		const plan = {
			rooms: [{ id: 'den', name: 'Den', x: 0, y: 0, w: 12, h: 10, floor: 1 }],
			devices: [{ id: 'lan', x: 4, y: 4, floor: 1 }]
		};
		const res = await call(layoutRoute.PUT, { request: req('PUT', plan) });
		expect(await res.json()).toEqual({ rooms: plan.rooms, placements: plan.devices });
		const view = await (await call(route.GET, { request: req('GET') })).json();
		expect(view.layout.rooms[0].name).toBe('Den');
	});
	it('refuses something that is not a plan', async () => {
		await expect(
			call(layoutRoute.PUT, { request: req('PUT', { rooms: 'x' }) })
		).rejects.toMatchObject({ status: 400 });
	});
});
