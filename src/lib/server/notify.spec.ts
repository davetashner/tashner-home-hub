import { randomBytes } from 'node:crypto';
import { beforeEach, expect, it, vi } from 'vitest';
import { openDb, schema, type Db } from './db/index.js';
import { createKeyring } from './domain/secrets.js';
import { awardBonus } from './domain/ledger.js';
import { createReward, setGoal } from './domain/rewards.js';
import {
	hasNotifyToken,
	notifyGoalsReached,
	notifyRewardRedeemed,
	notifyStreakMilestones,
	readLastResult,
	saveNotifyConfig,
	saveNotifyToken,
	sendNtfy
} from './notify.js';
import { DEFAULT_NOTIFY, approvalMessage } from '#lib/domain/notify.js';

const keyring = createKeyring('k1', { k1: randomBytes(32) });
const SECRET = 'tk_supersecretvalue';
const ok = () => new Response('', { status: 200 });
const config = {
	...DEFAULT_NOTIFY,
	enabled: true,
	serverUrl: 'http://ntfy.test',
	topic: 'topic_x'
};
let db: Db;

beforeEach(() => {
	db = openDb(':memory:');
	db.insert(schema.members)
		.values({ id: 'kid', name: 'Kid A', role: 'child', color: 'blue' })
		.run();
	saveNotifyConfig(db, { ...config, baseUrl: 'http://hub.test' });
});

it('posts with ntfy headers, a click link and a timeout signal', async () => {
	const doFetch = vi.fn().mockResolvedValue(ok());
	const r = await sendNtfy(db, approvalMessage(3), { doFetch, keyring });
	expect(r).toMatchObject({ ok: true, detail: 'Sent' });
	const [url, init] = doFetch.mock.calls[0] as [string, RequestInit];
	expect(url).toBe('http://ntfy.test/topic_x');
	expect(init.method).toBe('POST');
	expect(init.body).toBe('3 Star Jobs waiting for approval');
	expect(init.signal).toBeInstanceOf(AbortSignal);
	expect(init.headers).toEqual({
		Title: 'Approval waiting',
		Priority: '3',
		Tags: 'white_check_mark',
		Click: 'http://hub.test/settings/approvals'
	});
	expect(readLastResult(db)).toEqual(r);
});

it('sends the stored token as a bearer header and never logs it', async () => {
	saveNotifyToken(db, SECRET, keyring);
	expect(hasNotifyToken(db)).toBe(true);
	expect(JSON.stringify(db.select().from(schema.settings).all())).not.toContain(SECRET);
	const good = vi.fn().mockResolvedValue(ok());
	await sendNtfy(db, approvalMessage(1), { doFetch: good, keyring });
	expect((good.mock.calls[0]![1] as RequestInit).headers).toMatchObject({
		Authorization: `Bearer ${SECRET}`
	});
	const log = vi.fn();
	const doFetch = vi.fn().mockRejectedValue(new Error(`boom ${SECRET}`));
	const r = await sendNtfy(db, approvalMessage(1), { doFetch, keyring, log });
	expect(r).toMatchObject({ ok: false, detail: 'Could not reach ntfy' });
	expect(JSON.stringify([log.mock.calls, readLastResult(db)])).not.toContain(SECRET);
	saveNotifyToken(db, '', keyring);
	expect(hasNotifyToken(db)).toBe(false);
});

it('announces a reached goal once', async () => {
	const fetchMock = vi.fn().mockResolvedValue(ok());
	vi.stubGlobal('fetch', fetchMock);
	const flush = () => new Promise((r) => setTimeout(r, 0));
	setGoal(db, 'kid', createReward(db, { title: 'Kite', cost: 5, image: null }).id);
	notifyGoalsReached(db);
	await flush();
	expect(fetchMock).not.toHaveBeenCalled();
	awardBonus(db, { memberId: 'kid', delta: 6, note: 'x' });
	notifyGoalsReached(db);
	notifyGoalsReached(db);
	await flush();
	expect(fetchMock).toHaveBeenCalledOnce();
	expect(fetchMock.mock.calls[0]![1].body).toBe('Kid A has enough stars for Kite');
	vi.unstubAllGlobals();
});

const flushAll = () => new Promise((r) => setTimeout(r, 0));

it('announces a redemption once, with names from the DB, and respects the toggle', async () => {
	const fetchMock = vi.fn().mockResolvedValue(ok());
	vi.stubGlobal('fetch', fetchMock);
	notifyRewardRedeemed(db, 'kid', createReward(db, { title: 'Kite', cost: 5, image: null }).id);
	await flushAll();
	expect(fetchMock).toHaveBeenCalledOnce();
	expect(fetchMock.mock.calls[0]![1].body).toBe('Kid A redeemed Kite');
	expect(fetchMock.mock.calls[0]![1].headers.Title).toBe('Reward redeemed');
	saveNotifyConfig(db, {
		...config,
		events: { ...config.events, redeemed: false }
	});
	notifyRewardRedeemed(db, 'kid', createReward(db, { title: 'Ball', cost: 5, image: null }).id);
	await flushAll();
	expect(fetchMock).toHaveBeenCalledOnce();
	vi.unstubAllGlobals();
});

it('announces each streak milestone paid, respects the toggle, never throws', async () => {
	const fetchMock = vi.fn().mockResolvedValue(ok());
	vi.stubGlobal('fetch', fetchMock);
	notifyStreakMilestones(db, 'kid', [{ days: 7, stars: 3 }]);
	await flushAll();
	expect(fetchMock).toHaveBeenCalledOnce();
	expect(fetchMock.mock.calls[0]![1].body).toBe('Kid A hit a 7-day streak and earned 3 stars');
	notifyStreakMilestones(db, 'kid', []);
	await flushAll();
	expect(fetchMock).toHaveBeenCalledOnce();
	fetchMock.mockRejectedValue(new Error('down'));
	expect(() => notifyStreakMilestones(db, 'kid', [{ days: 14, stars: 5 }])).not.toThrow();
	expect(() => notifyRewardRedeemed(db, 'nobody', 'nope')).not.toThrow();
	await flushAll();
	saveNotifyConfig(db, { ...config, events: { ...config.events, streak: false } });
	fetchMock.mockClear();
	notifyStreakMilestones(db, 'kid', [{ days: 7, stars: 3 }]);
	await flushAll();
	expect(fetchMock).not.toHaveBeenCalled();
	vi.unstubAllGlobals();
});
