// Pure planning for the journey videos (record.mjs): which devices, which tests, what the video
// size is. No Playwright and no file system, so journey-videos.test.mjs can run it directly.

/** --device name -> the Playwright projects in playwright.config.ts it records. */
export const DEVICE_PROJECTS = {
	'wall-landscape': ['wall-landscape-1440p'],
	'wall-portrait': ['wall-portrait-1440p'],
	'ipad-landscape': ['ipad-landscape-webkit'],
	'ipad-portrait': ['ipad-portrait-webkit'],
	ipad: ['ipad-landscape-webkit', 'ipad-portrait-webkit'],
	iphone: ['iphone-webkit']
};
const ALL = ['wall-landscape', 'wall-portrait', 'ipad', 'iphone'];

/** `--only J1,J4 --device ipad --skip-build --port 4400` -> options. Throws on anything unknown. */
export function parseArgs(argv) {
	const opts = { only: null, devices: ['wall-landscape'], skipBuild: false, port: null };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--only') opts.only = (argv[++i] ?? '').split(',').filter(Boolean);
		else if (a === '--device') {
			const d = argv[++i];
			if (d === 'all') opts.devices = ALL;
			else if (DEVICE_PROJECTS[d]) opts.devices = [d];
			else throw new Error(`--device is ${[...Object.keys(DEVICE_PROJECTS), 'all'].join(', ')}`);
		} else if (a === '--skip-build') opts.skipBuild = true;
		else if (a === '--port') opts.port = Number(argv[++i]);
		else throw new Error(`unknown argument ${a}`);
	}
	if (opts.only && !opts.only.length) throw new Error('--only needs journey ids, like J1,J4');
	return opts;
}

export const projectsFor = (devices) => [...new Set(devices.flatMap((d) => DEVICE_PROJECTS[d]))];

/** A video's size: the viewport scaled down so its long side is at most `long`, even numbers. */
export function fitVideo({ width, height }, long = 1280) {
	const k = Math.min(1, long / Math.max(width, height));
	const even = (n) => Math.max(2, Math.round((n * k) / 2) * 2);
	return { width: even(width), height: even(height) };
}

export const testKey = (t) => `${t.file}::${t.title}`;

/**
 * The tests to record per journey for one project. `tagged` is trace.mjs's tagsFromListing
 * ({ id, file, title, project } per tag). A test tagged with several steps of a journey appears
 * once; tests run in step order, then file and title. Journeys without a test for the project are
 * kept with an empty list so the report can say so.
 */
export function planJourneys(registry, tagged, project, only = null) {
	const known = registry.journeys.map((j) => j.id);
	const unknown = (only ?? []).filter((id) => !known.includes(id));
	if (unknown.length)
		throw new Error(`No journey ${unknown.join(', ')}. There are ${known.join(', ')}.`);
	return registry.journeys
		.filter((j) => !only || only.includes(j.id))
		.map((journey) => {
			const order = journey.steps.map((s) => s.id);
			const byTest = new Map();
			for (const t of tagged) {
				if (t.project !== project || !order.includes(t.id)) continue;
				const e = byTest.get(testKey(t)) ?? { file: t.file, title: t.title, ids: [] };
				e.ids.push(t.id);
				byTest.set(testKey(t), e);
			}
			const tests = [...byTest.values()]
				.map((t) => ({ ...t, ids: t.ids.sort((a, b) => order.indexOf(a) - order.indexOf(b)) }))
				.sort(
					(a, b) =>
						order.indexOf(a.ids[0]) - order.indexOf(b.ids[0]) ||
						a.file.localeCompare(b.file) ||
						a.title.localeCompare(b.title)
				);
			return { journey, tests };
		});
}

/** Playwright --grep matching the titles tagged with a step of these journeys (@J1.2, not @J10.2). */
export function grepFor(plans) {
	const ids = plans.map((p) => p.journey.id.slice(1));
	return `@J(?:${ids.join('|')})\\.\\d+(?!\\d)`;
}

export const slug = (s) =>
	s
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
