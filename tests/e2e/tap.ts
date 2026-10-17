import { expect, type Locator } from '@playwright/test';

/** Rounds to 1/100 px: layout can report 59.99997 for an exact 60px box. */
export const px = (n: number) => Math.round(n * 100) / 100;

/**
 * Asserts a control meets the minimum tap size (60px; 96px on kid screens). The size is polled:
 * right after a navigation, a loaded runner can measure a control before its styles and layout
 * settle (23px wide once), and a control that really is too small still fails when the poll ends.
 */
export async function expectTappable(locator: Locator, min = 60): Promise<void> {
	await expect
		.poll(
			async () => {
				const box = await locator.boundingBox();
				return box === null ? 0 : Math.min(px(box.width), px(box.height));
			},
			{ message: `control should be visible and at least ${min}px in both directions` }
		)
		.toBeGreaterThanOrEqual(min);
}
