import { describe, expect, it } from 'vitest';
import { createPendingActions, isTempId } from './lists-pending.js';

describe('pending list actions', () => {
	it('recognises temp ids', () => {
		expect(isTempId('temp-abc')).toBe(true);
		expect(isTempId('0b1c')).toBe(false);
	});

	it('keeps only the last check state', () => {
		const p = createPendingActions();
		p.hold('temp-1', { kind: 'done', done: true });
		p.hold('temp-1', { kind: 'done', done: false });
		p.hold('temp-1', { kind: 'done', done: true });
		expect(p.has('temp-1')).toBe(true);
		expect(p.take('temp-1')).toEqual([{ kind: 'done', done: true }]);
		expect(p.has('temp-1')).toBe(false);
	});

	it('a delete replaces earlier taps and ignores later ones', () => {
		const p = createPendingActions();
		p.hold('temp-1', { kind: 'done', done: true });
		p.hold('temp-1', { kind: 'delete' });
		p.hold('temp-1', { kind: 'done', done: false });
		expect(p.take('temp-1')).toEqual([{ kind: 'delete' }]);
	});

	it('drop forgets, and ids are independent', () => {
		const p = createPendingActions();
		p.hold('temp-1', { kind: 'done', done: true });
		p.hold('temp-2', { kind: 'done', done: true });
		p.drop('temp-1');
		expect(p.take('temp-1')).toEqual([]);
		expect(p.take('temp-2')).toHaveLength(1);
	});
});
