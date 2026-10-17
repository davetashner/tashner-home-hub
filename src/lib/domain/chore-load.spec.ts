import { describe, expect, it } from 'vitest';
import { childrenOf, planLoad } from './chore-load';

const kid = (id: string) => ({ id, role: 'child' });
const adult = { id: 'a', role: 'adult' };

describe('childrenOf', () => {
	it('drops grown-ups', () => {
		expect(childrenOf([adult, kid('k1')])).toEqual([kid('k1')]);
	});
	it('keeps members without a role', () => {
		expect(childrenOf([{ id: 'x' }])).toEqual([{ id: 'x' }]);
	});
});

describe('planLoad', () => {
	it('keeps the kids that loaded when one fails', () => {
		const plan = planLoad(
			[adult, kid('k1'), kid('k2')],
			[
				{ id: 'k1', groups: ['g'] },
				{ id: 'k2', failed: true }
			],
			{}
		);
		expect(plan.members).toEqual([kid('k1')]);
		expect(plan.boards).toEqual({ k1: ['g'] });
		expect(plan.failed).toEqual(['k2']);
		expect(plan.unreachable).toBe(false);
	});
	it('keeps the last copy of a kid whose request fails', () => {
		const plan = planLoad([kid('k1')], [{ id: 'k1', failed: true }], { k1: ['old'] });
		expect(plan.members).toEqual([kid('k1')]);
		expect(plan.boards.k1).toEqual(['old']);
		expect(plan.failed).toEqual(['k1']);
		expect(plan.unreachable).toBe(false);
	});
	it('treats a missing result as a failure', () => {
		const plan = planLoad([kid('k1')], [], {});
		expect(plan.failed).toEqual(['k1']);
		expect(plan.unreachable).toBe(true);
	});
	it('is unreachable when every child failed with nothing saved', () => {
		const plan = planLoad([kid('k1'), kid('k2')], [{ id: 'k1', failed: true }], {});
		expect(plan.unreachable).toBe(true);
	});
	it('is not unreachable when there are no children at all', () => {
		const plan = planLoad([adult], [], {});
		expect(plan).toEqual({ members: [], boards: {}, failed: [], unreachable: false });
	});
});
