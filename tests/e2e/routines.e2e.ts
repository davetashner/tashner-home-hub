import { expect, test } from '@playwright/test';
import { seedKid, stubAudio } from './kid';
import { gotoHydrated } from './hydrated';
import { expectTappable } from './tap';

test('the kid steps through a routine, a reload resumes, and it celebrates at the end', async ({
	page
}, info) => {
	const seed = await seedKid(page, `routine-${info.project.name}`);
	const notes = await stubAudio(page);
	const made = await page.request.post('/api/routines', {
		data: {
			memberId: seed.memberId,
			name: 'Morning',
			steps: [
				{ label: 'Brush teeth', icon: 'toothbrush' },
				{ label: 'Get dressed', icon: 'shirt' },
				{ label: 'Shoes on', icon: 'shoes' }
			]
		}
	});
	expect(made.status()).toBe(201);
	await page.context().clearCookies(); // the kid screen needs no adult session

	const open = async () => {
		await page.goto(`/chores?member=${seed.memberId}`);
		await expect(async () => {
			await page.getByTestId('routine-button').filter({ hasText: 'Morning' }).click();
			await expect(page.getByTestId('routine-player')).toBeVisible();
		}).toPass();
	};
	await open();
	await expect(page.getByTestId('routine-step')).toContainText('Brush teeth');
	await expectTappable(page.getByTestId('routine-done'), 96);

	const saved = page.waitForResponse(
		(r) => r.url().includes('/progress') && r.request().method() === 'POST'
	);
	await page.getByTestId('routine-done').click();
	expect((await saved).status()).toBe(200);
	await expect(page.getByTestId('routine-step')).toContainText('Get dressed');
	await expect(page.getByTestId('routine-progress').locator('[data-state="done"]')).toHaveCount(1);

	// Reload mid-routine: today's progress is kept.
	await open();
	await expect(page.getByTestId('routine-step')).toContainText('Get dressed');

	await page.getByTestId('routine-done').click();
	await expect(page.getByTestId('routine-step')).toContainText('Shoes on');
	await page.getByTestId('routine-done').click();
	await expect(page.getByTestId('routine-complete')).toBeVisible();
	await expect.poll(notes).toBeGreaterThan(0);

	// Finished for today: the button is gone.
	await page.getByTestId('routine-close').click();
	await expect(page.getByTestId('routine-player')).toHaveCount(0);
	await expect(page.getByTestId('routine-button')).toHaveCount(0);
});

// On tablet and short layouts the routine buttons sit at the bottom of the chore column, so the
// kid scrolls to them; the player must still fit the screen with its controls in reach.
const smallScreens = [
	{ name: 'iPad portrait', width: 834, height: 1194 },
	{ name: 'iPad landscape', width: 1194, height: 834 },
	{ name: 'iPhone landscape', width: 852, height: 393 }
];

test('a kid scrolls to and opens a routine at tablet and phone-landscape sizes', async ({
	page
}, info) => {
	const seed = await seedKid(page, `routine-sizes-${info.project.name}`);
	const name = `Wind down ${Date.now() % 1e9}`;
	const made = await page.request.post('/api/routines', {
		data: {
			memberId: seed.memberId,
			name,
			steps: [
				{ label: 'Pajamas on', icon: 'shirt' },
				{ label: 'Brush teeth', icon: 'toothbrush' }
			]
		}
	});
	expect(made.status()).toBe(201);
	await page.context().clearCookies();

	for (const screen of smallScreens) {
		await test.step(screen.name, async () => {
			await page.setViewportSize({ width: screen.width, height: screen.height });
			await page.goto(`/chores?member=${seed.memberId}`);
			await expect(page.getByTestId('star-jar')).toBeVisible();

			const button = page.getByTestId('routine-button').filter({ hasText: name });
			await button.scrollIntoViewIfNeeded();
			await expect(button).toBeInViewport();
			await expectTappable(button, 96);
			await expect(async () => {
				await button.click();
				await expect(page.getByTestId('routine-player')).toBeVisible();
			}).toPass();

			const player = page.getByTestId('routine-player');
			await expect(page.getByTestId('routine-step')).toContainText('Pajamas on');
			await expect
				.poll(async () => {
					const box = await player.boundingBox();
					if (!box) return false;
					return (
						box.x >= 0 &&
						box.y >= 0 &&
						box.x + box.width <= screen.width + 0.5 &&
						box.y + box.height <= screen.height + 0.5
					);
				})
				.toBe(true);
			// The player itself does not scroll: everything is reachable in place.
			expect(await player.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
			for (const id of ['routine-done', 'routine-close']) {
				const control = page.getByTestId(id);
				await expect(control).toBeInViewport({ ratio: 1 });
				await expectTappable(control, 96);
			}
			await page.getByTestId('routine-close').click();
			await expect(player).toHaveCount(0);
		});
	}
});

test('the routine complete screen fits without scrolling at tablet and phone-landscape sizes', async ({
	page
}, info) => {
	const seed = await seedKid(page, `routine-done-${info.project.name}`);
	await stubAudio(page);

	// A finished routine disappears for the day, so each size gets its own.
	const names = new Map<number, string>();
	for (const screen of smallScreens) {
		const name = `Finish ${screen.width}x${screen.height} ${Date.now() % 1e9}`;
		names.set(screen.height, name);
		const made = await page.request.post('/api/routines', {
			data: { memberId: seed.memberId, name, steps: [{ label: 'Pajamas on', icon: 'shirt' }] }
		});
		expect(made.status()).toBe(201);
	}
	await page.context().clearCookies();

	for (const screen of smallScreens) {
		await test.step(screen.name, async () => {
			const name = names.get(screen.height)!;
			await page.setViewportSize({ width: screen.width, height: screen.height });
			await gotoHydrated(page, `/chores?member=${seed.memberId}`);
			const button = page.getByTestId('routine-button').filter({ hasText: name });
			await button.scrollIntoViewIfNeeded();
			await button.click();
			await expect(page.getByTestId('routine-step')).toContainText('Pajamas on');
			await page.getByTestId('routine-done').click();

			const player = page.getByTestId('routine-player');
			await expect(page.getByTestId('routine-complete')).toBeVisible();
			expect(await player.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
			await expect(page.getByTestId('routine-complete')).toBeInViewport({ ratio: 1 });
			const close = page.getByTestId('routine-close');
			await expect(close).toBeInViewport({ ratio: 1 });
			await expectTappable(close, 96);
			await close.click();
			await expect(player).toHaveCount(0);
		});
	}
});
