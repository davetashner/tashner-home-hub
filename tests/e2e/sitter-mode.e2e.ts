import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { signInAsAdult } from './adult';
import { trackMember } from './cleanup';
import { gotoHydrated } from './hydrated';
import { holdSitter } from './sitter-lock';

const local = (ms: number) => {
	const d = new Date(ms);
	const p = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

async function journey(page: Page, info: TestInfo, tag: string) {
	const release = await holdSitter();
	try {
		await signInAsAdult(page, `adult-sitter-${tag}`);
		const kidName = `Kid A ${Date.now() % 1e9}`;
		const kid = (await (
			await page.request.post('/api/members', {
				data: { name: kidName, role: 'child', color: 'member-4', avatar: '🦊' }
			})
		).json()) as { id: string };
		trackMember(kid.id);
		const row = page.getByTestId('sitter-session-row').filter({ hasText: `Sam Sitter ${tag}` });
		await gotoHydrated(page, '/settings/sitter-mode');

		await test.step('J19.1 edit and save the info card', async () => {
			await page.getByTestId('sitter-add-contact').click();
			const contact = page.getByTestId('sitter-contact').last();
			await contact.getByLabel('Contact name').fill('Grandma Test');
			await contact.getByLabel('Relation').fill('Grandmother');
			await contact.getByLabel('Phone').fill('555-0101');
			await page.getByTestId('sitter-address').fill('1 Test Lane');
			await page.getByLabel(`Bedtime for ${kidName}`).fill('19:30');
			await page.getByLabel(`Allergies for ${kidName}`).fill('Peanuts');
			await page.getByLabel(`Medical notes for ${kidName}`).fill('Inhaler in the blue bag');
			await page.getByTestId('sitter-rules').fill('No screens after 7\nLights out at bedtime');
			await page.getByTestId('sitter-wifi').fill('TestNet');
			await page.getByTestId('sitter-wifipw').fill('not-a-real-password');
			await page.getByTestId('sitter-tonight').fill(`Pizza in the freezer ${tag}`);
			// The card is shared across projects: start from no pets.
			while ((await page.getByTestId('sitter-pet').count()) > 0)
				await page.getByRole('button', { name: 'Remove pet' }).first().click();
			await page.getByTestId('sitter-add-pet').click();
			const pet = page.getByTestId('sitter-pet').last();
			await pet.getByLabel('Pet name').fill('Rex');
			await pet.getByLabel('Pet kind').fill('Dog');
			await pet.getByLabel('Feeding times for pet').fill('18:00, 07:30');
			await pet.getByLabel('Pet notes').fill('Pill in cheese');
			await page.getByLabel('Regular vet name').fill('Test Vet');
			await page.getByLabel('Regular vet phone').fill('555-0102');
			await page.getByLabel('After-hours pet emergency hospital name').fill('Test Pet ER');
			await page.getByLabel('After-hours pet emergency hospital phone').fill('555-0103');
			await page.getByTestId('sitter-save').click();
			await expect(page.getByRole('status')).toHaveText('Saved');

			await gotoHydrated(page, '/settings/sitter-mode');
			await expect(page.getByTestId('sitter-address')).toHaveValue('1 Test Lane');
			await expect(page.getByLabel(`Medical notes for ${kidName}`)).toHaveValue(
				'Inhaler in the blue bag'
			);
			await expect(page.getByTestId('sitter-tonight')).toHaveValue(`Pizza in the freezer ${tag}`);
			await expect(page.getByLabel('Pet name')).toHaveValue('Rex');
			await expect(page.getByLabel('Feeding times for pet')).toHaveValue('18:00, 07:30');
			await expect(page.getByLabel('Pet notes')).toHaveValue('Pill in cheese');
			await expect(page.getByLabel('Regular vet phone')).toHaveValue('555-0102');
			await expect(page.getByLabel('After-hours pet emergency hospital name')).toHaveValue(
				'Test Pet ER'
			);
			await expect(page.getByTestId('sitter-rules')).toHaveValue(
				'No screens after 7\nLights out at bedtime'
			);
		});

		await test.step('J19.2 start a session with a sitter name and PIN', async () => {
			await page.getByTestId('sitter-name').fill(`Sam Sitter ${tag}`);
			await page.getByTestId('sitter-pin').fill('4812');
			await page.getByTestId('sitter-endat').fill(local(Date.now() + 2 * 3_600_000));
			await page.getByTestId('sitter-start-btn').click();
			await expect(row.getByTestId('sitter-status')).toContainText('Active');
			const cur = await (await page.request.get('/api/sitter/current')).json();
			expect(cur.session).toMatchObject({ status: 'active', hasPin: true });
			expect(cur.card).toBeNull();
		});

		await test.step('J19.4 the wall sees the card only with the sitter PIN', async () => {
			const anon = await page
				.context()
				.browser()!
				.newContext({ baseURL: info.project.use.baseURL });
			expect((await anon.request.get('/api/sitter/card')).status()).toBe(401);
			expect(
				(await anon.request.post('/api/sitter/check', { data: { pin: '0000' } })).status()
			).toBe(401);
			const ok = await anon.request.post('/api/sitter/check', { data: { pin: '4812' } });
			expect(ok.status()).toBe(200);
			const body = await ok.json();
			expect(body.card).toMatchObject({ address: '1 Test Lane', wifiName: 'TestNet' });
			expect(body.card.contacts[0]).toMatchObject({ phone: '555-0101' });
			await anon.close();
		});

		await test.step('J19.3 extend, then end the session early', async () => {
			const before = (await (await page.request.get('/api/sitter/current')).json()).session.endAt;
			await row.getByTestId('sitter-extend').click();
			await expect
				.poll(
					async () => (await (await page.request.get('/api/sitter/current')).json()).session.endAt
				)
				.toBe(before + 3_600_000);
			await row.getByTestId('sitter-end').click();
			await expect(row).toHaveCount(0);
			const cur = await (await page.request.get('/api/sitter/current')).json();
			expect(cur.session).toBeNull();
			const anon = await page
				.context()
				.browser()!
				.newContext({ baseURL: info.project.use.baseURL });
			expect(
				(await anon.request.post('/api/sitter/check', { data: { pin: '4812' } })).status()
			).toBe(401);
			await anon.close();
		});
	} finally {
		release();
	}
}

test('adults edit the info card and run a sitter session', async ({ page }, info) => {
	test.setTimeout(120_000);
	await journey(page, info, info.project.name.replace(/\W/g, ''));
});

test.describe('on a phone', () => {
	test.use({ viewport: { width: 390, height: 844 } });
	test('adults edit the info card and run a sitter session', async ({ page }, info) => {
		test.setTimeout(120_000);
		await journey(page, info, `phone-${info.project.name.replace(/\W/g, '')}`);
		await expect(page.locator('body')).toBeVisible();
		expect(
			await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
		).toBe(true);
	});
});
