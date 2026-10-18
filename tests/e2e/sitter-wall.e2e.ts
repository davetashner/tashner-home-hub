import { expect, test, type Page } from '@playwright/test';
import { signInAsAdult } from './adult';
import { trackMember } from './cleanup';
import { asWallDisplay } from './display';
import { gotoHydrated } from './hydrated';
import { endSession, holdSitter, startSession, testCard } from './sitter';

const HOUR = 3_600_000;

/** The wall as the sitter sees it: a display-role browser with no adult session. */
async function sitterWall(page: Page) {
	const context = await page.context().browser()!.newContext({
		baseURL: test.info().project.use.baseURL,
		viewport: test.info().project.use.viewport
	});
	await asWallDisplay(context);
	return context;
}

test(
	'the wall shows Emergency info and locks parent-only parts during a session',
	{ tag: '@J19.5' },
	async ({ page }, info) => {
		test.setTimeout(120_000);
		const release = await holdSitter();
		const tag = info.project.name.replace(/\W/g, '');
		try {
			await signInAsAdult(page, `adult-sitter-wall-${tag}`);
			const kid = (await (
				await page.request.post('/api/members', {
					data: {
						name: `Kid A ${Date.now() % 1e9}`,
						role: 'child',
						color: 'member-4',
						avatar: '🦊'
					}
				})
			).json()) as { id: string };
			trackMember(kid.id);
			expect((await page.request.put('/api/sitter/card', { data: testCard(kid.id) })).ok()).toBe(
				true
			);
			const sessionId = await startSession(page.request, {
				endAt: Date.now() + 3 * HOUR,
				sitterName: `Sam Sitter ${tag}`,
				pin: '4812',
				funAllowed: false
			});

			const sitterCtx = await sitterWall(page);
			const wall = await sitterCtx.newPage();
			await wall.clock.install({ time: Date.now() });
			await gotoHydrated(wall, '/');

			await test.step('J19.5 the Emergency button is always there, with a PIN-gated sheet', async () => {
				await expect(wall.getByTestId('emergency-open')).toBeVisible();
				const box = (await wall.getByTestId('emergency-open').boundingBox())!;
				expect(box.height).toBeGreaterThanOrEqual(60);
				// It follows the sitter to other pages.
				await gotoHydrated(wall, '/lists');
				await expect(wall.getByTestId('emergency-open')).toBeVisible();
				await wall.getByTestId('emergency-open').click();
				await expect(wall.getByTestId('emergency-911')).toContainText('Call 911');
				await expect(wall.getByTestId('emergency-poison')).toContainText(
					'Poison Control 1-800-222-1222'
				);
				// 911 and Poison Control are never behind the PIN; the household card is.
				await expect(wall.getByTestId('emergency-card')).toHaveCount(0);
				await expect(wall.getByTestId('emergency-address')).not.toContainText('Test Lane');
				for (const d of '0000')
					await wall.getByTestId('pinpad').getByRole('button', { name: d, exact: true }).click();
				await wall.getByRole('button', { name: 'Enter PIN' }).click();
				await expect(wall.getByTestId('pin-message')).toHaveText('Wrong PIN.');
				for (const d of '4812')
					await wall.getByTestId('pinpad').getByRole('button', { name: d, exact: true }).click();
				await wall.getByRole('button', { name: 'Enter PIN' }).click();
				await expect(wall.getByTestId('emergency-address')).toHaveText('1 Test Lane');
				await expect(wall.getByTestId('emergency-contact')).toContainText('555-0101');
				await expect(wall.getByTestId('emergency-kid')).toContainText('Peanuts');
				await expect(wall.getByTestId('emergency-kid')).toContainText('19:30');
				await expect(wall.getByTestId('emergency-wifi')).toContainText('TestNet');
				// Entered once: closing and reopening shows the card straight away.
				await wall.getByTestId('emergency-close').click();
				await expect(wall.getByTestId('emergency-sheet')).toHaveCount(0);
				await wall.getByTestId('emergency-open').click();
				await expect(wall.getByTestId('emergency-card')).toBeVisible();
				await wall.getByTestId('emergency-close').click();
			});

			await test.step('J19.5 settings are locked and Games and Music are hidden', async () => {
				await expect(wall.getByTestId('settings-link')).toHaveAttribute('data-locked', '');
				// The note shows in the side rail; the portrait bar has no room for it.
				await expect(wall.getByTestId('sitter-lock-note')).toBeAttached();
				await expect(wall.locator('nav[aria-label="Main"] a[href="/games"]')).toHaveCount(0);
				await expect(wall.locator('nav[aria-label="Main"] a[href="/music"]')).toHaveCount(0);
				await wall.goto('/games');
				await expect(wall).toHaveURL(/\/$/);
				// Settings still ask for a parent PIN.
				await wall.getByTestId('settings-link').click();
				await expect(wall).toHaveURL(/\/unlock/);
			});

			await test.step('J19.5 a parent signed in at the wall is not locked out', async () => {
				const parent = await page.context().newPage();
				await asWallDisplay(page.context());
				await gotoHydrated(parent, '/');
				await expect(parent.getByTestId('emergency-open')).toBeVisible();
				await expect(parent.getByTestId('settings-link')).not.toHaveAttribute('data-locked', '');
				await expect(parent.locator('nav[aria-label="Main"] a[href="/games"]')).toHaveCount(1);
				await parent.close();
			});

			await test.step('J19.5 ending the session gives the wall back', async () => {
				await gotoHydrated(wall, '/');
				await endSession(page.request, sessionId);
				await wall.clock.fastForward(20_000);
				await expect(wall.getByTestId('emergency-open')).toHaveCount(0);
				await expect(wall.getByTestId('settings-link')).not.toHaveAttribute('data-locked', '');
			});

			await test.step('J19.5 without a PIN the sheet shows the card at once, and the session ends itself', async () => {
				await startSession(page.request, { endAt: Date.now() + HOUR, sitterName: 'Sam Sitter' });
				await wall.clock.fastForward(20_000);
				await expect(wall.getByTestId('emergency-open')).toBeVisible();
				await wall.getByTestId('emergency-open').click();
				await expect(wall.getByTestId('emergency-address')).toHaveText('1 Test Lane');
				await expect(wall.getByTestId('emergency-pin')).toHaveCount(0);
				await wall.getByTestId('emergency-close').click();
				// The clock alone ends it: the server still says active, the wall's time says over.
				await wall.clock.fastForward(2 * HOUR);
				await expect(wall.getByTestId('emergency-open')).toHaveCount(0);
			});

			await sitterCtx.close();
		} finally {
			const cur = (await (await page.request.get('/api/sitter/current')).json()) as {
				session: { id: string } | null;
			};
			if (cur.session) await endSession(page.request, cur.session.id);
			release();
		}
	}
);

