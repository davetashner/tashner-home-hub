import { describe, expect, it, vi } from 'vitest';
import {
	DEFAULT_NOTIFY,
	applyNotifyPatch,
	approvalMessage,
	cleanUrl,
	createBatcher,
	decideGoalNotices,
	goalMessage,
	parseNotifyConfig,
	shouldSend,
	testMessage,
	type GoalCheck
} from './notify.js';

const on = { ...DEFAULT_NOTIFY, enabled: true, topic: 'abc_123' };

describe('config', () => {
	it('falls back to defaults for junk and reads good values', () => {
		expect(parseNotifyConfig(null)).toEqual(DEFAULT_NOTIFY);
		expect(parseNotifyConfig({ serverUrl: 'ftp://x' })).toEqual(DEFAULT_NOTIFY);
		const good = { ...on, serverUrl: 'http://ntfy.local:8080/', events: { approval: false } };
		expect(parseNotifyConfig(good)).toEqual({
			...on,
			serverUrl: 'http://ntfy.local:8080',
			events: { approval: false, goal: true }
		});
	});

	it('cleans urls and resets them with an empty string', () => {
		expect(cleanUrl(' https://ntfy.sh/ ')).toBe('https://ntfy.sh');
		const set = { ...on, serverUrl: 'http://x', baseUrl: 'http://h' };
		expect(applyNotifyPatch(set, { serverUrl: '', baseUrl: '' })).toMatchObject({
			serverUrl: 'https://ntfy.sh',
			baseUrl: ''
		});
	});

	it.each([
		[{ enabled: 'yes' }],
		[{ serverUrl: 'file:///x' }],
		[{ topic: 'has space' }],
		[{ events: { nope: true } }],
		[{ enabled: true }]
	])('rejects %j', (patch) => {
		expect(typeof applyNotifyPatch(DEFAULT_NOTIFY, patch)).toBe('string');
	});

	it('shouldSend needs master switch, topic and toggle', () => {
		expect(shouldSend(on, 'goal')).toBe(true);
		expect(shouldSend({ ...on, events: { ...on.events, goal: false } }, 'goal')).toBe(false);
		expect(shouldSend({ ...on, topic: '' }, 'goal')).toBe(false);
	});
});

it('builds messages', () => {
	expect(approvalMessage(1).message).toBe('1 chore waiting for approval');
	expect(approvalMessage(3).message).toBe('3 chores waiting for approval');
	expect(goalMessage('Kid', 'Kite').message).toBe('Kid has enough stars for Kite');
	expect(testMessage().path).toBeUndefined();
});

it('batches five quick adds into one flush of five', () => {
	vi.useFakeTimers();
	const flush = vi.fn();
	const b = createBatcher(1000, flush);
	for (let i = 0; i < 5; i++) {
		b.add();
		vi.advanceTimersByTime(400);
	}
	expect(flush).not.toHaveBeenCalled();
	vi.advanceTimersByTime(1000);
	expect(flush).toHaveBeenCalledExactlyOnceWith(5);
	vi.useRealTimers();
});

it('announces a goal once, re-arming when it drops or changes', () => {
	const g = (reached: boolean, rewardId = 'r1'): GoalCheck => ({
		memberId: 'm1',
		memberName: 'Kid',
		rewardId,
		rewardTitle: 'Kite',
		reached
	});
	const first = decideGoalNotices([g(true)], {});
	expect(first.notices).toHaveLength(1);
	expect(decideGoalNotices([g(true)], first.next).notices).toEqual([]);
	const dropped = decideGoalNotices([g(false)], first.next);
	expect(dropped.next).toEqual({});
	expect(decideGoalNotices([g(true)], dropped.next).notices).toHaveLength(1);
	expect(decideGoalNotices([], first.next).next).toEqual({});
});
