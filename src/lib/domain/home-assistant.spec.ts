import { describe, expect, it } from 'vitest';
import {
	buildTiles,
	domainOf,
	fallbackName,
	flipTile,
	isEntityId,
	MAX_TILES,
	moveItem,
	normalizeBaseUrl,
	normalizeSelection,
	parseEntities,
	serviceFor
} from './home-assistant.js';

const states = [
	{ entity_id: 'light.kitchen', state: 'on', attributes: { friendly_name: 'Kitchen light' } },
	{ entity_id: 'switch.fan', state: 'off', attributes: {} },
	{
		entity_id: 'scene.movie_night',
		state: 'scening',
		attributes: { friendly_name: 'Movie night' }
	},
	{ entity_id: 'light.attic', state: 'unavailable', attributes: { friendly_name: 'Attic light' } },
	{ entity_id: 'sensor.temp', state: '20', attributes: {} },
	{ entity_id: 'light.bad id', state: 'on' },
	null,
	{ entity_id: 'light.odd', state: 5, attributes: null }
];

describe('ids', () => {
	it('classifies domains and ids', () => {
		expect(domainOf('light.x')).toBe('light');
		expect(domainOf('sensor.x')).toBeNull();
		expect(domainOf('nodot')).toBeNull();
		expect(isEntityId('scene.a_b')).toBe(true);
		expect(isEntityId('lock.door')).toBe(false);
		expect(isEntityId(4)).toBe(false);
		expect(fallbackName('switch.back_porch_fan')).toBe('Back porch fan');
		expect(fallbackName('switch.')).toBe('switch.');
	});
});

describe('normalizeBaseUrl', () => {
	it('accepts LAN hosts and cleans them', () => {
		expect(normalizeBaseUrl('http://homeassistant.local:8123/')).toBe(
			'http://homeassistant.local:8123'
		);
		expect(normalizeBaseUrl('192.168.1.5:8123')).toBe('http://192.168.1.5:8123');
		expect(normalizeBaseUrl('https://ha.example.com/prefix/api/')).toBe(
			'https://ha.example.com/prefix'
		);
	});
	it('rejects the rest', () => {
		for (const bad of [
			'',
			'  ',
			'ftp://x',
			'http://u:p@h',
			'http://h/?a=1',
			'http://h/#x',
			5,
			null
		])
			expect(normalizeBaseUrl(bad)).toBeNull();
		expect(normalizeBaseUrl('http://')).toBeNull();
	});
});

describe('normalizeSelection', () => {
	it('keeps valid unique picks in order and trims names', () => {
		expect(
			normalizeSelection([
				{ entityId: 'light.a', name: '  Lamp  ' },
				{ entityId: 'light.a', name: 'dup' },
				{ entityId: 'sensor.x' },
				{ entityId: 'scene.b', name: 7 },
				'junk',
				null
			])
		).toEqual([
			{ entityId: 'light.a', name: 'Lamp' },
			{ entityId: 'scene.b', name: '' }
		]);
		expect(normalizeSelection('x')).toEqual([]);
	});
	it('caps the count', () => {
		const many = Array.from({ length: 40 }, (_, i) => ({ entityId: `light.l${i}` }));
		expect(normalizeSelection(many)).toHaveLength(MAX_TILES);
	});
});

describe('parseEntities', () => {
	it('lists only light, switch and scene, by domain then name', () => {
		expect(parseEntities(states).map((e) => e.entityId)).toEqual([
			'light.attic',
			'light.kitchen',
			'light.odd',
			'switch.fan',
			'scene.movie_night'
		]);
		expect(parseEntities(states).find((e) => e.entityId === 'switch.fan')?.name).toBe('Fan');
		expect(parseEntities('nope')).toEqual([]);
	});
});

describe('buildTiles', () => {
	const sel = [
		{ entityId: 'scene.movie_night', name: '' },
		{ entityId: 'light.kitchen', name: 'Counter' },
		{ entityId: 'switch.fan', name: '' },
		{ entityId: 'light.attic', name: '' },
		{ entityId: 'light.gone', name: '' }
	];
	it('maps state, names and order', () => {
		const t = buildTiles(sel, states);
		expect(t.map((x) => [x.entityId, x.name, x.kind, x.on, x.unavailable])).toEqual([
			['scene.movie_night', 'Movie night', 'scene', null, false],
			['light.kitchen', 'Counter', 'toggle', true, false],
			['switch.fan', 'Fan', 'toggle', false, false],
			['light.attic', 'Attic light', 'toggle', null, true],
			['light.gone', 'Gone', 'toggle', null, true]
		]);
	});
	it('shows unknown (not unavailable) when HA was not reached', () => {
		const t = buildTiles(sel, null);
		expect(t.every((x) => x.on === null && !x.unavailable)).toBe(true);
		expect(t[1]!.name).toBe('Counter');
	});
});

describe('serviceFor / flipTile / moveItem', () => {
	it('picks the service', () => {
		expect(serviceFor('light.a')).toEqual({ domain: 'light', service: 'toggle' });
		expect(serviceFor('switch.a')).toEqual({ domain: 'switch', service: 'toggle' });
		expect(serviceFor('scene.a')).toEqual({ domain: 'scene', service: 'turn_on' });
		expect(serviceFor('lock.a')).toBeNull();
	});
	it('flips only known toggle tiles', () => {
		const tiles = buildTiles(
			[
				{ entityId: 'light.kitchen', name: '' },
				{ entityId: 'scene.movie_night', name: '' },
				{ entityId: 'light.attic', name: '' }
			],
			states
		);
		expect(flipTile(tiles, 'light.kitchen')[0]!.on).toBe(false);
		expect(flipTile(tiles, 'scene.movie_night')[1]!.on).toBeNull();
		expect(flipTile(tiles, 'light.attic')[2]!.on).toBeNull();
		expect(tiles[0]!.on).toBe(true);
	});
	it('moves and clamps', () => {
		expect(moveItem([1, 2, 3], 0, 1)).toEqual([2, 1, 3]);
		expect(moveItem([1, 2, 3], 2, -2)).toEqual([3, 1, 2]);
		expect(moveItem([1, 2, 3], 0, -1)).toEqual([1, 2, 3]);
		expect(moveItem([1, 2, 3], 5, 1)).toEqual([1, 2, 3]);
	});
});