test(
	'the sitter PIN checks Star Jobs only when the parents allowed it',
	{ tag: '@J19.8' },
	async ({ page }, info) => {
		test.setTimeout(120_000);
		const release = await holdSitter();
		const tag = info.project.name.replace(/\W/g, '');
		try {
			await signInAsAdult(page, `adult-sitter-wall-${tag}`);
			const kid = (await (
				await page.request.post('/api/members', {
					data: {
						name: `Kid B ${Date.now() % 1e9}`,
						role: 'child',
						color: 'member-4',
						avatar: '🦊'
					}
				})
			).json()) as { id: string };
			trackMember(kid.id);
			const title = `Sweep ${tag} ${Date.now() % 1e6}`;
			const chore = (await (
				await page.request.post('/api/chores', {
					data: {
						title,
						icon: '🧹',
						stars: 2,
						timeOfDay: 'evening',
						memberIds: [kid.id],
						schedule: { type: 'daily' },
						requiresApproval: true
					}
				})
			).json()) as { id: string };
			const done = (await (
				await page.request.post(`/api/chores/${chore.id}/complete`, {
					data: { memberId: kid.id }
				})
			).json()) as { completion: { id: string } };

			const sitterCtx = await sitterWall(page);
			const wall = await sitterCtx.newPage();
			await gotoHydrated(wall, '/');

			await test.step('J19.8 no Check jobs button when approving was not allowed', async () => {
				const id = await startSession(page.request, {
					endAt: Date.now() + HOUR,
					pin: '4812',
					approveJobs: false
				});
				await wall.reload();
				await expect(wall.getByTestId('emergency-open')).toBeVisible();
				await expect(wall.getByTestId('sitter-approvals-open')).toHaveCount(0);
				const denied = await sitterCtx.request.post('/api/sitter/approvals', {
					data: { pin: '4812', action: 'approve', completionId: done.completion.id }
				});
				expect(denied.status()).toBe(403);
				await endSession(page.request, id);
			});

			await test.step('J19.8 with permission the sitter PIN approves a Star Job', async () => {
				await startSession(page.request, {
					endAt: Date.now() + HOUR,
					pin: '4812',
					approveJobs: true
				});
				await wall.reload();
				await wall.getByTestId('sitter-approvals-open').click();
				const pad = wall.getByTestId('pinpad');
				for (const d of '0000') await pad.getByRole('button', { name: d, exact: true }).click();
				await pad.getByRole('button', { name: 'Enter PIN' }).click();
				await expect(wall.getByTestId('pin-message')).toHaveText('Wrong PIN.');
				for (const d of '4812') await pad.getByRole('button', { name: d, exact: true }).click();
				await pad.getByRole('button', { name: 'Enter PIN' }).click();
				const row = wall.getByTestId('sitter-approval').filter({ hasText: title });
				await expect(row).toBeVisible();
				await row.getByTestId('sitter-approve').click();
				await expect(row).toHaveCount(0);
				await expect
					.poll(async () => {
						const list = (await (await page.request.get('/api/approvals')).json()) as {
							completionId: string;
						}[];
						return list.some((i) => i.completionId === done.completion.id);
					})
					.toBe(false);
			});

			await sitterCtx.close();
		} finally {
			const cur = (await (await page.request.get('/api/sitter/current')).json()) as {
				session: { id: string } | null;
			};
			if (cur.session) await endSession(page.request, cur.session.id);
			release();
		}
	}
);

