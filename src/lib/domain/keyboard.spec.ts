import { describe, expect, it } from 'vitest';
import { initialKeyboard, press, type KeyPress } from './keyboard.js';

const run = (keys: KeyPress[], max = 20) =>
	keys.reduce((s, k) => press(s, k, max), initialKeyboard());
const ch = (char: string): KeyPress => ({ type: 'char', char });

describe('keyboard reducer', () => {
	it('capitalises the first letter only', () => {
		expect(run([ch('m'), ch('i'), ch('l'), ch('k')]).text).toBe('Milk');
	});
	it('types spaces, ignoring leading and doubled ones', () => {
		const s = run([{ type: 'space' }, ch('a'), { type: 'space' }, { type: 'space' }, ch('b')]);
		expect(s.text).toBe('A b');
	});
	it('backspace deletes and re-arms shift on an empty entry', () => {
		const s = run([ch('a'), ch('b'), { type: 'backspace' }]);
		expect(s.text).toBe('A');
		const empty = run([ch('a'), { type: 'backspace' }, { type: 'backspace' }]);
		expect(empty).toMatchObject({ text: '', shift: true });
	});
	it('shift toggles a capital', () => {
		expect(run([ch('a'), { type: 'shift' }, ch('b')]).text).toBe('AB');
	});
	it('enter submits trimmed text and resets', () => {
		const s = run([ch('a'), { type: 'space' }, { type: 'enter' }]);
		expect(s).toEqual({ text: '', shift: true, submitted: 'A' });
	});
	it('enter on empty text submits nothing', () => {
		expect(run([{ type: 'enter' }]).submitted).toBeNull();
	});
	it('stops at the length cap', () => {
		expect(run([ch('a'), ch('b'), ch('c')], 2).text).toBe('Ab');
		expect(run([ch('a'), ch('b'), { type: 'space' }], 2).text).toBe('Ab');
	});
	it('clear resets', () => {
		expect(run([ch('a'), { type: 'clear' }])).toEqual(initialKeyboard());
	});
	it('clears the submitted flag on the next press', () => {
		const s = press(run([ch('a'), { type: 'enter' }]), ch('b'), 20);
		expect(s.submitted).toBeNull();
	});
});
