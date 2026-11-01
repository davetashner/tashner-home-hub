import type { Page } from '@playwright/test';

/** The drawing board's rail sections (hub-cn7.37.4) and which one holds each old More-group control. */
const SECTION_OF: Record<string, 'paper' | 'magic' | 'together'> = {
	'draw-pages-open': 'paper',
	'draw-photo-open': 'paper',
	'draw-bg-open': 'paper',
	'draw-layers-open': 'paper',
	'draw-clear': 'paper',
	'draw-mirror': 'magic',
	'draw-flipbook': 'magic',
	'draw-share': 'together',
	'draw-live-status': 'together',
	'draw-live-leave': 'together'
};

/** Make sure the section holding `testid` is open; does nothing when it already is. */
export async function reveal(page: Page, testid: keyof typeof SECTION_OF): Promise<void> {
	const rail = page.getByTestId(`draw-rail-${SECTION_OF[testid]}`).getByRole('button');
	if ((await rail.getAttribute('aria-pressed')) !== 'true') await rail.click();
}
