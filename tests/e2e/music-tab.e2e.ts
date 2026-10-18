import { expect, test, type Page } from '@playwright/test';
import { expectTappable } from './tap';

const run = Date.now().toString(36);
const LISTS = [
	{ id: 'pl1', name: `Morning mix ${run}`, cover: null, tracks: 14 },
	{ id: 'pl2', name: `Bath songs ${run}`, cover: null, tracks: 22 },
	{ id: 'pl3', name: `Sing along ${run}`, cover: null, tracks: 9 }
];

interface Mock {
	asleep: boolean;
	playing: boolean;
	playlist: string | null;
	volume: number;
	calls: string[];
	volumes: number[];
}

async function mockMusic(page: Page, over: Partial<Mock> = {}): Promise<Mock> {
	const m: Mock = {
		asleep: false,
		playing: false,
		playlist: null,
		volume: 30,
		calls: [],
		volumes: [],
		...over
	};
	await page.route('**/api/music/playlists', (r) => r.fulfill({ json: LISTS }));
	await page.route('**/api/music/state', (r) =>
		r.fulfill({
			json: {
				connected: true,
				online: !m.asleep,
				isPlaying: m.playing,
				track: m.playing ? `Song ${run}` : null,
				artist: m.playing ? 'The Examples' : null,
				playlist: m.playlist ? { id: m.playlist, name: 'x' } : null,
				volume: m.volume,
				volumeCap: 50,
				timerRemainingSec: m.playing ? 754 : null,
				device: 'Hub'
			}
		})
	);
	await page.route('**/api/music/play', async (r) => {
		m.calls.push('play');
		if (m.asleep)
			return r.fulfill({
				status: 409,
				json: { code: 'no_device', message: 'The speaker is asleep' }
			});
		m.playing = true;
		m.playlist = (r.request().postDataJSON() as { playlistId: string }).playlistId;
		await r.fulfill({ json: { ok: true } });
	});
	for (const c of ['pause', 'resume']) {
		await page.route(`**/api/music/${c}`, (r) => {
			m.calls.push(c);
			m.playing = c === 'resume';
			return r.fulfill({ json: { ok: true } });
		});
	}
	await page.route('**/api/music/volume', (r) => {
		const p = (r.request().postDataJSON() as { percent: number }).percent;
		m.volumes.push(p);
		m.volume = p;
		return r.fulfill({ json: { percent: p } });
	});
	return m;
}

test('picking a playlist shows it playing, controls are big, pause works @J10.1', async ({
	page
}) => {
	const m = await mockMusic(page);
	await page.goto('/music');
	await expect(
		page.getByRole('heading', { level: 1, name: 'Pick your shower music' })
	).toBeVisible();
	await expect(page.getByTestId('speaker-chip')).toHaveText(/Speaker ready/);
	const tiles = page.getByTestId('playlist-tile');
	await expect(tiles).toHaveCount(3);
	await expect(page.getByTestId('now-playing')).toHaveCount(0);

	await tiles.nth(1).click();
	await expect(tiles.nth(1)).toHaveAttribute('aria-pressed', 'true');
	await expect(page.getByTestId('now-playing')).toBeVisible();
	await expect(page.getByTestId('playing-now')).toHaveText('Playing now');
	await expect(page.getByTestId('np-track')).toHaveText(`Song ${run}`);
	await expect(page.getByTestId('timer-badge')).toHaveText(/Music stops in 12:34/);
	expect(m.calls).toEqual(['play']);

	for (const id of ['np-prev', 'np-toggle', 'np-next', 'vol-down', 'vol-up']) {
		await expectTappable(page.getByTestId(id), 96);
	}

	await page.getByTestId('np-toggle').click();
	await expect(page.getByTestId('np-toggle')).toHaveAccessibleName('Play');
	await page.getByTestId('np-toggle').click();
	await expect(page.getByTestId('np-toggle')).toHaveAccessibleName('Pause');
	expect(m.calls).toEqual(['play', 'pause', 'resume']);
});

test('volume stops at the parent cap @J10.2', async ({ page }) => {
	const m = await mockMusic(page, { playing: true, playlist: 'pl1', volume: 40 });
	await page.goto('/music');
	await expect(page.getByTestId('now-playing')).toBeVisible();
	await page.getByTestId('vol-up').click();
	await expect(page.getByTestId('vol-note')).toHaveText('As loud as it goes');
	await expect(page.getByTestId('vol-up')).toBeDisabled();
	expect(m.volumes).toEqual([50]);
});

test('an asleep speaker shows the sheet and Try again starts the music @J10.3', async ({
	page
}) => {
	const m = await mockMusic(page, { asleep: true });
	await page.goto('/music');
	await expect(page.getByTestId('speaker-chip')).toHaveText(/Speaker asleep/);
	await page.getByTestId('playlist-tile').first().click();
	const sheet = page.getByTestId('speaker-asleep');
	await expect(sheet).toBeVisible();
	await expect(sheet).toContainText('Ask a grown-up');
	await page.getByRole('button', { name: 'Not now' }).last().click();
	await expect(sheet).toHaveCount(0);

	await page.getByTestId('playlist-tile').first().click();
	await expect(sheet).toBeVisible();
	m.asleep = false;
	await page.getByTestId('asleep-retry').click();
	await expect(sheet).toHaveCount(0);
	await expect(page.getByTestId('playing-now')).toHaveText('Playing now');
	expect(m.calls).toEqual(['play', 'play', 'play']);
});

test('with no playlists the tab says to ask a grown-up @J10.1', async ({ page }) => {
	await page.route('**/api/music/playlists', (r) => r.fulfill({ json: [] }));
	await page.route('**/api/music/state', (r) => r.fulfill({ status: 500, body: '' }));
	await page.goto('/music');
	await expect(page.getByTestId('music-empty')).toContainText('Ask a grown-up');
});
