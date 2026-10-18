// Stands in for '@playwright/test' while recording (tsconfig.json maps it here), so the e2e specs
// run unchanged. It re-exports Playwright and adds an automatic fixture to `test`: each test's
// pages get the overlay (overlay.mjs) with the registry's text for the step(s) the test is tagged
// with, and the banner turns green or red when the test ends, held long enough to be on the video.
import fs from 'node:fs';
import * as real from '../../node_modules/@playwright/test/index.mjs';
import { captionFor, finalCaption } from './caption.mjs';
import { fitVideo } from './plan.mjs';
import { installOverlay } from './overlay.mjs';

export * from '../../node_modules/@playwright/test/index.mjs';

const registry = JSON.parse(fs.readFileSync(process.env.JV_REGISTRY, 'utf8'));
const HOLD_MS = 1800;

export const test = real.test.extend({
	journeyOverlay: [
		async ({ context }, use, info) => {
			const vp = info.project.use.viewport ?? { width: 1280, height: 720 };
			const video = fitVideo(vp);
			const scale = Math.max(
				1,
				Math.max(vp.width, vp.height) / Math.max(video.width, video.height)
			);
			const caption = captionFor(registry, info.title, info.file.split('/').pop());
			await context.addInitScript(installOverlay, { caption, scale });
			await use();
			const end = finalCaption(
				caption,
				info.status === 'passed' ? 'passed' : info.status,
				info.error?.message
			);
			const pages = context.pages();
			for (const p of pages) await p.evaluate((c) => window.__jv?.set(c), end).catch(() => {});
			if (pages.length) await pages[0].waitForTimeout(HOLD_MS).catch(() => {});
		},
		{ auto: true }
	]
});
