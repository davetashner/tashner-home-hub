import { expect, test, type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { ensureHousehold } from './adult';
import { gotoHydrated } from './hydrated';
import { expectTappable } from './tap';
import { trackMember } from './cleanup';
import { DB_PATH } from './data-dir';

// @J18.20 (hub-t27j.15): each kid's art book, by month, with a Then and now compare. Both orientations.

const PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
	'base64'
);
const KID = 'artbook-kid';
const SIB = 'artbook-sib';
const EMPTY = 'artbook-empty';
const NAMES: Record<string, string> = {
	[KID]: 'Zed Bookworm',
	[SIB]: 'Zee Sibling',
	[EMPTY]: 'Zip Blank'
};

function seed() {
	ensureHousehold();
	for (const id of [KID, SIB, EMPTY]) trackMember(id); // sweeps the previous test's rows first
	const db = new Database(DB_PATH);
	db.pragma('busy_timeout = 5000');
	for (const id of [KID, SIB, EMPTY]) {
		db.prepare(
			"INSERT OR REPLACE INTO members (id, name, role, color, avatar) VALUES (?, ?, 'child', 'member-3', '🦊')"
		).run(id, NAMES[id]);
	}
	db.prepare('DELETE FROM notes WHERE author_id IN (?, ?, ?)').run(KID, SIB, EMPTY);
	const add = db.prepare(
		"INSERT INTO notes (id, author_id, body, color, pinned, created_at, image) VALUES (?, ?, '', 'note-yellow', 0, ?, ?)"
	);
	const t = (iso: string) => Date.parse(iso);
	add.run('ab-jan', KID, t('2026-01-15T12:00:00Z'), PNG);
	add.run('ab-mar1', KID, t('2026-03-10T12:00:00Z'), PNG);
	add.run('ab-mar2', KID, t('2026-03-20T12:00:00Z'), PNG);
	add.run('ab-sib', SIB, t('2026-02-10T12:00:00Z'), PNG);
	db.close();
}

test.beforeEach(seed);

async function openArtBook(page: Page, kid: string) {
	await gotoHydrated(page, '/');
	await page.getByTestId('note-draw').click();
	await expect(page.getByTestId('draw-sheet')).toBeVisible();
	await page.getByTestId('draw-browse').click();
	const open = page.getByTestId('draw-art-book');
	await expectTappable(open, 96);
	await open.click();
	await page.getByTestId('art-person').filter({ hasText: NAMES[kid] }).click();
}

test('the art book shows one kid’s drawings by month and compares then and now @J18.26', async ({
	page
}) => {
	await openArtBook(page, KID);
	await expect(page.getByTestId('art-title')).toContainText('Zed');
	const months = page.getByTestId('art-month');
	await expect(months).toHaveCount(2);
	await expect(months.nth(0)).toHaveAttribute('aria-label', 'March 2026');
	await expect(months.nth(1)).toHaveAttribute('aria-label', 'January 2026');
	await expect(months.nth(0).getByTestId('art-drawing')).toHaveCount(2);
	// Newest first inside a month, and nothing from a sibling.
	await expect(months.nth(0).getByTestId('art-drawing').first()).toHaveAttribute('src', /ab-mar2/);
	await expect(page.getByTestId('art-drawing')).toHaveCount(3);
	await expect(page.locator('[data-testid="art-drawing"][src*="ab-sib"]')).toHaveCount(0);

	const compare = page.getByTestId('art-compare-open');
	await expectTappable(compare, 96);
	await compare.click();
	await expect(page.getByTestId('art-Then-label')).toHaveText('January 2026');
	await expect(page.getByTestId('art-Now-label')).toHaveText('March 2026');
	await expect(page.getByTestId('art-side-Then').getByTestId('art-shot')).toHaveAttribute(
		'src',
		/ab-jan/
	);
	await expect(page.getByTestId('art-side-Now').getByTestId('art-shot')).toHaveAttribute(
		'src',
		/ab-mar2/
	);
	for (const id of ['art-Then-older', 'art-Then-newer', 'art-Now-older', 'art-Now-newer'])
		await expectTappable(page.getByTestId(id), 96);

	// Any two months: move the Then side up to March, which shows that month's first drawing.
	await page.getByTestId('art-Then-newer').click();
	await expect(page.getByTestId('art-Then-label')).toHaveText('March 2026');
	await expect(page.getByTestId('art-side-Then').getByTestId('art-shot')).toHaveAttribute(
		'src',
		/ab-mar1/
	);

	// Fits on the 4K touch monitor at scale 1.
	const wall = page.viewportSize();
	await page.setViewportSize({ width: 3840, height: 2160 });
	const sheet = await page.getByTestId('draw-sheet').boundingBox();
	for (const id of ['art-Then-older', 'art-Now-newer', 'art-back']) {
		const b = (await page.getByTestId(id).boundingBox())!;
		expect(b.x, id).toBeGreaterThanOrEqual(sheet!.x);
		expect(b.x + b.width, id).toBeLessThanOrEqual(sheet!.x + sheet!.width);
		expect(b.y + b.height, id).toBeLessThanOrEqual(2160);
	}
	if (wall) await page.setViewportSize(wall);

	// Back steps out of compare, then to the people, then to My drawings.
	await page.getByTestId('art-back').click();
	await expect(page.getByTestId('art-month')).toHaveCount(2);
	await page.getByTestId('art-back').click();
	await expect(page.getByTestId('art-people')).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(page.getByTestId('draw-art-book')).toBeVisible();
});

test('another kid’s book holds only their own drawings', async ({ page }) => {
	await openArtBook(page, SIB);
	await expect(page.getByTestId('art-drawing')).toHaveCount(1);
	await expect(page.getByTestId('art-drawing')).toHaveAttribute('src', /ab-sib/);
	// One drawing: nothing to compare yet.
	await expect(page.getByTestId('art-compare-open')).toHaveCount(0);
});

test('a kid with no drawings gets a friendly empty book', async ({ page }) => {
	await openArtBook(page, EMPTY);
	await expect(page.getByTestId('art-empty')).toContainText('No drawings in this book yet');
	await expect(page.getByTestId('art-month')).toHaveCount(0);
	await expectTappable(page.getByTestId('art-back'), 96);
});
