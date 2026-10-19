import { randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb, type Db } from '../db/index.js';
import { createKeyring } from '../domain/secrets.js';
import { MOTION_POLL_MS } from '../domain/motion-wake.js';
import * as ha from './index.js';
import { startMotionWake } from './motion.js';

const keyring = createKeyring('k1', { k1: randomBytes(32) });
let db: Db;
beforeEach(() => {
	db = openDb(':memory:');
	ha.saveConnection({ baseUrl: 'http://homeassistant.local:8123', token: 'tok' }, { db, keyring });
});

describe('saveMotionSensor', () => {
	it('saves, clears, rejects non binary sensors, and survives re-saving the connection', () => {
		expect(ha.readConfig({ db }).motionSensor).toBeNull();
		ha.saveMotionSensor('binary_sensor.hall', { db });
		ha.saveConnection({ baseUrl: 'http://10.0.0.5:8123', token: '' }, { db, keyring });
		expect(ha.readMotionSensor({ db })).toBe('binary_sensor.hall');
		expect(() => ha.saveMotionSensor('light.x', { db })).toThrow(ha.HaError);
		ha.saveMotionSensor(null, { db });
		expect(ha.readConfig({ db }).motionSensor).toBeNull();
	});
	it('needs a connection first, and disconnecting forgets the pick', () => {
		ha.saveMotionSensor('binary_sensor.hall', { db });
		ha.disconnect({ db });
		expect(ha.readMotionSensor({ db })).toBeNull();
		expect(() => ha.saveMotionSensor('binary_sensor.hall', { db })).toThrow(ha.HaError);
	});
});

describe('listMotionSensors and readEntityState', () => {
	it('lists binary sensors and reads one state', async () => {
		const fetch = vi.fn(async (url: string | URL | Request) =>
			String(url).endsWith('/api/states')
				? new Response(
						JSON.stringify([
							{
								entity_id: 'binary_sensor.hall',
								state: 'off',
								attributes: { device_class: 'motion' }
							}
						])
					)
				: new Response(JSON.stringify({ state: 'on' }))
		) as unknown as typeof globalThis.fetch;
		expect((await ha.listMotionSensors({ db, keyring, fetch })).map((e) => e.entityId)).toEqual([
			'binary_sensor.hall'
		]);
		expect(await ha.readEntityState('binary_sensor.hall', { db, keyring, fetch })).toBe('on');
	});
});

describe('startMotionWake', () => {
	function harness(answers: (string | Error)[]) {
		const wake = vi.fn();
		const delays: number[] = [];
		let i = 0;
		const fetch = vi.fn(async () => {
			const a = answers[Math.min(i++, answers.length - 1)]!;
			if (a instanceof Error) throw a;
			return new Response(JSON.stringify({ state: a }));
		}) as unknown as typeof globalThis.fetch;
		const job = startMotionWake({
			db,
			keyring,
			fetch,
			wake,
			setTimer: (_fn, ms) => {
				delays.push(ms);
				return { stop: () => undefined };
			}
		});
		return { job, wake, delays, fetch };
	}

	it('does nothing and does not call HA while None is picked', async () => {
		const h = harness(['on']);
		await h.job.tick();
		expect(h.fetch).not.toHaveBeenCalled();
		expect(h.wake).not.toHaveBeenCalled();
		expect(h.delays.every((d) => d === MOTION_POLL_MS)).toBe(true);
	});
	it('ignores a sensor that is already on, then wakes on off -> on, once', async () => {
		ha.saveMotionSensor('binary_sensor.hall', { db });
		const h = harness(['on', 'off', 'on', 'on']);
		for (let n = 0; n < 4; n++) await h.job.tick();
		expect(h.wake).toHaveBeenCalledTimes(1);
	});
	it('treats re-picking the same sensor as a fresh start', async () => {
		ha.saveMotionSensor('binary_sensor.hall', { db });
		const h = harness(['off', 'on']);
		await h.job.tick();
		await new Promise((r) => setTimeout(r, 2));
		ha.saveMotionSensor('binary_sensor.hall', { db });
		await h.job.tick();
		expect(h.wake).not.toHaveBeenCalled();
	});
	it('backs off while HA is unreachable and recovers', async () => {
		ha.saveMotionSensor('binary_sensor.hall', { db });
		const h = harness([new Error('down'), new Error('down'), 'off']);
		for (let n = 0; n < 3; n++) await h.job.tick();
		expect(h.delays[2]).toBeGreaterThan(h.delays[1]!);
		expect(h.delays.at(-1)).toBe(MOTION_POLL_MS);
		expect(h.wake).not.toHaveBeenCalled();
	});
	it('survives a failing wake, and stop cancels the next poll', async () => {
		ha.saveMotionSensor('binary_sensor.hall', { db });
		const stop = vi.fn();
		const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const answers = ['off', 'on'];
		let i = 0;
		const job = startMotionWake({
			db,
			keyring,
			fetch: (async () =>
				new Response(JSON.stringify({ state: answers[i++] }))) as unknown as typeof fetch,
			wake: () => {
				throw new Error('db');
			},
			setTimer: () => ({ stop })
		});
		await job.tick();
		await job.tick();
		expect(err).toHaveBeenCalled();
		job.stop();
		expect(stop).toHaveBeenCalled();
		err.mockRestore();
	});
});
