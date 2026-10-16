import { expect, type Locator } from '@playwright/test';

/** Rounds to 1/100 px: layout can report 59.99997 for an exact 60px box. */
export const px = (n: number) => Math.round(n * 100) / 100;

/** Asserts a control meets the minimum tap size (60px; 96px on kid screens). */
export async function expectTappable(locator: Locator, min = 60): Promise<void> {
	const box = await locator.boundingBox();
	expect(box, 'control should be visible').not.toBeNull();
	expect(px(box!.width)).toBeGreaterThanOrEqual(min);
	expect(px(box!.height)).toBeGreaterThanOrEqual(min);
}
