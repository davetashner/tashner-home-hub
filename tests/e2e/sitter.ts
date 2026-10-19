import type { APIRequestContext } from '@playwright/test';

// All phone numbers and names in the tests are synthetic.
export { holdSitter } from './sitter-lock';

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
		tonight: 'Pizza in the freezer',
		pets: [{ name: 'Rex', kind: 'Dog', notes: 'Pill in cheese', feedTimes: ['18:30'] }],
		vet: { name: 'Test Vet', phone: '555-0102', hours: '9 to 5', address: '2 Test Road' },
		petER: {
			name: 'Test Pet ER',
			phone: '555-0103',
			hours: 'Open 24 hours',
			address: '3 Test Road'
		}
	};
}
