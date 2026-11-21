import { describe, expect, it } from 'vitest';
import {
	bulbViews,
	cleanName,
	isColorId,
	isDimming,
	isIpv4,
	isSuccess,
	mergeFound,
	normMac,
	parseBulbs,
	parsePilot,
	setPilotMessage
} from './wiz.js';

const MAC = 'a0b1c2d3e4f5';
const pilot = (result: unknown) => JSON.stringify({ method: 'getPilot', env: 'pro', result });

describe('values', () => {
	it('checks MACs, IPs, brightness and names', () => {
		expect(['A0:B1:C2:D3:E4:F5', 'a0-b1-c2-d3-e4-f5', 'nope', 12].map(normMac)).toEqual([
			MAC,
			MAC,
			null,
			null
		]);
		expect(['192.0.2.10', '192.0.2.300', 'host.local', null].map(isIpv4)).toEqual([
			true,
			false,
			false,
			false
		]);
		expect([10, 100, 9, 101, 50.5, '50'].map(isDimming)).toEqual([
			true,
			true,
			false,
			false,
			false,
			false
		]);
		expect(['  Porch   lamp ', '   ', 'x'.repeat(41), 5].map(cleanName)).toEqual([
			'Porch lamp',
			null,
			null,
			null
		]);
	});
});

describe('parseBulbs', () => {
	it('keeps valid bulbs once each', () => {
		expect(
			parseBulbs([
				{ mac: 'A0:B1:C2:D3:E4:F5', ip: '192.0.2.10', name: 'Lamp' },
				{ mac: MAC, ip: '192.0.2.11', name: 'Again' },
				{ mac: 'bad', ip: '192.0.2.12', name: 'Bad' },
				{ mac: '001122334455', ip: 'x', name: 'Bad ip' },
				{ mac: '001122334455', ip: '192.0.2.13', name: '' },
				null,
				'str'
			])
		).toEqual([{ mac: MAC, ip: '192.0.2.10', name: 'Lamp' }]);
		expect(parseBulbs({})).toEqual([]);
	});
});

describe('replies', () => {
	it('reads a getPilot reply', () => {
		expect(parsePilot(pilot({ mac: MAC, state: true, dimming: 52, sceneId: 6 }))).toEqual({
			mac: MAC,
			on: true,
			dimming: 52,
			color: null
		});
	});

	it('names the offered colour a bulb is showing', () => {
		const color = (result: object) =>
			parsePilot(pilot({ mac: MAC, state: true, ...result }))?.color;
		expect(color({ temp: 2700, sceneId: 0 })).toBe('warm');
		expect(color({ r: 0, g: 0, b: 255 })).toBe('blue');
		expect(color({ r: 1, g: 2, b: 3 })).toBeNull();
		expect(color({ sceneId: 6 })).toBeNull();
	});

	it('defaults a missing brightness to full', () => {
		expect(parsePilot(pilot({ mac: MAC, state: false }))?.dimming).toBe(100);
	});

	it('ignores errors and garbage', () => {
		const junk = [pilot({ mac: MAC }), pilot({ state: true }), '{"error":{}}', 'null', '{bad'];
		expect(junk.map(parsePilot)).toEqual([null, null, null, null, null]);
	});

	it('spots a successful setPilot', () => {
		const replies = ['{"result":{"success":true}}', '{"result":{"success":false}}', 'oops'];
		expect(replies.map(isSuccess)).toEqual([true, false, false]);
	});
});

describe('setPilotMessage', () => {
	it('sends only what changed', () => {
		expect(JSON.parse(setPilotMessage({ on: false }))).toEqual({
			method: 'setPilot',
			params: { state: false }
		});
		expect(JSON.parse(setPilotMessage({ on: true, dimming: 40 })).params).toEqual({
			state: true,
			dimming: 40
		});
		expect(JSON.parse(setPilotMessage({ dimming: 70 })).params).toEqual({ dimming: 70 });
		expect(JSON.parse(setPilotMessage({ on: true, color: 'red' })).params).toEqual({
			state: true,
			r: 255,
			g: 0,
			b: 0
		});
		expect(JSON.parse(setPilotMessage({ color: 'cool' })).params).toEqual({ temp: 6500 });
		expect([isColorId('green'), isColorId('plaid')]).toEqual([true, false]);
	});
});

describe('mergeFound', () => {
	it('moves known bulbs and names new ones with the first free number', () => {
		const stored = [
			{ mac: '000000000001', ip: '192.0.2.1', name: 'Kitchen' },
			{ mac: '000000000002', ip: '192.0.2.2', name: 'Light 1' }
		];
		const merged = mergeFound(stored, [
			{ mac: '000000000001', ip: '192.0.2.9' },
			{ mac: '000000000003', ip: '192.0.2.3' },
			{ mac: '000000000004', ip: '192.0.2.4' }
		]);
		expect(merged).toEqual([
			{ mac: '000000000001', ip: '192.0.2.9', name: 'Kitchen' },
			{ mac: '000000000002', ip: '192.0.2.2', name: 'Light 1' },
			{ mac: '000000000003', ip: '192.0.2.3', name: 'Light 2' },
			{ mac: '000000000004', ip: '192.0.2.4', name: 'Light 3' }
		]);
		expect(stored[0].ip).toBe('192.0.2.1');
	});
});

describe('bulbViews', () => {
	it('joins live state and marks silent bulbs', () => {
		const bulbs = [
			{ mac: '000000000001', ip: '192.0.2.1', name: 'A' },
			{ mac: '000000000002', ip: '192.0.2.2', name: 'B' }
		];
		expect(
			bulbViews(bulbs, [{ mac: '000000000002', on: true, dimming: 30, color: 'blue' }])
		).toEqual([
			{ ...bulbs[0], reachable: false, on: false, dimming: 100, color: null },
			{ ...bulbs[1], reachable: true, on: true, dimming: 30, color: 'blue' }
		]);
	});
});
