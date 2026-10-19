// Pure helpers for the post-deploy smoke (run.mjs): argument parsing, the page list, the
// read-only request guard and the result checks. No Playwright import, so they unit-test fast.

/** Every page is a GET of a read-only screen. `landmark` is what must be visible once hydrated. */
export const PAGES = [
	{ id: 'home', path: '/', landmark: 'main' },
	{ id: 'calendar', path: '/calendar', landmark: 'main' },
	{ id: 'chores', path: '/chores', landmark: 'main' },
	{ id: 'lists', path: '/lists', landmark: 'main' },
	{ id: 'meals', path: '/meals', landmark: 'main' },
	{ id: 'photos', path: '/photos', landmark: 'main' },
	{ id: 'music', path: '/music', landmark: 'main' },
	{ id: 'games', path: '/games', landmark: 'main' },
	// No adult session: settings bounces to /unlock (or /setup on a brand-new empty database).
	{ id: 'settings', path: '/settings', landmark: 'main', expectUrl: /\/(unlock|setup)(\?|$)/ }
];

/** Device profile names match playwright.config.ts; `engine` picks the browser, `device` its preset. */
export const PROFILES = [
	{ name: 'wall-landscape-1440p', engine: 'chromium', viewport: { width: 2560, height: 1440 } },
	{ name: 'wall-portrait-1440p', engine: 'chromium', viewport: { width: 1440, height: 2560 } },
	{ name: 'iphone-webkit', engine: 'webkit', device: 'iPhone 15' },
	{ name: 'ipad-portrait-webkit', engine: 'webkit', device: 'iPad Pro 11' },
	{ name: 'ipad-landscape-webkit', engine: 'webkit', device: 'iPad Pro 11 landscape' }
];

export const USAGE = `usage: node scripts/deploy-smoke/run.mjs --base <url> [--device <name,...>] [--only <page,...>]
                                         [--out <dir>] [--pi] [--timeout <ms>]
  --base     site to check (required), e.g. https://hub.davetashner.com
  --device   comma list of: ${PROFILES.map((p) => p.name).join(', ')} (default: all)
  --only     comma list of: ${PAGES.map((p) => p.id).join(', ')} (default: all)
  --out      screenshot dir (default reports/deploy-smoke/<timestamp>; gitignored, real family data)
  --pi       also print the kioskctl command that screenshots the Pi (not run)
  --timeout  per-page load timeout in ms (default 20000)`;

function pick(list, key, label, raw) {
	if (raw === undefined) return list;
	const want = raw
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
	const known = new Set(list.map((x) => x[key]));
	const bad = want.filter((w) => !known.has(w));
	if (bad.length || want.length === 0)
		throw new Error(`unknown ${label}: ${bad.join(', ') || '(empty)'}`);
	return list.filter((x) => want.includes(x[key]));
}

/** argv (without node and script) -> options; throws Error with a message on bad input. */
export function parseArgs(argv, now = new Date()) {
	const o = { base: '', pi: false, timeout: 20_000 };
	let device;
	let only;
	let out;
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		const val = () => {
			const v = argv[++i];
			if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value`);
			return v;
		};
		if (a === '--base') o.base = val();
		else if (a === '--device') device = val();
		else if (a === '--only') only = val();
		else if (a === '--out') out = val();
		else if (a === '--timeout') o.timeout = Number(val());
		else if (a === '--pi') o.pi = true;
		else throw new Error(`unknown argument: ${a}`);
	}
	if (!o.base) throw new Error('--base is required');
	let url;
	try {
		url = new URL(o.base);
	} catch {
		throw new Error(`--base is not a URL: ${o.base}`);
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:')
		throw new Error('--base must be http(s)');
	o.base = url.origin;
	if (!Number.isFinite(o.timeout) || o.timeout <= 0)
		throw new Error('--timeout must be a positive number');
	o.profiles = pick(PROFILES, 'name', 'device', device);
	o.pages = pick(PAGES, 'id', 'page', only);
	o.out = out ?? `reports/deploy-smoke/${now.toISOString().replace(/[:.]/g, '-')}`;
	return o;
}

export const isReadOnlyMethod = (method) => ['GET', 'HEAD'].includes(method.toUpperCase());

/**
 * The read-only guard. `handler` goes to page.route('**\/*'): GET/HEAD continue, anything else is
 * aborted and recorded. The run fails if `attempts` is not empty.
 */
export function createGuard() {
	const attempts = [];
	return {
		attempts,
		handler: (route) => {
			const req = route.request();
			if (isReadOnlyMethod(req.method())) return route.continue();
			attempts.push(`${req.method()} ${req.url()}`);
			return route.abort('blockedbyclient');
		}
	};
}

/** Sideways scroll: the document is wider than the viewport (1px of rounding allowed). */
export const hasSidewaysScroll = ({ scrollWidth, innerWidth }) => scrollWidth > innerWidth + 1;

/** Findings for one page visit -> list of failure strings (empty = pass). */
export function judge(page, v) {
	const fails = [];
	if (v.status !== 200) fails.push(`HTTP ${v.status ?? 'none'}`);
	if (page.expectUrl && !page.expectUrl.test(v.finalUrl)) fails.push(`landed on ${v.finalUrl}`);
	if (!v.hydrated) fails.push('not hydrated');
	if (!v.landmarkVisible) fails.push(`landmark "${page.landmark}" not visible`);
	if (hasSidewaysScroll(v)) fails.push(`sideways scroll (${v.scrollWidth} > ${v.innerWidth})`);
	for (const e of v.consoleErrors) fails.push(`console error: ${e.slice(0, 160)}`);
	return fails;
}

/** The kioskctl screenshot command to run by hand (the smoke never opens ssh itself). */
export const piCommand = (outFile = 'reports/deploy-smoke/pi.png') =>
	`KIOSK_HOST=<user@pi> KIOSK_SSH_KEY=<key> node scripts/kiosk/kioskctl.mjs screenshot --out ${outFile} --scale 0.5`;
