import { describe, expect, it } from 'vitest';
import {
	classifyConnect,
	isPrivateIp,
	mergeSweep,
	parseDevices,
	parseNestStatus,
	parseSnapshot,
	summarize,
	type NetDevice,
	type Observation
} from './lan-monitor.js';

// Synthetic fixtures only: a made-up 10.20.30.x network.
const router = {
	system: { groupRole: 'root', modelId: 'MODEL-R', uptime: 3600.7, lan0Link: true },
	wan: { ethernetLink: true, online: true },
	software: { softwareVersion: '1.2.3' }
};
const point = {
	system: { groupRole: 'leaf', modelId: 'MODEL-P', uptime: 120, lan0Link: false },
	wan: { ethernetLink: false }
};

const devs: NetDevice[] = [
	{ id: 'router', name: 'Router', ip: '10.20.30.1', probe: { kind: 'nest' } },
	{ id: 'server', name: 'Server', ip: '10.20.30.4', probe: { kind: 'tcp', port: 22 } }
];

describe('isPrivateIp', () => {
	it('accepts the RFC 1918 ranges', () => {
		for (const ip of ['10.0.0.1', '172.16.0.1', '172.31.255.254', '192.168.1.20'])
			expect(isPrivateIp(ip)).toBe(true);
	});
	it('refuses public, malformed and edge addresses', () => {
		for (const ip of [
			'8.8.8.8',
			'172.15.0.1',
			'172.32.0.1',
			'192.169.0.1',
			'10.0.0',
			'256.1.1.1',
			'host.local',
			''
		])
			expect(isPrivateIp(ip)).toBe(false);
	});
});

describe('parseDevices', () => {
	it('keeps valid entries and trims names', () => {
		expect(
			parseDevices([{ id: 'a', name: '  Box ', ip: '10.0.0.2', probe: { kind: 'tcp', port: 80 } }])
		).toEqual([{ id: 'a', name: 'Box', ip: '10.0.0.2', probe: { kind: 'tcp', port: 80 } }]);
	});
	it('falls back to the id when the name is blank', () => {
		expect(
			parseDevices([{ id: 'a', name: ' ', ip: '10.0.0.2', probe: { kind: 'nest' } }])[0].name
		).toBe('a');
	});
	it('drops bad ids, public IPs, bad probes and duplicates', () => {
		const out = parseDevices([
			{ id: 'ok', ip: '10.0.0.2', probe: { kind: 'nest' } },
			{ id: 'ok', ip: '10.0.0.3', probe: { kind: 'nest' } },
			{ id: 'bad id!', ip: '10.0.0.4', probe: { kind: 'nest' } },
			{ id: 'pub', ip: '1.1.1.1', probe: { kind: 'nest' } },
			{ id: 'port', ip: '10.0.0.5', probe: { kind: 'tcp', port: 70000 } },
			{ id: 'kind', ip: '10.0.0.6', probe: { kind: 'icmp' } },
			{ id: 'noprobe', ip: '10.0.0.7' },
			'junk',
			null
		]);
		expect(out.map((d) => d.id)).toEqual(['ok']);
	});
	it('returns nothing for a non-array and caps the list', () => {
		expect(parseDevices({})).toEqual([]);
		const many = Array.from({ length: 80 }, (_, i) => ({
			id: `d${i}`,
			ip: '10.0.0.9',
			probe: { kind: 'nest' }
		}));
		expect(parseDevices(many)).toHaveLength(64);
	});
});

describe('parseNestStatus', () => {
	it('reads a router', () => {
		expect(parseNestStatus(router)).toEqual({
			model: 'MODEL-R',
			role: 'root',
			uptimeS: 3600,
			wanLink: true,
			lanLink: true,
			online: true,
			software: '1.2.3'
		});
	});
	it('reads a point, which has no internet flag', () => {
		expect(parseNestStatus(point)).toMatchObject({
			role: 'leaf',
			online: null,
			wanLink: false,
			lanLink: false,
			software: ''
		});
	});
	it('tolerates missing pieces', () => {
		expect(parseNestStatus({ system: { uptime: 5 } })).toEqual({
			model: 'unknown',
			role: 'unknown',
			uptimeS: 5,
			wanLink: false,
			lanLink: false,
			online: null,
			software: ''
		});
	});
	it('rejects anything that is not a status page', () => {
		for (const raw of [null, [], 'x', {}, { system: {} }, { system: { uptime: Infinity } }])
			expect(parseNestStatus(raw)).toBeNull();
	});
});

