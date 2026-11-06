import { describe, expect, it } from 'vitest';
import {
	deviceId,
	parseLayout,
	planBounds,
	roomAt,
	shortSpan,
	statusLine,
	toneOf,
	withPlacement,
	type NetLayout
} from './net-layout.js';
import type { DeviceState } from './lan-monitor.js';

// A made-up two-room cabin.
const raw = {
	rooms: [
		{ id: 'main', name: ' Main room ', x: 0, y: 0, w: 20, h: 15, floor: 1 },
		{ id: 'nook', name: 'Nook', x: 2, y: 2, w: 4.2, h: 4, floor: 1 },
		{ id: 'loft', name: '', x: 0, y: 0, w: 10, h: 10, floor: 2 }
	],
	devices: [
		{ id: 'router', x: 3, y: 3, floor: 1 },
		{ id: 'unplaced', x: null, y: null, floor: 1 }
	]
};

const up: DeviceState = {
	id: 'r',
	reach: 'up',
	since: 0,
	lastSeen: 0,
	ms: 2,
	nest: null,
	restartedAt: null
};

describe('parseLayout', () => {
	it('reads the plan builder export, trimming names and rounding to half feet', () => {
		const l = parseLayout(raw)!;
		expect(l.rooms.map((r) => [r.id, r.name, r.w])).toEqual([
			['main', 'Main room', 20],
			['nook', 'Nook', 4],
			['loft', 'loft', 10]
		]);
		expect(l.placements).toEqual([{ id: 'router', x: 3, y: 3, floor: 1 }]);
	});
	it('prefers `placements` and drops bad rows', () => {
		const l = parseLayout({
			rooms: [
				{ id: 'a', x: 0, y: 0, w: 5, h: 5, floor: 1 },
				{ id: 'a', x: 0, y: 0, w: 5, h: 5, floor: 1 },
				{ id: 'b', x: 0, y: 0, w: 0, h: 5, floor: 1 },
				{ id: 'c', x: 0, y: 0, w: 5, h: 5, floor: 3 },
				{ id: 'd', x: 9999, y: 0, w: 5, h: 5, floor: 1 },
				{ id: 'bad id', x: 0, y: 0, w: 5, h: 5, floor: 1 },
				'x'
			],
			placements: [
				{ id: 'p', x: 1, y: 1, floor: 2 },
				{ id: 'p', x: 1, y: 1, floor: 2 },
				{ id: 'q', x: 1, y: 1 },
				null
			],
			devices: [{ id: 'ignored', x: 1, y: 1, floor: 1 }]
		})!;
		expect(l.rooms.map((r) => r.id)).toEqual(['a']);
		expect(l.placements.map((p) => p.id)).toEqual(['p']);
	});
	it('rejects non-layouts and tolerates a missing placement list', () => {
		expect(parseLayout(null)).toBeNull();
		expect(parseLayout({ rooms: 'x' })).toBeNull();
		expect(parseLayout({ rooms: [] })).toEqual({ rooms: [], placements: [] });
	});
	it('caps the number of rooms', () => {
		const rooms = Array.from({ length: 130 }, (_, i) => ({
			id: `r${i}`,
			x: 0,
			y: 0,
			w: 1,
			h: 1,
			floor: 1
		}));
		expect(parseLayout({ rooms })!.rooms).toHaveLength(120);
	});
});

describe('roomAt and planBounds', () => {
	const l = parseLayout(raw) as NetLayout;
	it('picks the smallest room holding the point, on that floor', () => {
		expect(roomAt(l, 3, 3, 1)?.id).toBe('nook');
		expect(roomAt(l, 15, 10, 1)?.id).toBe('main');
		expect(roomAt(l, 3, 3, 2)?.id).toBe('loft');
		expect(roomAt(l, 50, 50, 1)).toBeNull();
	});
	it('fits everything with padding', () => {
		expect(planBounds(l)).toEqual({ x: -3, y: -3, w: 26, h: 21 });
		expect(planBounds({ rooms: [], placements: [] })).toEqual({ x: 0, y: 0, w: 10, h: 10 });
		expect(planBounds({ rooms: [], placements: [{ id: 'p', x: 5, y: 5, floor: 1 }] }, 1)).toEqual({
			x: 4,
			y: 4,
			w: 2,
			h: 2
		});
	});
});

describe('toneOf and statusLine', () => {
	const now = 10 * 3600_000;
	it('reports unknown before any sweep', () => {
		expect(toneOf(null, null, now)).toBe('unknown');
		expect(toneOf({ ...up, reach: 'unknown' }, now, now)).toBe('unknown');
		expect(statusLine(null, now, now)).toBe('Not checked yet');
	});
	it('marks an old sweep as stale', () => {
		expect(toneOf(up, now - 6 * 60_000, now)).toBe('stale');
		expect(statusLine(up, now - 6 * 60_000, now)).toBe('Last checked 6 min ago');
	});
	it('describes down and up spells', () => {
		expect(statusLine({ ...up, reach: 'down', since: now - 3 * 60_000 }, now, now)).toBe(
			'Not answering for 3 min'
		);
		expect(statusLine({ ...up, since: now - 2 * 3600_000 }, now, now)).toBe('Answering for 2 h');
	});
	it('uses Nest uptime and flags a recent restart', () => {
		const nest = {
			model: 'M',
			role: 'leaf' as const,
			uptimeS: 3 * 86400,
			wanLink: false,
			lanLink: false,
			online: null,
			software: ''
		};
		expect(statusLine({ ...up, nest }, now, now)).toBe('Up 3 days');
		expect(
			statusLine({ ...up, nest: { ...nest, uptimeS: 600 }, restartedAt: now - 600_000 }, now, now)
		).toBe('Up 10 min · restarted today');
		expect(statusLine({ ...up, nest, restartedAt: now - 30 * 3600_000 }, now, now)).toBe(
			'Up 3 days'
		);
	});
});

describe('shortSpan', () => {
	it('scales from seconds to days', () => {
		expect(shortSpan(-5)).toBe('under a minute');
		expect(shortSpan(30_000)).toBe('under a minute');
		expect(shortSpan(59 * 60_000)).toBe('59 min');
		expect(shortSpan(47 * 3600_000)).toBe('47 h');
		expect(shortSpan(72 * 3600_000)).toBe('3 days');
	});
});

describe('withPlacement and deviceId', () => {
	const l = parseLayout(raw) as NetLayout;
	it('moves a placed device and adds an unplaced one, without touching the original', () => {
		const moved = withPlacement(l, 'router', 7.3, 8.8, 2);
		expect(moved.placements).toEqual([{ id: 'router', x: 7.5, y: 9, floor: 2 }]);
		expect(withPlacement(moved, 'new', 1, 1, 1).placements.map((p) => p.id)).toEqual([
			'router',
			'new'
		]);
		expect(l.placements[0]).toEqual({ id: 'router', x: 3, y: 3, floor: 1 });
		expect(moved.rooms).toBe(l.rooms);
	});
	it('slugs names and avoids collisions', () => {
		expect(deviceId('Garage TV Pi', [])).toBe('garage-tv-pi');
		expect(deviceId('  Router!! ', ['router', 'router-2'])).toBe('router-3');
		expect(deviceId('***', [])).toBe('device');
		expect(deviceId('x'.repeat(50), []).length).toBe(32);
	});
});
