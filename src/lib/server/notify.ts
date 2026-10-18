import { eq } from 'drizzle-orm';
import { getDb, type Db } from './db/index.js';
import { goals, members, rewards, settings } from './db/schema.js';
import { decryptSecret, encryptSecret, type Keyring } from './domain/secrets.js';
import { pendingApprovals } from './domain/ledger.js';
import type { Milestone } from '#lib/domain/streaks.js';
import { starBalance } from './domain/stars.js';
import { getKeyring } from './keys.js';
import {
	approvalMessage,
	createBatcher,
	decideGoalNotices,
	goalMessage,
	redeemedMessage,
	streakMessage,
	parseNotifyConfig,
	shouldSend,
	type EventKey,
	type GoalLedger,
	type NotifyConfig,
	type NtfyMessage
} from '#lib/domain/notify.js';

const CONFIG_KEY = 'notify.config';
const TOKEN_KEY = 'notify.token';
const LAST_KEY = 'notify.last';
const GOALS_KEY = 'notify.goals';
export const NOTIFY_TIMEOUT_MS = 5000;
export const APPROVAL_DEBOUNCE_MS = 20_000;

export interface SendResult {
	ok: boolean;
	at: number;
	detail: string;
}

function readJson(db: Db, key: string): unknown {
	try {
		return JSON.parse(db.select().from(settings).where(eq(settings.key, key)).get()!.value);
	} catch {
		return null;
	}
}

function write(db: Db, key: string, value: string): void {
	db.insert(settings)
		.values({ key, value })
		.onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: Date.now() } })
		.run();
}

export const readNotifyConfig = (db: Db): NotifyConfig =>
	parseNotifyConfig(readJson(db, CONFIG_KEY));
export const saveNotifyConfig = (db: Db, cfg: NotifyConfig): void =>
	write(db, CONFIG_KEY, JSON.stringify(cfg));

export const readLastResult = (db: Db): SendResult | null =>
	(readJson(db, LAST_KEY) as SendResult | null) ?? null;

const tokenRow = (db: Db) => db.select().from(settings).where(eq(settings.key, TOKEN_KEY)).get();
export const hasNotifyToken = (db: Db): boolean => tokenRow(db) !== undefined;

/** Stores the access token encrypted; an empty string forgets it. */
export function saveNotifyToken(db: Db, token: string, keyring: Keyring = getKeyring()): void {
	if (token === '') db.delete(settings).where(eq(settings.key, TOKEN_KEY)).run();
	else write(db, TOKEN_KEY, encryptSecret(keyring, token, TOKEN_KEY));
}

/** POSTs to ntfy. Never rejects; the outcome is saved as the last result. The token is never logged. */
export async function sendNtfy(
	db: Db,
	msg: NtfyMessage,
	opts: { doFetch?: typeof fetch; keyring?: Keyring; log?: (line: string) => void } = {}
): Promise<SendResult> {
	const { doFetch = fetch, log = console.warn } = opts;
	const at = Date.now();
	let result: SendResult;
	try {
		const cfg = readNotifyConfig(db);
		if (!cfg.topic) throw new Error('no topic set');
		if (!cfg.topic) throw new Error('no topic set');
		const headers: Record<string, string> = {
			Title: msg.title,
			Priority: String(msg.priority),
			Tags: msg.tags.join(',')
		};
		if (cfg.baseUrl && msg.path) headers.Click = cfg.baseUrl + msg.path;
		const stored = tokenRow(db);
		if (stored)
			headers.Authorization = `Bearer ${decryptSecret(opts.keyring ?? getKeyring(), stored.value, TOKEN_KEY)}`;
		const res = await doFetch(`${cfg.serverUrl}/${cfg.topic}`, {
			method: 'POST',
			headers,
			body: msg.message,
			signal: AbortSignal.timeout(NOTIFY_TIMEOUT_MS)
		});
		result = res.ok
			? { ok: true, at, detail: 'Sent' }
			: { ok: false, at, detail: `ntfy answered HTTP ${res.status}` };
	} catch (e) {
		const slow = e instanceof Error && e.name === 'TimeoutError';
		result = {
			ok: false,
			at,
			detail: slow ? 'ntfy did not answer in time' : 'Could not reach ntfy'
		};
	}
	if (!result.ok) log(`[notify] ${result.detail}`);
	write(db, LAST_KEY, JSON.stringify(result));
	return result;
}

/** Fire-and-forget: never throws and never makes the caller wait. */
function dispatch(db: Db, event: EventKey, build: () => NtfyMessage | null): void {
	try {
		if (!shouldSend(readNotifyConfig(db), event)) return;
		const msg = build();
		if (msg) void sendNtfy(db, msg).catch(() => {});
	} catch {
		// notifications must never break the request that triggered them
	}
}

const approvalBatcher = createBatcher(APPROVAL_DEBOUNCE_MS, () => {
	const db = getDb();
	dispatch(db, 'approval', () => {
		const waiting = pendingApprovals(db).length;
		return waiting > 0 ? approvalMessage(waiting) : null;
	});
});

/** Call after a completion that needs approval has committed. */
export function notifyApprovalWaiting(db: Db = getDb()): void {
	try {
		if (shouldSend(readNotifyConfig(db), 'approval')) approvalBatcher.add();
	} catch {
		// never break the request
	}
}

/** Call after any balance change. Announces each reached goal once. */
export function notifyGoalsReached(db: Db = getDb()): void {
	try {
		const cfg = readNotifyConfig(db);
		if (!cfg.enabled) return;
		const checks = db
			.select({
				memberId: goals.memberId,
				memberName: members.name,
				rewardId: rewards.id,
				rewardTitle: rewards.title,
				cost: rewards.cost
			})
			.from(goals)
			.innerJoin(members, eq(members.id, goals.memberId))
			.innerJoin(rewards, eq(rewards.id, goals.rewardId))
			.where(eq(rewards.active, true))
			.all()
			.map((r) => ({ ...r, reached: starBalance(db, r.memberId) >= r.cost }));
		const announced = (readJson(db, GOALS_KEY) ?? {}) as GoalLedger;
		const { notices, next } = decideGoalNotices(checks, announced);
		write(db, GOALS_KEY, JSON.stringify(next));
		if (!cfg.events.goal) return;
		for (const n of notices) dispatch(db, 'goal', () => goalMessage(n.memberName, n.rewardTitle));
	} catch {
		// notifications must never break the request that triggered them
	}
}

/** Call after a redemption has committed. Names come from the DB at send time. */
export function notifyRewardRedeemed(db: Db, memberId: string, rewardId: string): void {
	dispatch(db, 'redeemed', () => {
		const m = db.select().from(members).where(eq(members.id, memberId)).get();
		const r = db.select().from(rewards).where(eq(rewards.id, rewardId)).get();
		return m && r ? redeemedMessage(m.name, r.title) : null;
	});
}

/** Call after streak payout rows are written, with the milestones just paid. */
export function notifyStreakMilestones(db: Db, memberId: string, paid: Milestone[]): void {
	for (const p of paid)
		dispatch(db, 'streak', () => {
			const m = db.select().from(members).where(eq(members.id, memberId)).get();
			return m ? streakMessage(m.name, p.days, p.stars) : null;
		});
}
