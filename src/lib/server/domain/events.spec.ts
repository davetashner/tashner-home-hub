import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	MAX_SUBSCRIBERS,
	formatEvent,
	parseTopics,
	publish,
	subscribe,
	subscriberCount
} from './events.js';

const unsubs: (() => void)[] = [];
afterEach(() => {
	unsubs.splice(0).forEach((u) => u());
});
const sub = (fn = vi.fn()) => {
	const u = subscribe(['lists'], fn);
	if (u) unsubs.push(u);
	return { fn, u };
};

describe('events', () => {
	it('delivers published events with increasing ids', () => {
		const { fn } = sub();
		publish('lists', { listId: 'a' });
		publish('lists');
		expect(fn).toHaveBeenCalledTimes(2);
		const [a, b] = fn.mock.calls.map((c) => c[0]);
		expect(a).toMatchObject({ topic: 'lists', data: { listId: 'a' } });
		expect(b.id).toBeGreaterThan(a.id);
	});

	it('stops delivering after unsubscribe', () => {
		const { fn, u } = sub();
		u?.();
		publish('lists');
		expect(fn).not.toHaveBeenCalled();
		expect(subscriberCount()).toBe(0);
	});

	it('drops a listener that throws without blocking the others', () => {
		sub(
			vi.fn(() => {
				throw new Error('closed');
			})
		);
		const { fn } = sub();
		publish('lists');
		expect(fn).toHaveBeenCalledOnce();
		expect(subscriberCount()).toBe(1);
	});

	it('caps concurrent subscribers', () => {
		for (let i = 0; i < MAX_SUBSCRIBERS; i++) expect(sub().u).not.toBeNull();
		expect(sub().u).toBeNull();
	});

	it('parses topics and formats frames', () => {
		expect(parseTopics('lists,nope,lists')).toEqual(['lists']);
		expect(parseTopics(null)).toEqual([]);
		expect(formatEvent({ id: 3, topic: 'lists', data: { a: 'b' } })).toBe(
			'id: 3\nevent: lists\ndata: {"a":"b"}\n\n'
		);
	});
});
