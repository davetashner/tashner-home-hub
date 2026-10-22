import { describe, expect, it } from 'vitest';
import { parseLevel } from './level.js';
import { TEST_TOWER } from './fixtures.js';

const json = () => JSON.parse(JSON.stringify(TEST_TOWER)) as Record<string, unknown>;
const error = (v: unknown) => {
	const r = parseLevel(v);
	return r.ok ? null : r.error;
};

describe('parseLevel', () => {
	it('accepts a good level and fills in a missing angle', () => {
		const v = json();
		delete (v.blocks as Record<string, unknown>[])[0]!.angle;
		v.blocks = [
			...(v.blocks as unknown[]),
			{ material: 'rock', shape: 'ball', x: 25, y: 1, r: 0.6 }
		];
		const r = parseLevel(v);
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.level.blocks[0]).toMatchObject({ shape: 'box', angle: 0 });
		expect(r.level.blocks[3]).toEqual({ material: 'rock', shape: 'ball', x: 25, y: 1, r: 0.6 });
		expect(r.level.gremlins).toEqual(TEST_TOWER.gremlins);
	});

	it('rejects bad level fields', () => {
		expect(error(null)).toMatch(/not an object/);
		expect(error([])).toMatch(/not an object/);
		expect(error({ ...json(), id: 'Bad Id' })).toMatch(/id/);
		expect(error({ ...json(), name: '  ' })).toMatch(/name/);
		expect(error({ ...json(), width: 5 })).toMatch(/width/);
		expect(error({ ...json(), height: 99 })).toMatch(/height/);
		expect(error({ ...json(), junkbots: 0 })).toMatch(/junkbots/);
		expect(error({ ...json(), junkbots: 1.5 })).toMatch(/junkbots/);
		expect(error({ ...json(), blocks: 'x' })).toMatch(/blocks/);
		expect(error({ ...json(), gremlins: [] })).toMatch(/gremlins/);
		expect(error({ ...json(), anchor: { x: 'a', y: 1 } })).toMatch(/anchor needs/);
		expect(error({ ...json(), anchor: { x: 40, y: 1 } })).toMatch(/anchor is outside/);
	});

	it('rejects bad blocks and gremlins', () => {
		const withBlock = (b: unknown) => error({ ...json(), blocks: [b] });
		const box = { material: 'scrap', shape: 'box', x: 5, y: 1, w: 1, h: 1 };
		expect(withBlock(7)).toMatch(/block 0 is not/);
		expect(withBlock({ ...box, material: 'cheese' })).toMatch(/material/);
		expect(withBlock({ ...box, material: 'toString' })).toMatch(/material/);
		expect(withBlock({ ...box, shape: 'star' })).toMatch(/shape/);
		expect(withBlock({ ...box, w: 0 })).toMatch(/size/);
		expect(withBlock({ ...box, h: 11 })).toMatch(/size/);
		expect(withBlock({ ...box, angle: 'up' })).toMatch(/angle/);
		expect(withBlock({ ...box, shape: 'ball', r: Number.NaN })).toMatch(/radius/);
		expect(withBlock({ ...box, y: -1 })).toMatch(/outside/);
		expect(error({ ...json(), gremlins: [{ x: 1, y: 1, r: 0 }] })).toMatch(
			/gremlin 0 has a bad radius/
		);
		expect(error({ ...json(), gremlins: [{ x: 1, y: 1 }] })).toMatch(/radius/);
	});

	it('lets unexpected errors through', () => {
		const v = json();
		Object.defineProperty(v, 'anchor', {
			get() {
				throw new RangeError('boom');
			}
		});
		expect(() => parseLevel(v)).toThrow(RangeError);
	});
});
