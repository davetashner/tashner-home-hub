// Parent push notifications (ADM-6, REW-3): pure rules. The HTTP call is in #lib/server/notify.js.

export const DEFAULT_NTFY_SERVER = 'https://ntfy.sh';
export const EVENT_KEYS = ['approval', 'goal', 'redeemed', 'streak', 'sitter'] as const;
export type EventKey = (typeof EVENT_KEYS)[number];

export interface NotifyConfig {
	enabled: boolean;
	serverUrl: string;
	topic: string;
	baseUrl: string;
	events: Record<EventKey, boolean>;
}

export const DEFAULT_NOTIFY: NotifyConfig = {
	enabled: false,
	serverUrl: DEFAULT_NTFY_SERVER,
	topic: '',
	baseUrl: '',
	events: { approval: true, goal: true, redeemed: true, streak: true, sitter: true }
};

export interface NtfyMessage {
	title: string;
	message: string;
	priority: 1 | 2 | 3 | 4 | 5;
	tags: string[];
	path?: string;
}

const TOPIC = /^[A-Za-z0-9_-]{1,64}$/;

export function cleanUrl(v: unknown): string | null {
	try {
		const u = new URL(String(v).trim());
		if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
		return (u.origin + u.pathname).replace(/\/+$/, '');
	} catch {
		return null;
	}
}

/** Applies a settings patch on top of `current`. Returns an error string for bad input. */
export function applyNotifyPatch(
	current: NotifyConfig,
	patch: Record<string, unknown>
): NotifyConfig | string {
	const next: NotifyConfig = { ...current, events: { ...current.events } };
	if (patch.enabled !== undefined) {
		if (typeof patch.enabled !== 'boolean') return 'enabled must be true or false';
		next.enabled = patch.enabled;
	}
	for (const key of ['serverUrl', 'baseUrl'] as const) {
		if (patch[key] === undefined) continue;
		const empty = patch[key] === '';
		const url = empty ? (key === 'baseUrl' ? '' : DEFAULT_NTFY_SERVER) : cleanUrl(patch[key]);
		if (url === null) return `${key} must be an http(s) address`;
		next[key] = url;
	}
	if (patch.topic !== undefined) {
		const t = typeof patch.topic === 'string' ? patch.topic.trim() : null;
		if (t === null || (t !== '' && !TOPIC.test(t)))
			return 'topic may use letters, numbers, - and _ (up to 64)';
		next.topic = t;
	}
	const ev = patch.events;
	if (ev !== undefined) {
		if (!ev || typeof ev !== 'object') return 'events must be an object';
		for (const [k, v] of Object.entries(ev)) {
			if (!(EVENT_KEYS as readonly string[]).includes(k) || typeof v !== 'boolean')
				return `events.${k} is not a valid toggle`;
			next.events[k as EventKey] = v;
		}
	}
	if (next.enabled && !next.topic) return 'A topic is needed before notifications can be on';
	return next;
}

export function parseNotifyConfig(raw: unknown): NotifyConfig {
	const r = applyNotifyPatch(DEFAULT_NOTIFY, Object(raw) as Record<string, unknown>);
	return typeof r === 'string' ? DEFAULT_NOTIFY : r;
}

export const shouldSend = (cfg: NotifyConfig, event: EventKey): boolean =>
	cfg.enabled && cfg.topic !== '' && cfg.events[event];

const note = (title: string, message: string, priority: 3 | 4, tags: string[], path?: string) => ({
	title,
	message,
	priority,
	tags,
	...(path ? { path } : {})
});

export const approvalMessage = (count: number): NtfyMessage =>
	note(
		'Approval waiting',
		`${count} ${count === 1 ? 'Star Job' : 'Star Jobs'} waiting for approval`,
		3,
		['white_check_mark'],
		'/settings/approvals'
	);

export const goalMessage = (name: string, reward: string): NtfyMessage =>
	note(
		'Goal reached',
		`${name} has enough stars for ${reward}`,
		4,
		['star', 'tada'],
		'/settings/approvals'
	);

export const redeemedMessage = (name: string, reward: string): NtfyMessage =>
	note('Reward redeemed', `${name} redeemed ${reward}`, 3, ['gift'], '/settings/redemptions');

export const streakMessage = (name: string, days: number, stars: number): NtfyMessage =>
	note(
		'Streak milestone',
		`${name} hit a ${days}-day streak and earned ${stars} ${stars === 1 ? 'star' : 'stars'}`,
		3,
		['fire']
	);

const SITTER_PATH = '/settings/sitter-mode';
const sitterLabel = (name: string | null) => (name ? name : 'the sitter');

export function sitterCheckinMessage(
	kind: 'in-bed' | 'all-good' | 'call-me',
	name: string | null
): NtfyMessage {
	const from = name ? ` (from ${name})` : '';
	if (kind === 'in-bed')
		return note('Sitter check-in', `Kids are in bed${from}`, 3, ['bed'], SITTER_PATH);
	if (kind === 'all-good')
		return note('Sitter check-in', `All good at home${from}`, 3, ['white_check_mark'], SITTER_PATH);
	return note(
		'Sitter needs you',
		`Please call the sitter${from}`,
		4,
		['telephone_receiver'],
		SITTER_PATH
	);
}

export const sitterStartMessage = (name: string | null): NtfyMessage =>
	note(
		'Sitter session started',
		`${sitterLabel(name)} is now in charge of the wall`,
		3,
		['house'],
		SITTER_PATH
	);

export const sitterEndMessage = (name: string | null): NtfyMessage =>
	note(
		'Sitter session ended',
		`${sitterLabel(name)}'s session ended on its own`,
		3,
		['wave'],
		SITTER_PATH
	);

export const testMessage = (): NtfyMessage =>
	note('Home Hub test', 'Notifications are working.', 3, ['bell']);

/** Trailing debounce: five quick taps flush once with a count of five. */
export function createBatcher(delayMs: number, flush: (count: number) => void) {
	let count = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;
	return {
		add() {
			count += 1;
			clearTimeout(timer);
			timer = setTimeout(() => {
				const n = count;
				count = 0;
				flush(n);
			}, delayMs);
		}
	};
}

export interface GoalCheck {
	memberId: string;
	memberName: string;
	rewardId: string;
	rewardTitle: string;
	reached: boolean;
}

export type GoalLedger = Record<string, string>;

/** Goals newly reached. Dropping under the cost or changing the goal re-arms it. */
export function decideGoalNotices(
	goals: GoalCheck[],
	announced: GoalLedger
): { notices: GoalCheck[]; next: GoalLedger } {
	const next: GoalLedger = {};
	const notices: GoalCheck[] = [];
	for (const g of goals) {
		if (!g.reached) continue;
		next[g.memberId] = g.rewardId;
		if (announced[g.memberId] !== g.rewardId) notices.push(g);
	}
	return { notices, next };
}
