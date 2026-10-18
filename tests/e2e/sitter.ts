import { mkdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { APIRequestContext } from '@playwright/test';
import { DATA_DIR } from './data-dir';

// The info card and the current sitter session are household-wide on a shared server, so specs
// take turns. All phone numbers and names in the tests are synthetic.
const LOCK = join(DATA_DIR, '.sitter-lock');

export async function holdSitter(): Promise<() => void> {
	mkdirSync(DATA_DIR, { recursive: true });
	for (;;) {
		try {
			mkdirSync(LOCK);
			return () => rmSync(LOCK, { recursive: true, force: true });
		} catch {
			try {
				if (Date.now() - statSync(LOCK).mtimeMs > 90_000) rmSync(LOCK, { recursive: true });
			} catch {
				// released meanwhile
			}
			await new Promise((r) => setTimeout(r, 200));
		}
	}
}

export interface SessionOptions {
	endAt: number;
	sitterName?: string;
	pin?: string;
	approveJobs?: boolean;
	funAllowed?: boolean;
}

/** Ends any open session, then starts a new one (as the signed-in adult). Returns its id. */
export async function startSession(request: APIRequestContext, o: SessionOptions): Promise<string> {
	const cur = (await (await request.get('/api/sitter/current')).json()) as {
		session: { id: string } | null;
	};
	if (cur.session)
		await request.patch(`/api/sitter/sessions/${cur.session.id}`, { data: { end: true } });
	const res = await request.post('/api/sitter/sessions', { data: o });
	if (!res.ok()) throw new Error(`could not start a sitter session: ${res.status()}`);
	return ((await res.json()) as { id: string }).id;
}

export async function endSession(request: APIRequestContext, id: string): Promise<void> {
	await request.patch(`/api/sitter/sessions/${id}`, { data: { end: true } });
}

/** A synthetic info card for one child. */
export function testCard(kidId: string) {
	return {
		contacts: [{ name: 'Grandma Test', relation: 'Grandmother', phone: '555-0101' }],
		address: '1 Test Lane',
		kids: [
			{
				memberId: kidId,
				bedtime: '19:30',
				allergies: 'Peanuts',
				medical: 'Inhaler in the blue bag'
			}
		],
		rules: ['No screens after 7', 'Lights out at bedtime'],
		wifiName: 'TestNet',
		wifiPassword: 'not-a-real-password',
		tonight: 'Pizza in the freezer'
	};
}
