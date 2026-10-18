import { expect, test, type Page } from '@playwright/test';
import { signInAsAdult } from './adult';
import { seedCalendar } from './calendar';
import { expectTappable } from './tap';

// CAL-9/CAL-10: adults edit and delete non-recurring iCloud events from the details sheet.
// Apple is not reachable in CI, so the source list and the events API are mocked and stateful.

test.use({ serviceWorkers: 'block' });

const CAL = 'https://caldav.example.test/1/calendars/home/';
const at = (hour: number) => {
	const d = new Date();
	return new Date(d.getFullYear(), d.getMonth(), d.getDate(), hour).getTime();
};

interface Ev {
	id: string;
	sourceId: string;
	title: string;
	startsAt: number;
	endsAt: number;
	allDay: boolean;
	recurrence: string | null;
	location: string | null;
	notes: string | null;
	members: [];
}
const ev = (id: string, title: string, hour: number, recurrence: string | null = null): Ev => ({
	id,
	sourceId: 'e2e-icloud',
	title,
	startsAt: at(hour),
	endsAt: at(hour + 1),
	allDay: false,
	recurrence,
	location: null,
	notes: null,
	members: []
});

async function mockApple(page: Page, stored: Ev[]) {
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
	await page.route('**/api/calendar/events?*', (route) => route.fulfill({ json: stored }));
}

test.beforeEach(async ({ page }, info) => {
	seedCalendar();
	await signInAsAdult(page, `e2e-cal-edit-${info.project.name}`);
});

test('edit the title and time: the change shows at once and is saved', async ({ page }) => {
	const stored = [ev('ev-1', 'Orchestra rehearsal', 15)];
	await mockApple(page, stored);
	let body: Record<string, unknown> = {};
	let release: () => void = () => {};
	const gate = new Promise<void>((r) => (release = r));
	await page.route('**/api/calendar/events/ev-1', async (route) => {
		body = route.request().postDataJSON();
		await gate;
		stored[0] = { ...stored[0]!, title: 'Band rehearsal', startsAt: at(16), endsAt: at(17) };
		await route.fulfill({ json: { ok: true } });
	});
	await page.goto('/calendar');
	await page.getByText('Orchestra rehearsal').first().click();
	const edit = page.getByTestId('edit-event');
	await expectTappable(edit);
	await expectTappable(page.getByTestId('delete-event'));
	await edit.click();
	const sheet = page.getByTestId('add-event-sheet');
	await expect(sheet.getByTestId('ev-title')).toHaveValue('Orchestra rehearsal');
	await sheet.getByTestId('ev-title').fill('Band rehearsal');
	await sheet.getByRole('button', { name: 'Starts +1 hr' }).click();
	await sheet.getByTestId('ev-save').click();
	await expect(sheet).toBeHidden();

	const ghost = page.locator('[data-pending="true"]').filter({ hasText: 'Band rehearsal' });
	await expect(ghost).toBeVisible();
	await expect(page.getByText('Orchestra rehearsal')).toHaveCount(0);
	expect(body).toMatchObject({ title: 'Band rehearsal', allDay: false });
	release();
	await expect(ghost).toBeHidden();
	await expect(page.getByText('Band rehearsal').first()).toBeVisible();
	await expect(page.getByTestId('add-event-error')).toBeHidden();
});

test('a conflict rolls the edit back and says the event changed', async ({ page }) => {
	await mockApple(page, [ev('ev-1', 'Orchestra rehearsal', 15)]);
	await page.route('**/api/calendar/events/ev-1', (route) =>
		route.fulfill({
			status: 409,
			json: { message: 'This event changed on another device — check it and try again.' }
		})
	);
	await page.goto('/calendar');
	await page.getByText('Orchestra rehearsal').first().click();
	await page.getByTestId('edit-event').click();
	await page.getByTestId('add-event-sheet').getByTestId('ev-title').fill('Other name');
	await page.getByTestId('ev-save').click();
	await expect(page.getByTestId('add-event-error')).toContainText('changed on another device');
	await expect(page.getByText('Orchestra rehearsal').first()).toBeVisible();
	await expect(page.getByText('Other name')).toHaveCount(0);
});

test('delete asks first, then hides the event at once', async ({ page }) => {
	const stored = [ev('ev-1', 'Orchestra rehearsal', 15), ev('ev-2', 'Dentist', 11)];
	await mockApple(page, stored);
	let release: () => void = () => {};
	const gate = new Promise<void>((r) => (release = r));
	let deleted = false;
	await page.route('**/api/calendar/events/ev-1', async (route) => {
		deleted = route.request().method() === 'DELETE';
		await gate;
		stored.splice(0, 1);
		await route.fulfill({ json: { ok: true } });
	});
	await page.goto('/calendar');
	await page.getByText('Orchestra rehearsal').first().click();
	await page.getByTestId('delete-event').click();
	await expectTappable(page.getByTestId('delete-confirm'));
	await page.getByTestId('delete-confirm').click();
	await expect(page.getByText('Orchestra rehearsal')).toHaveCount(0);
	await expect(page.getByText('Dentist').first()).toBeVisible();
	release();
	await expect.poll(() => deleted).toBe(true);
	await expect(page.getByText('Orchestra rehearsal')).toHaveCount(0);
	await expect(page.getByTestId('add-event-error')).toBeHidden();
});

test('a repeating event says to edit it on the phone', async ({ page }) => {
	await mockApple(page, [ev('ev-3', 'Swim lessons', 15, 'FREQ=WEEKLY')]);
	await page.goto('/calendar');
	await page.getByText('Swim lessons').first().click();
	await expect(page.getByTestId('edit-on-phone')).toHaveText('Edit this on your phone');
	await expect(page.getByTestId('edit-event')).toHaveCount(0);
	await expect(page.getByTestId('delete-event')).toHaveCount(0);
});
