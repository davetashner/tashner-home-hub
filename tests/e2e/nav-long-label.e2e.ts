import { expect, test } from '@playwright/test';
import { ensureHousehold, signInAsAdult } from './adult';
import { trackMember } from './cleanup';
import { gotoHydrated } from './hydrated';
import { expectTappable } from './tap';

// hub-aol: with one child the to-do tab reads "<Name>'s To-Dos". A long name must wrap or shrink
// inside its own slot instead of running over the neighbouring tabs.
test.beforeAll(ensureHousehold);

const shot = process.env.NAV_SHOT_DIR;

const viewports = [
	{ name: 'wall portrait 1440x2560', width: 1440, height: 2560 },
	{ name: 'phone portrait 390x844', width: 390, height: 844 },
	{ name: 'small phone portrait 360x740', width: 360, height: 740 },
	{ name: 'iPad portrait 834x1194', width: 834, height: 1194 },
	{ name: 'Split View 507x834', width: 507, height: 834 },
	{ name: 'wall landscape 2560x1440', width: 2560, height: 1440 }
];

for (const vp of viewports) {
	test(`${vp.name}: a long member name never overlaps the other nav labels @J16.3`, async ({
		page
	}, info) => {
		await page.setViewportSize({ width: vp.width, height: vp.height });
		await signInAsAdult(page, `e2e-nav-long-${info.workerIndex}`);
		const member = await (
			await page.request.post('/api/members', {
				data: { name: 'Maximilian', role: 'child', color: 'member-4', avatar: '🦊' }
			})
		).json();
		trackMember(member.id);

		await gotoHydrated(page, '/calendar');
		const nav = page.locator('nav[aria-label="Main"]');
		const chores = nav.locator('a[href$="/chores"]');
		// The tab carries the name only while exactly one child is in the household. Other specs
		// share this server, so when more children exist put the same label in place directly.
		if (!(await chores.getAttribute('aria-label'))?.includes('Maximilian')) {
			await chores.evaluate((a) => {
				a.setAttribute('aria-label', "Maximilian's To-Dos");
				// spans: icon, full label, short bar label (left as is, like a real named tab)
				a.querySelectorAll('span')[1].textContent = "Maximilian's To-Dos";
			});
		}
		await expect(chores).toHaveAttribute('aria-label', /Maximilian/);

		if (shot) await nav.screenshot({ path: `${shot}/${vp.width}x${vp.height}.png` });
		const items = nav.locator('a');
		const count = await items.count();
		const boxes: { text: string; x: number; y: number; w: number; h: number }[] = [];
		for (let i = 0; i < count; i++) {
			const item = items.nth(i);
			// Seven tabs share a phone's width, so each is narrower than 60px there (existing
			// design); the height is what must hold.
			if (vp.width >= 500) await expectTappable(item);
			else expect((await item.boundingBox())!.height).toBeGreaterThanOrEqual(60);
			// The visible label is the last span; icon-only layouts (phones) hide it.
			const label = item.locator('span').last();
			// Phones show icons only: the label is screen-reader text (sr-only, absolutely placed).
			if (!(await label.isVisible())) continue;
			if (await label.evaluate((el) => getComputedStyle(el).position === 'absolute')) continue;
			const box = await label.evaluate((el) => {
				const range = document.createRange();
				range.selectNodeContents(el);
				const r = range.getBoundingClientRect();
				return { text: el.textContent ?? '', r: r.toJSON() };
			});
			boxes.push({ text: box.text, x: box.r.left, y: box.r.top, w: box.r.width, h: box.r.height });
		}
		for (let a = 0; a < boxes.length; a++) {
			for (let b = a + 1; b < boxes.length; b++) {
				const p = boxes[a];
				const q = boxes[b];
				const overlap =
					p.x < q.x + q.w - 1 && q.x < p.x + p.w - 1 && p.y < q.y + q.h - 1 && q.y < p.y + p.h - 1;
				expect(overlap, `"${p.text}" overlaps "${q.text}"`).toBe(false);
			}
		}
	});
}
