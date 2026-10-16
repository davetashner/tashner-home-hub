import { eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { calendarSources } from '../db/schema.js';
import { readStatuses, type SourceStatus } from './sync.js';
import { maskedHost, openUrl } from './ics.js';
import { maskAppleId, openCredentials, REAUTH_MESSAGE } from './icloud.js';
import { getKeyring } from '../keys.js';
import type { CalendarSource } from './provider.js';

export interface SourceView {
	id: string;
	provider: CalendarSource['provider'];
	label: string;
	/** Host of the feed URL only (ICS); the URL itself is a secret and never leaves the server. */
	host: string | null;
	/** Apple ID with the local part masked (iCloud only). */
	account: string | null;
	/** True when the provider rejected the stored credentials on the last sync. */
	needsReauth: boolean;
	calendars: { externalId: string; name: string; memberId: string | null; selected: boolean }[];
	lastSyncAt: number | null;
	status: SourceStatus | null;
}

function hostOf(source: CalendarSource): string | null {
	if (source.provider !== 'ics') return null;
	try {
		return maskedHost(openUrl(getKeyring(), source)) || null;
	} catch {
		return null;
	}
}

function accountOf(source: CalendarSource): string | null {
	if (source.provider !== 'icloud') return null;
	try {
		return maskAppleId(openCredentials(getKeyring(), source).appleId);
	} catch {
		return null;
	}
}

/** Credential-free projection of a source for API responses. */
export function viewOf(source: CalendarSource, statuses: Record<string, SourceStatus>): SourceView {
	const cals: unknown = JSON.parse(source.calendars);
	return {
		id: source.id,
		provider: source.provider,
		label: source.label,
		host: hostOf(source),
		account: accountOf(source),
		needsReauth: statuses[source.id]?.lastError?.includes(REAUTH_MESSAGE) ?? false,
		calendars: (Array.isArray(cals) ? cals : []).map((c: Record<string, unknown>) => ({
			externalId: String(c.externalId),
			name: String(c.name ?? ''),
			memberId: typeof c.memberId === 'string' ? c.memberId : null,
			selected: c.selected !== false
		})),
		lastSyncAt: source.lastSyncAt,
		status: statuses[source.id] ?? null
	};
}

export function listSources(db: Db): SourceView[] {
	const statuses = readStatuses(db);
	return db
		.select()
		.from(calendarSources)
		.all()
		.map((s) => viewOf(s, statuses));
}

export function getSource(db: Db, id: string): CalendarSource | undefined {
	return db.select().from(calendarSources).where(eq(calendarSources.id, id)).get();
}
