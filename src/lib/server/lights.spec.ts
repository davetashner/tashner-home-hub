import { describe, expect, it } from 'vitest';
import { createSocket } from 'node:dgram';
import type { AddressInfo } from 'node:net';
import { openDb } from './db/index.js';
import { saveDevices } from './lan-monitor.js';
import {
	changeLight,
	forgetLight,
	lightStates,
	readBulbs,
	renameLight,
	searchLights,
	searchTargets,
	udpExchange,
	type Exchange
} from './lights.js';

// Synthetic bulbs on 10.20.30.x.
const A = '000000000001';
const B = '000000000002';
const pilotFor = (mac: string, state = true, dimming = 50) =>
	JSON.stringify({ method: 'getPilot', result: { mac, state, dimming } });

/** A fake LAN: `bulbs` maps IP to MAC; each answers getPilot and setPilot. */
function lan(bulbs: Record<string, string>, opts: { setOk?: boolean } = {}) {
	const sent: { msg: unknown; targets: string[] }[] = [];
	const exchange: Exchange = async (msg, targets) => {
		sent.push({ msg: JSON.parse(msg), targets });
		const method = (JSON.parse(msg) as { method: string }).method;
		const hit = targets.includes('255.255.255.255') ? Object.keys(bulbs) : targets;
		return hit
			.filter((ip) => bulbs[ip])
			.map((ip) => ({
				ip,
				text:
					method === 'getPilot'
						? pilotFor(bulbs[ip])
						: JSON.stringify({ result: { success: opts.setOk ?? true } })
			}));
	};
	return { sent, exchange };
}

describe('search and state', () => {
	it('finds bulbs, names them, and keeps names when IPs move', async () => {
		const db = openDb(':memory:');
		const first = await searchLights(db, lan({ '10.20.30.5': A, '10.20.30.6': B }).exchange, [
			'255.255.255.255'
		]);
		expect(first.map((b) => [b.name, b.ip, b.reachable])).toEqual([
			['Light 1', '10.20.30.5', true],
			['Light 2', '10.20.30.6', true]
		]);
		renameLight(db, A, 'Lamp');
		const moved = await searchLights(db, lan({ '10.20.30.9': A }).exchange, ['255.255.255.255']);
		expect(moved.map((b) => [b.name, b.ip, b.reachable])).toEqual([
			['Lamp', '10.20.30.9', true],
			['Light 2', '10.20.30.6', false]
		]);
	});

	it('asks only the remembered IPs for state, once each', async () => {
		const db = openDb(':memory:');
		expect(await lightStates(db, lan({}).exchange)).toEqual([]);
		await searchLights(db, lan({ '10.20.30.5': A }).exchange, ['255.255.255.255']);
		const net = lan({ '10.20.30.5': A });
		const views = await lightStates(db, net.exchange);
		expect(views[0]).toMatchObject({ mac: A, on: true, dimming: 50, reachable: true });
		expect(net.sent[0].targets).toEqual(['10.20.30.5']);
	});

	it('ignores duplicate and junk replies', async () => {
		const db = openDb(':memory:');
		const exchange: Exchange = async () => [
			{ ip: '10.20.30.5', text: pilotFor(A) },
			{ ip: '10.20.30.5', text: pilotFor(A) },
			{ ip: '10.20.30.7', text: 'garbage' }
		];
		expect(await searchLights(db, exchange, [])).toHaveLength(1);
	});

	it('sweeps the /24 of a known device, or a private interface', () => {
		const db = openDb(':memory:');
		expect(searchTargets(db, {})).toEqual(['255.255.255.255']);
		const lo = { address: '127.0.0.1', family: 'IPv4', internal: true } as const;
		const eth = { address: '10.9.8.7', family: 'IPv4', internal: false } as const;
		const fromIface = searchTargets(db, { lo: [lo as never], eth0: [eth as never], x: undefined });
		expect(fromIface).toHaveLength(1 + 1 + 253);
		expect(fromIface[1]).toBe('10.9.8.7');
		saveDevices(db, [{ id: 'r', name: 'Router', ip: '10.20.30.1', probe: { kind: 'nest' } }]);
		expect(searchTargets(db, { eth0: [eth as never] })[1]).toBe('10.20.30.1');
	});
});

describe('changes', () => {
	it('switches a bulb and refuses unknown or silent ones', async () => {
		const db = openDb(':memory:');
		await searchLights(db, lan({ '10.20.30.5': A }).exchange, ['255.255.255.255']);
		const net = lan({ '10.20.30.5': A });
		await changeLight(db, A, { on: false, dimming: 20 }, net.exchange);
		expect(net.sent[0]).toEqual({
			msg: { method: 'setPilot', params: { state: false, dimming: 20 } },
			targets: ['10.20.30.5']
		});
		await expect(changeLight(db, B, { on: true }, net.exchange)).rejects.toMatchObject({
			code: 'not_found'
		});
		await expect(
			changeLight(db, A, { on: true }, lan({ '10.20.30.5': A }, { setOk: false }).exchange)
		).rejects.toMatchObject({ code: 'unreachable' });
	});

	it('refuses unknown bulbs and forgets known ones', async () => {
		const db = openDb(':memory:');
		await searchLights(db, lan({ '10.20.30.5': A }).exchange, ['255.255.255.255']);
		expect(() => renameLight(db, B, 'X')).toThrow('No light');
		expect(readBulbs(db)[0].name).toBe('Light 1');
		forgetLight(db, A);
		expect(readBulbs(db)).toEqual([]);
	});
});

describe('udpExchange', () => {
	it('sends to a real UDP listener and collects its reply', async () => {
		const bulb = createSocket('udp4');
		bulb.on('message', (msg, from) => bulb.send(`echo:${msg}`, from.port, from.address));
		await new Promise<void>((r) => bulb.bind(0, '127.0.0.1', r));
		const { port } = bulb.address() as AddressInfo;
		const replies = await udpExchange(port)('hi', ['127.0.0.1'], 300);
		bulb.close();
		expect(replies).toEqual([{ ip: '127.0.0.1', text: 'echo:hi' }]);
	});
});
