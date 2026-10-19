import { describe, expect, it } from 'vitest';
import {
	isMotionSensorId,
	parseMotionSensors,
	buildTiles,
	domainOf,
	formatReading,
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
	{
		entity_id: 'sensor.hall_temp',
		state: '21.54',
		last_updated: '2026-10-18T10:00:00Z',
		attributes: {
			friendly_name: 'Hall temp',
			device_class: 'temperature',
			unit_of_measurement: '°C'
		}
	},
	{
		entity_id: 'sensor.cellar_humidity',
		state: '48',
		last_updated: '2026-10-17T10:00:00Z',
		attributes: { device_class: 'humidity', unit_of_measurement: '%' }
	},
	{
		entity_id: 'sensor.dead',
		state: 'unknown',
		attributes: { device_class: 'temperature', unit_of_measurement: '°C' }
	},
	{ entity_id: 'sensor.power', state: '5', attributes: { device_class: 'power' } },
	{
		entity_id: 'binary_sensor.front_door',
		state: 'on',
		attributes: { friendly_name: 'Front door', device_class: 'door' }
	},
	{
		entity_id: 'binary_sensor.window',
		state: 'off',
		attributes: { device_class: 'window' }
	},
	{ entity_id: 'binary_sensor.motion', state: 'on', attributes: { device_class: 'motion' } },
	{ entity_id: 'binary_sensor.gone', state: 'unavailable', attributes: { device_class: 'door' } },
	{ entity_id: 'light.bad id', state: 'on' },
	null,
	{ entity_id: 'light.odd', state: 5, attributes: null }
];

describe('ids', () => {
	it('classifies domains and ids', () => {
		expect(domainOf('light.x')).toBe('light');
		expect(domainOf('sensor.x')).toBe('sensor');
		expect(domainOf('lock.x')).toBeNull();
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
				{ entityId: 'lock.x' },
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
	it('lists controls plus temperature, humidity and contact sensors, by domain then name', () => {
		expect(parseEntities(states).map((e) => e.entityId)).toEqual([
			'light.attic',
			'light.kitchen',
			'light.odd',
			'switch.fan',
			'scene.movie_night',
			'sensor.cellar_humidity',
			'sensor.dead',
			'sensor.hall_temp',
			'binary_sensor.front_door',
			'binary_sensor.gone',
			'binary_sensor.window'
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

describe('buildTiles: sensors', () => {
	const now = Date.parse('2026-10-18T11:00:00Z');
	const sel = [
		'sensor.hall_temp',
		'sensor.cellar_humidity',
		'sensor.dead',
		'binary_sensor.front_door',
		'binary_sensor.window',
		'binary_sensor.gone',
		'sensor.missing'
	].map((entityId) => ({ entityId, name: '' }));
	it('reads values, units, contacts, stale and unavailable', () => {
		const t = buildTiles(sel, states, now);
		expect(t.map((x) => [x.kind, x.reading, x.open, x.stale, x.unavailable, x.on])).toEqual([
			['sensor', '21.5 °C', null, false, false, null],
			['sensor', '48 %', null, true, false, null],
			['sensor', null, null, false, true, null],
			['contact', 'Open', true, false, false, null],
			['contact', 'Closed', false, false, false, null],
			['contact', null, null, false, true, null],
			['sensor', null, null, false, true, null]
		]);
		expect(t[3]!.name).toBe('Front door');
	});
	it('has no reading when HA was not reached', () => {
		const t = buildTiles(sel, null, now);
		expect(t.every((x) => x.reading === null && !x.stale && !x.unavailable)).toBe(true);
	});
	it('formats readings', () => {
		expect(formatReading('3', '')).toBe('3');
		expect(formatReading('abc', '%')).toBe('abc %');
		expect(formatReading('', '')).toBe('');
	});
	it('never has a service', () => {
		expect(serviceFor('sensor.hall_temp')).toBeNull();
		expect(serviceFor('binary_sensor.front_door')).toBeNull();
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

describe('parseMotionSensors', () => {
	it('lists binary sensors, motion-like classes first, others after, by name', () => {
		const body = [
			{
				entity_id: 'binary_sensor.door',
				state: 'off',
				attributes: { device_class: 'door', friendly_name: 'Door' }
			},
			{
				entity_id: 'binary_sensor.hall',
				state: 'off',
				attributes: { device_class: 'motion', friendly_name: 'Hall motion' }
			},
			{ entity_id: 'binary_sensor.desk', state: 'on', attributes: { device_class: 'occupancy' } },
			{ entity_id: 'light.kitchen', state: 'on', attributes: {} }
		];
		expect(parseMotionSensors(body).map((e) => e.entityId)).toEqual([
			'binary_sensor.desk',
			'binary_sensor.hall',
			'binary_sensor.door'
		]);
	});
	it('validates sensor ids', () => {
		expect(isMotionSensorId('binary_sensor.hall')).toBe(true);
		expect(isMotionSensorId('light.hall')).toBe(false);
		expect(isMotionSensorId(null)).toBe(false);
	});
});