test(
	"the wall's home is tonight's plan while a session runs, and goes back when it ends",
	{ tag: '@J19.9' },
	async ({ page }, info) => {
		test.setTimeout(120_000);
		const release = await holdSitter();
		const tag = info.project.name.replace(/\W/g, '');
		const p2 = (n: number) => String(n).padStart(2, '0');
		const d = new Date();
		const today = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
		let routineId: string | null = null;
		try {
			await signInAsAdult(page, `adult-sitter-wall-${tag}`);
			const kidName = `Kid C ${Date.now() % 1e9}`;
			const kid = (await (
				await page.request.post('/api/members', {
					data: { name: kidName, role: 'child', color: 'member-4', avatar: '🦊' }
				})
			).json()) as { id: string };
			trackMember(kid.id);
			expect((await page.request.put('/api/sitter/card', { data: testCard(kid.id) })).ok()).toBe(
				true
			);
			const choreTitle = `Tidy toys ${tag}`;
			await page.request.post('/api/chores', {
				data: {
					title: choreTitle,
					icon: '🧸',
					stars: 1,
					timeOfDay: 'evening',
					memberIds: [kid.id],
					schedule: { type: 'daily' },
					requiresApproval: true
				}
			});
			const routine = await page.request.post('/api/routines', {
				data: {
					memberId: kid.id,
					name: `Bath time ${tag}`,
					windowStart: '18:30',
					windowEnd: '19:15',
					steps: [{ label: 'Wash up', icon: 'toothbrush' }]
				}
			});
			routineId = ((await routine.json()) as { id: string }).id;
			await page.request.put('/api/meals', {
				data: { date: today, meal: 'dinner', title: `Tacos ${tag}` }
			});
			await startSession(page.request, {
				endAt: Date.now() + 3 * HOUR,
				sitterName: 'Sam Sitter',
				funAllowed: true
			});

			const sitterCtx = await sitterWall(page);
			const wall = await sitterCtx.newPage();
			await wall.clock.install({ time: Date.now() });
			// The check-in endpoint belongs to hub-7pj.3: stub its contract here.
			let checkinStatus = 200;
			const checkins: unknown[] = [];
			await wall.route('**/api/sitter/checkin', (route) => {
				checkins.push(route.request().postDataJSON());
				return route.fulfill({
					status: checkinStatus,
					json: checkinStatus === 200 ? { ok: true, at: Date.now() } : { message: 'No session' }
				});
			});
			await gotoHydrated(wall, '/');

			await test.step("J19.9 the home shows tonight's plan from real data", async () => {
				await expect(wall.getByTestId('sitter-title')).toHaveText('Tonight with Sam Sitter');
				await expect(wall.getByTestId('sitter-back')).toContainText('back around');
				await expect(wall.getByTestId('emergency-open')).toBeVisible();
				const items = wall.getByTestId('plan-item');
				await expect(items.filter({ hasText: `Dinner: Tacos ${tag}` })).toHaveCount(1);
				await expect(items.filter({ hasText: `Bath time ${tag}` })).toHaveCount(1);
				await expect(items.filter({ hasText: `${kidName}'s bedtime` })).toHaveCount(1);
				await expect(items.last()).toContainText('home');
				await expect(wall.getByTestId('plan-now')).toHaveCount(1);
				await expect(
					items.filter({ hasText: `${kidName}'s bedtime` }).getByTestId('plan-when')
				).toHaveText(/^(in .+|.+ ago|now)$/);
				await expect(wall.getByTestId('sitter-rules')).toContainText('Lights out at bedtime');
			});

			await test.step('J19.9 a routine starts from the plan', async () => {
				await wall
					.getByTestId('plan-item')
					.filter({ hasText: `Bath time ${tag}` })
					.getByTestId('plan-start')
					.click();
				await expect(wall.getByTestId('routine-player')).toBeVisible();
				await wall.getByTestId('routine-close').click();
			});

			await test.step('J19.10 To-Dos tick off and check-ins tell the parents', async () => {
				const row = wall.getByTestId('chore-card').filter({ hasText: choreTitle });
				await row.getByTestId('did-it').click();
				await expect(row).toHaveAttribute('data-status', 'pending');
				await wall.getByTestId('checkin-all-good').click();
				await expect(wall.getByTestId('checkin-all-good')).toContainText('Sent');
				expect(checkins).toEqual([{ kind: 'all-good' }]);
				// A refusal rolls the button back and says so.
				checkinStatus = 409;
				await wall.getByTestId('checkin-call-me').click();
				await expect(wall.getByTestId('checkin-failed')).toBeVisible();
				await expect(wall.getByTestId('checkin-call-me')).toHaveText('Call me');
				expect(checkins).toHaveLength(2);
			});

			await test.step('J19.9 the session ends by the clock and the normal home returns', async () => {
				await wall.clock.fastForward(4 * HOUR);
				await expect(wall.getByTestId('sitter-home')).toHaveCount(0);
				await expect(wall.getByTestId('emergency-open')).toHaveCount(0);
			});

			await sitterCtx.close();
		} finally {
			const cur = (await (await page.request.get('/api/sitter/current')).json()) as {
				session: { id: string } | null;
			};
			if (cur.session) await endSession(page.request, cur.session.id);
			if (routineId) await page.request.delete(`/api/routines/${routineId}`);
			release();
		}
	}
);