describe('classifyConnect', () => {
	it('treats a connection or a refusal as a live host', () => {
		expect(classifyConnect(null)).toBe('up');
		expect(classifyConnect('ECONNREFUSED')).toBe('up');
		expect(classifyConnect('ECONNRESET')).toBe('up');
	});
	it('treats silence and no route as down', () => {
		for (const c of ['ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'EHOSTDOWN'])
			expect(classifyConnect(c)).toBe('down');
	});
});

describe('mergeSweep', () => {
	const nest = parseNestStatus(router)!;
	const obs = (m: Record<string, Observation>) => new Map(Object.entries(m));

	it('starts each device from its first observation', () => {
		const s = mergeSweep(
			null,
			devs,
			obs({ router: { reach: 'up', ms: 3, nest }, server: { reach: 'down' } }),
			1000
		);
		expect(s.checkedAt).toBe(1000);
		expect(s.devices).toEqual([
			{ id: 'router', reach: 'up', since: 1000, lastSeen: 1000, ms: 3, nest, restartedAt: null },
			{
				id: 'server',
				reach: 'down',
				since: 1000,
				lastSeen: null,
				ms: null,
				nest: null,
				restartedAt: null
			}
		]);
	});

	it('keeps `since` while the state holds and moves it on a change', () => {
		const a = mergeSweep(
			null,
			devs,
			obs({ router: { reach: 'up', nest }, server: { reach: 'up', ms: 1 } }),
			1000
		);
		const b = mergeSweep(
			a,
			devs,
			obs({ router: { reach: 'up', nest }, server: { reach: 'up' } }),
			2000
		);
		expect(b.devices[1]).toMatchObject({ since: 1000, lastSeen: 2000, ms: null });
		const c = mergeSweep(
			b,
			devs,
			obs({ router: { reach: 'up', nest }, server: { reach: 'down' } }),
			3000
		);
		expect(c.devices[1]).toMatchObject({ reach: 'down', since: 3000, lastSeen: 2000 });
	});

	it('keeps the last Nest status while a unit is down', () => {
		const a = mergeSweep(null, devs, obs({ router: { reach: 'up', nest } }), 1000);
		const b = mergeSweep(a, devs, obs({ router: { reach: 'down' } }), 2000);
		expect(b.devices[0].nest).toEqual(nest);
	});

	it('flags a restart when uptime goes backwards', () => {
		const a = mergeSweep(null, devs, obs({ router: { reach: 'up', nest } }), 10_000_000);
		const b = mergeSweep(
			a,
			devs,
			obs({ router: { reach: 'up', nest: { ...nest, uptimeS: 60 } } }),
			10_060_000
		);
		expect(b.devices[0].restartedAt).toBe(10_000_000);
		const c = mergeSweep(
			b,
			devs,
			obs({ router: { reach: 'up', nest: { ...nest, uptimeS: 120 } } }),
			10_120_000
		);
		expect(c.devices[0].restartedAt).toBe(10_000_000);
	});

	it('carries unobserved devices forward, adds new ones as unknown, and drops removed ones', () => {
		const a = mergeSweep(
			null,
			devs,
			obs({ router: { reach: 'up', nest }, server: { reach: 'up' } }),
			1000
		);
		const b = mergeSweep(
			a,
			[devs[0], { id: 'new', name: 'New', ip: '10.20.30.9', probe: { kind: 'tcp', port: 80 } }],
			obs({}),
			2000
		);
		expect(b.devices.map((d) => [d.id, d.reach])).toEqual([
			['router', 'up'],
			['new', 'unknown']
		]);
		expect(b.devices[0]).toBe(a.devices[0]);
	});
});

describe('parseSnapshot and summarize', () => {
	it('round-trips a merged snapshot and drops malformed rows', () => {
		const s = mergeSweep(null, devs, new Map([['router', { reach: 'up' } as Observation]]), 5);
		const parsed = parseSnapshot({
			...JSON.parse(JSON.stringify(s)),
			devices: [...s.devices, { id: 1 }, 'x']
		});
		expect(parsed?.devices.map((d) => d.id)).toEqual(['router', 'server']);
		expect(summarize(parsed)).toEqual({ up: 1, down: 0, unknown: 1 });
	});
	it('rejects the wrong shape and summarizes nothing', () => {
		expect(parseSnapshot(null)).toBeNull();
		expect(parseSnapshot({ checkedAt: 'x', devices: [] })).toBeNull();
		expect(summarize(null)).toEqual({ up: 0, down: 0, unknown: 0 });
	});
});
