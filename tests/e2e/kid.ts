import { expect, type Page } from '@playwright/test';
import { signInAsAdult } from './adult';

export interface KidSeed {
	memberId: string;
	chores: Record<string, string>;
}

/** Synthetic kid with chores: "Make bed" (2 stars) approved; the rest still to do. */
export async function seedKid(page: Page, label: string, extra: string[] = []): Promise<KidSeed> {
	await signInAsAdult(page, `adult-cel-${label.replace(/\W/g, '')}`);
	const request = page.request;
	const member = await (
		await request.post('/api/members', {
			data: { name: `Kiki ${Date.now() % 1e9}`, role: 'child', color: 'member-4', avatar: '🦊' }
		})
	).json();
	const chores: Record<string, string> = {};
	const defs = [
		{ title: 'Make bed', icon: '🛏️', stars: 2, timeOfDay: 'morning' },
		{ title: 'Brush teeth', icon: '🪥', stars: 1, timeOfDay: 'morning' },
		{ title: 'Feed the fish', icon: '🐟', stars: 3, timeOfDay: 'afternoon' },
		...extra.map((title) => ({ title, icon: '🧸', stars: 1, timeOfDay: 'evening' }))
	];
	for (const def of defs) {
		const chore = await (
			await request.post('/api/chores', {
				data: { ...def, memberIds: [member.id], schedule: { type: 'daily' } }
			})
		).json();
		chores[def.title] = chore.id;
	}
	const done = await (
		await request.post(`/api/chores/${chores['Make bed']}/complete`, {
			data: { memberId: member.id }
		})
	).json();
	await request.post(`/api/completions/${done.completion.id}/approve`, { data: {} });
	return { memberId: member.id, chores };
}

/** Replaces AudioContext with a counter so tests can see whether sound was attempted. */
export async function stubAudio(page: Page): Promise<() => Promise<number>> {
	// No quiet hours, so the tests do not depend on the time of day.
	await page.route('**/api/settings/sound', (route) =>
		route.fulfill({ json: { muted: false, quietStart: '00:00', quietEnd: '00:00' } })
	);
	await page.addInitScript(() => {
		const w = window as unknown as { __notes: number; AudioContext: unknown };
		w.__notes = 0;
		const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} });
		const node = (extra: object) => ({ connect: (n: unknown) => n, ...extra });
		w.AudioContext = class {
			currentTime = 0;
			state = 'running';
			destination = {};
			resume = () => Promise.resolve();
			createGain = () => node({ gain: param() });
			createOscillator() {
				w.__notes += 1;
				return node({ frequency: param(), start() {}, stop() {} });
			}
		};
	});
	return () => page.evaluate(() => (window as unknown as { __notes: number }).__notes);
}

export async function openKid(page: Page, s: KidSeed) {
	await page.goto(`/chores?member=${s.memberId}`);
	await expect(page.getByTestId('star-jar')).toBeVisible();
}

export const choreCard = (page: Page, title: string) =>
	page.getByTestId('chore-card').filter({ has: page.getByRole('heading', { name: title }) });
