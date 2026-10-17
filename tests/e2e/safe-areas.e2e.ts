import { expect, test, type Page } from '@playwright/test';
import { px } from './tap';
import { ensureHousehold, signInAsAdult } from './adult';

// DEV-3: nothing tappable or readable sits under an iPhone notch, Dynamic Island or home indicator.
test.beforeAll(ensureHousehold);

type Edge = 'top' | 'right' | 'bottom' | 'left';
type Insets = Record<Edge, number>;

/** iPhone 15-style insets: Dynamic Island + home indicator, which swap sides when rotated. */
// Landscape swaps the side rail for a one-row top bar (hub-0hv.8), so all four edges are checked.
const phones: {
	name: string;
	width: number;
	height: number;
	insets: Insets;
	edges: Edge[];
}[] = [
	{
		name: 'portrait',
		width: 393,
		height: 852,
		insets: { top: 59, right: 0, bottom: 34, left: 0 },
		edges: ['top', 'right', 'bottom', 'left']
	},
	{
		name: 'landscape',
		width: 852,
		height: 393,
		insets: { top: 0, right: 59, bottom: 21, left: 59 },
		edges: ['top', 'right', 'bottom', 'left']
	}
];

async function emulateInsets(page: Page, insets: Insets) {
	const cdp = await page.context().newCDPSession(page);
	await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets });
}

/** Every visible control and heading lies inside the safe rectangle. */
async function expectInsideSafeArea(
	page: Page,
	{ width, height, insets, edges }: (typeof phones)[0]
) {
	const boxes = await page
		.locator('header a, header button, nav a, main h1, [role="dialog"] button, form button')
		.evaluateAll((els) =>
			els
				// Inside the shell's scrolling page area only the title counts: the rest scrolls into view.
				.filter((el) => el.checkVisibility() && !el.closest('.sr-only'))
				.filter((el) => el.tagName === 'H1' || !el.closest('main[tabindex]'))
				.map((el) => {
					const r = el.getBoundingClientRect();
					const label = el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 30);
					return { label, top: r.top, right: r.right, bottom: r.bottom, left: r.left };
				})
		);
	expect(boxes.length).toBeGreaterThan(0);
	for (const b of boxes) {
		const limits = {
			top: () => expect(px(b.top), `${b.label} top`).toBeGreaterThanOrEqual(insets.top),
			left: () => expect(px(b.left), `${b.label} left`).toBeGreaterThanOrEqual(insets.left),
			right: () =>
				expect(px(b.right), `${b.label} right`).toBeLessThanOrEqual(width - insets.right),
			bottom: () =>
				expect(px(b.bottom), `${b.label} bottom`).toBeLessThanOrEqual(height - insets.bottom)
		};
		for (const edge of edges) limits[edge]();
	}
}

for (const phone of phones) {
	test.describe(`iPhone ${phone.name}`, () => {
		test.beforeEach(async ({ page }) => {
			await page.setViewportSize({ width: phone.width, height: phone.height });
			await emulateInsets(page, phone.insets);
		});

		for (const route of ['/', '/chores', '/calendar']) {
			test(`shell on ${route} clears the insets`, async ({ page }) => {
				await page.goto(route);
				await page.waitForLoadState('networkidle');
				await expectInsideSafeArea(page, phone);
			});
		}

		test('the header and nav pad past the insets', async ({ page }) => {
			await page.goto('/chores');
			await page.waitForLoadState('networkidle');
			const pad = (selector: string, side: 'Right' | 'Bottom' | 'Left') =>
				page
					.locator(selector)
					.first()
					.evaluate((el, s) => parseFloat(getComputedStyle(el)[`padding${s}`]), side);
			expect(await pad('header', 'Right')).toBeGreaterThan(phone.insets.right);
			// Landscape: the nav is a top bar, so the notch side matters and the home indicator is the page's.
			const landscape = phone.width > phone.height;
			expect(await pad('nav[aria-label="Main"]', landscape ? 'Left' : 'Bottom')).toBeGreaterThan(
				landscape ? phone.insets.left : phone.insets.bottom
			);
		});

		test('settings clear the insets for an adult', async ({ page }, info) => {
			await signInAsAdult(page, `e2e-safe-${phone.name}-${info.project.name}`);
			await page.goto('/settings');
			await page.waitForLoadState('networkidle');
			await expectInsideSafeArea(page, phone);
		});

		test('the unlock page clears the insets', async ({ page }) => {
			await page.goto('/unlock');
			await page.waitForLoadState('networkidle');
			await expectInsideSafeArea(page, phone);
		});
	});
}

test('the wall has no insets, so the header padding is even', async ({ page }) => {
	await page.goto('/chores');
	await page.waitForLoadState('networkidle');
	const { top, bottom } = await page
		.locator('header')
		.first()
		.evaluate((el) => {
			const style = getComputedStyle(el);
			return { top: style.paddingTop, bottom: style.paddingBottom };
		});
	expect(top).toBe(bottom);
});
