import { expect, test, type Page } from '@playwright/test';
import { signInAsAdult } from './adult';
import { seedCalendar } from './calendar';
import { asWallDisplay } from './display';
import { expectTappable } from './tap';

// CAL-9: adults add events to a connected iCloud calendar. The provider is mocked at the API
// layer (no Apple account in CI): the source list and the create call are intercepted.

const CAL = 'https://caldav.example.test/1/calendars/home/';

async function mockApple(page: Page) {
	await page.route('**/api/calendar/sources', (route) =>
		route.request().method() === 'GET'
			? route.fulfill({
					json: [
						{
							id: 'e2e-icloud',
							provider: 'icloud',
							label: 'Apple',
							calendars: [{ externalId: CAL, name: 'Home', memberId: null, selected: true }]
						}
					]
				})
			: route.continue()
	);
}

const tapKeys = async (page: Page, text: string) => {
	for (const ch of text) await page.getByTestId(`key-${ch}`).click();
};

test.beforeEach(async ({ page }, info) => {
	seedCalendar();
	await signInAsAdult(page, `e2e-cal-create-${info.project.name}`);
	await mockApple(page);
});

test('the wall adds an event: shown as pending, then confirmed @J5.4', async ({
	page,
	context
}) => {
	await asWallDisplay(context);
	let body: Record<string, unknown> = {};
	let release: () => void = () => {};
	const gate = new Promise<void>((r) => (release = r));
	await page.route('**/api/calendar/events', async (route) => {
		if (route.request().method() !== 'POST') return route.continue();
		body = route.request().postDataJSON();
		await gate;
		await route.fulfill({ status: 201, json: { uid: 'x@hub' } });
	});
	await page.goto('/calendar');
	const add = page.getByTestId('add-event');
	await expectTappable(add);
	await add.click();
	const sheet = page.getByTestId('add-event-sheet');
	await sheet.getByTestId('ev-title').click();
	await tapKeys(page, 'piano');
	await page.getByTestId('key-enter').click();
	await expect(sheet.getByTestId('ev-title')).toContainText('Piano');
	await sheet.getByRole('button', { name: 'Starts +1 hr' }).click();
	await expectTappable(sheet.getByTestId('ev-save'));
	await sheet.getByTestId('ev-save').click();
	await expect(sheet).toBeHidden();

	const ghost = page.locator('[data-pending="true"]').filter({ hasText: 'Piano' });
	await expect(ghost).toBeVisible();
	expect(body).toMatchObject({ calendarId: CAL, title: 'Piano', allDay: false });
	release();
	await expect(ghost).toBeHidden();
	await expect(page.getByTestId('add-event-error')).toBeHidden();
});

test('a phone types into the form; a refusal rolls the pending event back with a message @J5.4', async ({
	page
}) => {
	await page.route('**/api/calendar/events', (route) =>
		route.request().method() === 'POST'
			? route.fulfill({
					status: 401,
					json: { message: 'Apple rejected the app-specific password.' }
				})
			: route.continue()
	);
	await page.goto('/calendar');
	await page.getByTestId('add-event').click();
	const sheet = page.getByTestId('add-event-sheet');
	await sheet.getByTestId('ev-title').fill('Dentist follow-up');
	await sheet.getByTestId('ev-location').fill('Clinic');
	await sheet.getByLabel('All day').check();
	await sheet.getByTestId('ev-save').click();
	const error = page.getByTestId('add-event-error');
	await expect(error).toContainText('Dentist follow-up');
	await expect(error).toContainText('Apple rejected');
	await expect(page.locator('[data-pending="true"]')).toHaveCount(0);
});
