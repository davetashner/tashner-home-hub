import { describe, expect, it } from 'vitest';
import { cleanText, nextPosition, sortItems, withDone } from './lists.js';

const item = (id: string, done: boolean, position: number) => ({ id, done, position });

describe('lists domain', () => {
	it('cleans text', () => {
		expect(cleanText('  two   eggs ', 20)).toBe('two eggs');
		expect(cleanText('   ', 20)).toBeNull();
		expect(cleanText(5, 20)).toBeNull();
		expect(cleanText('abcd', 3)).toBeNull();
	});
	it('puts unchecked first, then oldest first, without mutating', () => {
		const input = [item('a', true, 0), item('b', false, 2), item('c', false, 1)];
		expect(sortItems(input).map((i) => i.id)).toEqual(['c', 'b', 'a']);
		expect(input[0].id).toBe('a');
	});
	it('numbers new items after the last', () => {
		expect(nextPosition([])).toBe(0);
		expect(nextPosition([item('a', false, 4), item('b', false, 1)])).toBe(5);
	});
	it('checks one item off', () => {
		const out = withDone([item('a', false, 0), item('b', false, 1)], 'b', true);
		expect(out.map((i) => i.done)).toEqual([false, true]);
	});
});
