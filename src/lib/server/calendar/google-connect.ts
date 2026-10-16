import { randomBytes, randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { calendarSources } from '../db/schema.js';
import type { Keyring } from '../domain/secrets.js';
import { getKeyring } from '../keys.js';
import {
	GoogleError,
	authUrl,
	createPkce,
	exchangeCode,
	googleConfig,
	listCalendarsWithToken,
	sealRefreshToken
} from './google.js';

const PENDING_TTL_MS = 15 * 60_000;
const MAX_PENDING = 20;
const pending = new Map<string, { verifier: string; expires: number }>();

/** Begins a consent: returns the Google URL to open on any device, plus the state to send back. */
export function startConsent(now = Date.now()): { url: string; state: string } {
	const cfg = googleConfig();
	for (const [k, v] of pending) if (v.expires < now) pending.delete(k);
	if (pending.size >= MAX_PENDING) pending.delete(pending.keys().next().value!);
	const state = randomBytes(18).toString('base64url');
	const { verifier, challenge } = createPkce();
	pending.set(state, { verifier, expires: now + PENDING_TTL_MS });
	return { url: authUrl(cfg, state, challenge), state };
}

/**
 * Accepts whatever the adult pasted: the full `http://127.0.0.1:9004/?code=...&state=...` address
 * (which the browser failed to load) or the bare code.
 */
export function parsePasted(pasted: string): { code: string; state?: string } {
	const text = pasted.trim();
	if (!text) throw new GoogleError('Paste the address Google sent you to, or the code from it');
	if (!/^https?:\/\//i.test(text) && !text.includes('code=')) return { code: text };
	let params: URLSearchParams;
	try {
		params = text.includes('?')
			? new URL(text.startsWith('?') ? `http://x${text}` : text).searchParams
			: new URLSearchParams(text);
	} catch {
		throw new GoogleError('That does not look like the address Google sent you to');
	}
	if (params.get('error'))
		throw new GoogleError('Google did not grant access. Start again and choose Allow');
	const code = params.get('code');
	if (!code) throw new GoogleError('That address has no code in it. Copy the whole address');
	return { code, state: params.get('state') ?? undefined };
}

export interface ConnectResult {
	id: string;
	calendars: { externalId: string; name: string; memberId: null; selected: boolean }[];
}

/** Finishes consent: exchanges the code, seals the refresh token and stores (or re-authorizes) a source. */
export async function finishConsent(
	db: Db,
	input: { pasted: string; state?: string; label?: string; sourceId?: string },
	keyring: Keyring = getKeyring()
): Promise<ConnectResult> {
	const { code, state: pastedState } = parsePasted(input.pasted);
	const state = pastedState ?? input.state;
	const entry = state ? pending.get(state) : undefined;
	if (!state || !entry || entry.expires < Date.now())
		throw new GoogleError('That sign-in attempt expired or was not started here. Start again');
	if (input.state && pastedState && input.state !== pastedState)
		throw new GoogleError('That address belongs to a different sign-in attempt. Start again');
	pending.delete(state);
	const tokens = await exchangeCode(googleConfig(), code, entry.verifier);
	const found = await listCalendarsWithToken(tokens.accessToken);
	const calendars = found.map((c) => ({ ...c, memberId: null }));

	if (input.sourceId) {
		const existing = db
			.select()
			.from(calendarSources)
			.where(eq(calendarSources.id, input.sourceId))
			.get();
		if (!existing || existing.provider !== 'google') throw new GoogleError('Unknown Google source');
		const known = new Set(
			(JSON.parse(existing.calendars) as { externalId: string }[]).map((c) => c.externalId)
		);
		const merged = [
			...(JSON.parse(existing.calendars) as unknown[]),
			...calendars.filter((c) => !known.has(c.externalId)).map((c) => ({ ...c, selected: false }))
		];
		db.update(calendarSources)
			.set({
				credentials: sealRefreshToken(keyring, existing.id, tokens.refreshToken),
				calendars: JSON.stringify(merged)
			})
			.where(eq(calendarSources.id, existing.id))
			.run();
		return { id: existing.id, calendars };
	}
	const id = randomUUID();
	db.insert(calendarSources)
		.values({
			id,
			provider: 'google',
			label: input.label?.trim() || 'Google Calendar',
			credentials: sealRefreshToken(keyring, id, tokens.refreshToken),
			calendars: JSON.stringify(calendars)
		})
		.run();
	return { id, calendars };
}
