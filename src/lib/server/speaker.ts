/**
 * The Bluetooth speaker on the Pi kiosk (hub-txj.1). The Pi's display agent owns Bluetooth and
 * serves a small token-authenticated API (kiosk/README.md, "Bluetooth speaker"); the hub server
 * proxies it so Settings > Music > Speaker works from any device, and the token never reaches a
 * browser. Configure with HUB_KIOSK_SPEAKER_URL (e.g. http://hub-kiosk.local:8742) and
 * HUB_KIOSK_SPEAKER_TOKEN (the Pi's /etc/hub-kiosk/speaker-api.token).
 */
import { json } from '@sveltejs/kit';

/**
 * not_configured: the hub has no URL or token. unreachable: the Pi did not answer.
 * none: no speaker chosen yet. not_paired / off / connected: the chosen speaker's link.
 */
export type SpeakerState =
	'not_configured' | 'unreachable' | 'none' | 'not_paired' | 'off' | 'connected';

export interface SpeakerStatus {
	state: SpeakerState;
	name: string | null;
	mac: string | null;
	/** Connected and the Pi's default audio output. */
	defaultSink: boolean;
}

export interface SpeakerDevice {
	mac: string;
	name: string;
	kind: 'speaker' | 'phone' | 'other';
	/** 0-4 signal bars. */
	bars: number;
	paired: boolean;
	connected: boolean;
}

export type SpeakerErrorCode = 'not_configured' | 'unreachable' | 'failed' | 'invalid';

export class SpeakerError extends Error {
	constructor(
		readonly code: SpeakerErrorCode,
		message: string
	) {
		super(message);
		this.name = 'SpeakerError';
	}
}

export interface SpeakerDeps {
	env?: NodeJS.ProcessEnv;
	fetch?: typeof fetch;
}

const MAC = /^[0-9A-F]{2}(:[0-9A-F]{2}){5}$/;
const PI_STATES = new Set(['none', 'not_paired', 'off', 'connected']);
const KINDS = new Set(['speaker', 'phone', 'other']);
/** Scanning takes 8 s on the Pi and pairing up to 30 s more. */
const TIMEOUT_MS = { status: 4000, scan: 20_000, use: 60_000, test: 20_000 };

function target(env: NodeJS.ProcessEnv): { url: string; token: string } | null {
	const url = env.HUB_KIOSK_SPEAKER_URL?.trim().replace(/\/+$/, '');
	const token = env.HUB_KIOSK_SPEAKER_TOKEN?.trim();
	return url && token && /^https?:\/\//.test(url) ? { url, token } : null;
}

const text = (v: unknown, max = 100) =>
	typeof v === 'string' && v.length > 0 ? v.slice(0, max) : null;

async function call(
	path: string,
	init: { method: 'GET' | 'POST'; body?: unknown; timeout: number },
	deps: SpeakerDeps
): Promise<unknown> {
	const t = target(deps.env ?? process.env);
	if (!t) throw new SpeakerError('not_configured', 'The hub is not set up to reach the speaker');
	let res: Response;
	try {
		res = await (deps.fetch ?? fetch)(t.url + path, {
			method: init.method,
			headers: {
				authorization: `Bearer ${t.token}`,
				...(init.body === undefined ? {} : { 'content-type': 'application/json' })
			},
			body: init.body === undefined ? undefined : JSON.stringify(init.body),
			signal: AbortSignal.timeout(init.timeout)
		});
	} catch {
		throw new SpeakerError('unreachable', 'The wall display did not answer');
	}
	const body: unknown = await res.json().catch(() => null);
	if (res.status === 409) {
		// The Pi appends bluetoothctl's output in parentheses: useful in its log, noise to an adult.
		const reason = text((body as { error?: unknown } | null)?.error, 300)?.replace(/\s*\(.*$/s, '');
		throw new SpeakerError('failed', reason || 'The speaker did not respond');
	}
	// 401 means the tokens differ: to the adult that is still "set up wrong".
	if (res.status === 401)
		throw new SpeakerError('not_configured', 'The wall display rejected the hub (check the token)');
	if (!res.ok) throw new SpeakerError('unreachable', 'The wall display did not answer');
	return body;
}

function toStatus(body: unknown): SpeakerStatus {
	const b = (body ?? {}) as Record<string, unknown>;
	const state = PI_STATES.has(b.state as string) ? (b.state as SpeakerState) : 'none';
	const mac = typeof b.mac === 'string' && MAC.test(b.mac) ? b.mac : null;
	return { state, mac, name: text(b.name), defaultSink: b.defaultSink === true };
}

const blank = (state: SpeakerState): SpeakerStatus => ({
	state,
	name: null,
	mac: null,
	defaultSink: false
});

/** The speaker's state for Settings and the kid Music tab. Never throws. */
export async function speakerStatus(deps: SpeakerDeps = {}): Promise<SpeakerStatus> {
	try {
		return toStatus(await call('/speaker', { method: 'GET', timeout: TIMEOUT_MS.status }, deps));
	} catch (e) {
		if (e instanceof SpeakerError && e.code === 'not_configured') return blank('not_configured');
		return blank('unreachable');
	}
}

/** Named devices near the Pi, speakers first. */
export async function scanSpeakers(deps: SpeakerDeps = {}): Promise<SpeakerDevice[]> {
	const body = (await call(
		'/speaker/scan',
		{ method: 'POST', body: {}, timeout: TIMEOUT_MS.scan },
		deps
	)) as { devices?: unknown } | null;
	const list = Array.isArray(body?.devices) ? body.devices : [];
	return list.flatMap((d: Record<string, unknown>) => {
		const mac = typeof d?.mac === 'string' ? d.mac.toUpperCase() : '';
		const name = text(d?.name);
		if (!MAC.test(mac) || !name) return [];
		const bars = Number(d.bars);
		return [
			{
				mac,
				name,
				kind: KINDS.has(d.kind as string) ? (d.kind as SpeakerDevice['kind']) : 'other',
				bars: Number.isInteger(bars) ? Math.min(4, Math.max(0, bars)) : 0,
				paired: d.paired === true,
				connected: d.connected === true
			}
		];
	});
}

/** Pairs, connects and selects a speaker. Pairing needs the speaker in pairing mode. */
export async function useSpeaker(mac: unknown, deps: SpeakerDeps = {}): Promise<SpeakerStatus> {
	const m = typeof mac === 'string' ? mac.trim().toUpperCase() : '';
	if (!MAC.test(m)) throw new SpeakerError('invalid', 'mac must look like AA:BB:CC:DD:EE:FF');
	return toStatus(
		await call('/speaker/use', { method: 'POST', body: { mac: m }, timeout: TIMEOUT_MS.use }, deps)
	);
}

/** Plays a short chime on the speaker. */
export async function testSpeaker(deps: SpeakerDeps = {}): Promise<void> {
	await call('/speaker/test', { method: 'POST', body: {}, timeout: TIMEOUT_MS.test }, deps);
}

const STATUS = { not_configured: 503, unreachable: 502, failed: 409, invalid: 400 } as const;

/** Runs a speaker call and maps SpeakerError to `{ code, message }` JSON the UI can show. */
export async function speakerResponse(fn: () => Promise<unknown>): Promise<Response> {
	try {
		return json(await fn());
	} catch (e) {
		if (e instanceof SpeakerError)
			return json({ code: e.code, message: e.message }, { status: STATUS[e.code] });
		throw e;
	}
}
