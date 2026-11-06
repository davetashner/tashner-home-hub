import { describe, expect, it } from 'vitest';
import { createServer } from 'node:net';
import { openDb } from './db/index.js';
import {
	getNetwork,
	probeDevice,
	readStatus,
	saveDevices,
	startLanMonitor,
	sweepNetwork,
	tcpConnect,
	type Connect,
	type Fetch
} from './lan-monitor.js';

// Synthetic network: 10.20.30.x.
const nestBody = {
	system: { groupRole: 'root', modelId: 'MODEL-R', uptime: 500, lan0Link: true },
	wan: { ethernetLink: true, online: true }
};
const okFetch: Fetch = async () => new Response(JSON.stringify(nestBody), { status: 200 });
const devices = [
	{ id: 'router', name: 'Router', ip: '10.20.30.1', probe: { kind: 'nest' } },
	{ id: 'server', name: 'Server', ip: '10.20.30.4', probe: { kind: 'tcp', port: 22 } },
	{ id: 'tv', name: 'TV', ip: '10.20.30.9', probe: { kind: 'tcp', port: 8060 } }
];

describe('probeDevice', () => {
	it('reads a Nest status page', async () => {
		const o = await probeDevice(
			{ id: 'r', name: 'R', ip: '10.20.30.1', probe: { kind: 'nest' } },
			okFetch,
			async () => null
		);
		expect(o.reach).toBe('up');
		expect(o.nest?.role).toBe('root');
	});
	it('counts any HTTP answer as up, and a fetch failure as down', async () => {
		const dev = { id: 'r', name: 'R', ip: '10.20.30.1', probe: { kind: 'nest' as const } };
		const o = await probeDevice(
			dev,
			async () => new Response('nope', { status: 404 }),
			async () => null
		);
		expect(o).toMatchObject({ reach: 'up' });
		expect(o.nest).toBeUndefined();
		expect(
			await probeDevice(
				dev,
				async () => {
					throw new Error('offline');
				},
				async () => null
			)
		).toEqual({ reach: 'down' });
	});
	it('maps TCP results', async () => {
		const dev = { id: 's', name: 'S', ip: '10.20.30.4', probe: { kind: 'tcp' as const, port: 22 } };
		expect((await probeDevice(dev, okFetch, async () => 'ECONNREFUSED')).reach).toBe('up');
		expect(await probeDevice(dev, okFetch, async () => 'EHOSTUNREACH')).toEqual({ reach: 'down' });
	});
});

describe('tcpConnect', () => {
	it('connects to a listening port and reports a refused one', async () => {
		const srv = createServer((s) => s.end());
		await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
		const port = (srv.address() as { port: number }).port;
		expect(await tcpConnect('127.0.0.1', port, 1000)).toBeNull();
		await new Promise<void>((r) => srv.close(() => r()));
		expect(await tcpConnect('127.0.0.1', port, 1000)).toBe('ECONNREFUSED');
	});
});

describe('sweepNetwork and getNetwork', () => {
	it('stores devices, sweeps them and joins the result', async () => {
		const db = openDb(':memory:');
		expect(getNetwork(db)).toEqual({ devices: [], checkedAt: null });
		expect(
			saveDevices(db, [...devices, { id: 'pub', ip: '8.8.8.8', probe: { kind: 'nest' } }])
		).toHaveLength(3);
		const connect: Connect = async (ip) => (ip.endsWith('.4') ? 'ECONNREFUSED' : 'ETIMEDOUT');
		const snap = await sweepNetwork(db, okFetch, connect, () => 1000);
		expect(snap.devices.map((d) => [d.id, d.reach])).toEqual([
			['router', 'up'],
			['server', 'up'],
			['tv', 'down']
		]);
		expect(readStatus(db)?.checkedAt).toBe(1000);
		const view = getNetwork(db);
		expect(view.checkedAt).toBe(1000);
		expect(view.devices[2]).toMatchObject({
			id: 'tv',
			name: 'TV',
			state: { reach: 'down', since: 1000 }
		});
		const later = await sweepNetwork(
			db,
			okFetch,
			async () => null,
			() => 2000
		);
		expect(later.devices[2]).toMatchObject({ reach: 'up', since: 2000 });
	});
	it('shows listed devices with no state before the first sweep', () => {
		const db = openDb(':memory:');
		saveDevices(db, devices);
		expect(getNetwork(db).devices.every((d) => d.state === null)).toBe(true);
	});
});

describe('startLanMonitor', () => {
	it('can be turned off and otherwise schedules a job', () => {
		expect(startLanMonitor({ HUB_LAN_MONITOR: 'off' })).toBeUndefined();
		const job = startLanMonitor({});
		expect(job).toBeDefined();
		job?.stop();
	});
});
