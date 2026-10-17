// Pure half of kioskctl (hub-suy): the shell and page probes it runs, the parsers for their
// output, and the doctor's verdicts. No I/O here, so every rule is unit-tested.

/** The Chromium processes kioskctl knows how to find: the browser process, never a helper. */
export const KIOSK_UNITS = [
	'hub-kiosk.service',
	'hub-kiosk-watchdog.timer',
	'hub-kiosk-display-agent.service'
];

/**
 * Bash run on the Pi as the SSH user. Defines `asowner`, which runs a command as whoever owns the
 * Wayland session (the `kiosk` user after install.sh, else the desktop user) with its runtime dir.
 */
export const REMOTE_PRELUDE = `
browser_pid() {
  for p in $(pgrep -x chromium; pgrep -x chromium-browser); do
    tr '\\0' ' ' < /proc/$p/cmdline | grep -qv -- '--type=' && { echo $p; return; }
  done
}
# The session owner is whoever runs the browser (the kiosk user's runtime dir is private, so a
# directory listing as the SSH user cannot see it); else the first Wayland socket root can see.
BP=$(browser_pid)
if [ -n "$BP" ]; then OWNER=$(ps -o user= -p "$BP" | tr -d ' ')
else OWNER=$(sudo -n sh -c 'ls /run/user/*/wayland-0 2>/dev/null' | head -1 | xargs -r stat -c %U 2>/dev/null); fi
RUNDIR=$( [ -n "$OWNER" ] && echo /run/user/$(id -u "$OWNER") )
asowner() {
  if [ -z "$OWNER" ]; then "$@"; return; fi
  if [ "$OWNER" = "$(id -un)" ]; then env XDG_RUNTIME_DIR="$RUNDIR" WAYLAND_DISPLAY=wayland-0 "$@"
  else sudo -n -u "$OWNER" env XDG_RUNTIME_DIR="$RUNDIR" WAYLAND_DISPLAY=wayland-0 "$@"; fi
}
`;

/** One SSH round trip that gathers everything the doctor needs from the Pi, in marked sections. */
export function remoteFactsScript(hubOrigin) {
	// It goes into a shell string: only a plain origin is allowed through.
	const safe = typeof hubOrigin === 'string' && /^https?:\/\/[\w.:-]+$/.test(hubOrigin);
	const health = safe
		? `curl -s -o /dev/null -w '%{http_code} %{time_total}' --max-time 5 '${hubOrigin}/healthz'`
		: 'echo none';
	return `${REMOTE_PRELUDE}
echo "=== host"; hostname
echo "=== owner"; echo "$OWNER"
echo "=== chromium"; P=$(browser_pid); [ -n "$P" ] && tr '\\0' ' ' < /proc/$P/cmdline
echo; echo "=== emoji"; fc-list 2>/dev/null | grep -ci emoji
echo "=== wlr"; asowner wlr-randr 2>&1
echo "=== units"; for u in ${KIOSK_UNITS.join(' ')}; do echo "$u $(asowner systemctl --user is-active $u 2>/dev/null || true)"; done
echo "=== health"; ${health}
echo
echo "=== end"`;
}

/** Splits `=== name` sections into { name: text }. */
export function parseSections(text) {
	const out = {};
	let name = null;
	for (const line of text.split('\n')) {
		const m = /^=== (\w+)$/.exec(line);
		if (m) {
			name = m[1];
			out[name] = [];
		} else if (name) out[name].push(line);
	}
	for (const k of Object.keys(out)) out[k] = out[k].join('\n').trim();
	return out;
}

/** The doctor's view of the Pi, from `remoteFactsScript` output. */
export function remoteFacts(text) {
	const s = parseSections(text);
	const units = {};
	for (const line of (s.units ?? '').split('\n').filter(Boolean)) {
		const [unit, state = ''] = line.split(' ');
		units[unit] = state;
	}
	return {
		host: s.host || null,
		owner: s.owner || null,
		chromium: s.chromium || null,
		emoji: Number(s.emoji) || 0,
		outputs: parseWlrRandr(s.wlr ?? ''),
		units,
		health: s.health && s.health !== 'none' ? s.health : null
	};
}

/** Flags that matter on the browser process's command line. */
export function parseFlags(cmdline) {
	const flag = (name) => {
		const m = new RegExp(`--${name}(?:=(\\S+))?`).exec(cmdline);
		return m ? (m[1] ?? true) : null;
	};
	return {
		passwordStore: flag('password-store'),
		debugPort: flag('remote-debugging-port'),
		appId: flag('app-id'),
		kiosk: flag('kiosk') === true,
		automation: /--enable-automation|--headless|--test-type/.test(cmdline)
	};
}

/** `wlr-randr` output: one entry per output with its current mode and transform. */
export function parseWlrRandr(text) {
	const outputs = [];
	let cur = null;
	for (const line of text.split('\n')) {
		const head = /^(\S+) "(.*)"$/.exec(line);
		if (head) {
			cur = { output: head[1], name: head[2], enabled: null, mode: null, transform: null };
			outputs.push(cur);
			continue;
		}
		if (!cur) continue;
		const mode = /^\s+(\d+x\d+) px, ([\d.]+) Hz.*current/.exec(line);
		if (mode) cur.mode = `${mode[1]}@${Math.round(Number(mode[2]))}`;
		const enabled = /^\s+Enabled: (yes|no)/.exec(line);
		if (enabled) cur.enabled = enabled[1] === 'yes';
		const transform = /^\s+Transform: (\S+)/.exec(line);
		if (transform) cur.transform = transform[1];
	}
	return outputs;
}

/**
 * Evaluated in the hub page. Must work when the app never hydrated, so it reads the DOM only.
 * The wave counts as visible when nothing between it and the viewport paints a background.
 */
export const PAGE_PROBE = `(() => {
	const bg = document.querySelector('[data-testid=wave-background]');
	const canvas = bg && bg.querySelector('canvas');
	const clear = (el) => getComputedStyle(el).backgroundColor === 'rgba(0, 0, 0, 0)';
	return {
		url: location.href,
		readyState: document.readyState,
		hydrated: Object.keys(window).some((k) => k.startsWith('__sveltekit')),
		swControlled: !!(navigator.serviceWorker && navigator.serviceWorker.controller),
		webdriver: navigator.webdriver,
		wave: bg ? {
			palette: bg.dataset.palette || null,
			canvas: !!canvas,
			drawn: canvas ? canvas.dataset.drawn === 'true' : false,
			bodyClear: clear(document.body)
		} : null
	};
})()`;

/** Evaluated in the page: a request through the browser's own network stack (and its worker). */
export const PAGE_FETCH_PROBE = `(async () => {
	const start = performance.now();
	const hung = new Promise((r) => setTimeout(() => r('timeout'), 5000));
	const res = await Promise.race([fetch('/healthz', { cache: 'no-store' }).then((r) => r.status, (e) => 'error: ' + e), hung]);
	return { result: res, ms: Math.round(performance.now() - start) };
})()`;

const pass = (check, detail) => ({ check, status: 'pass', detail });
const warn = (check, detail, hint) => ({ check, status: 'warn', detail, hint });
const fail = (check, detail, hint) => ({ check, status: 'fail', detail, hint });

/**
 * The doctor's verdicts. `facts` holds whatever was gathered; a missing part (null) means that
 * probe could not run, and checks that depend on it say so instead of guessing.
 */
export function diagnose(facts) {
	const out = [];
	const r = facts.remote;
	if (!r) return [fail('ssh', facts.sshError ?? 'unreachable', 'check KIOSK_HOST and the SSH key')];
	out.push(pass('ssh', r.host));

	const flags = r.chromium ? parseFlags(r.chromium) : null;
	if (!flags) out.push(fail('chromium', 'not running', 'kioskctl restart'));
	else {
		out.push(
			pass('chromium', flags.kiosk ? 'kiosk mode' : flags.appId ? `app ${flags.appId}` : 'browser')
		);
		out.push(
			flags.passwordStore === 'basic'
				? pass('password-store', 'basic')
				: fail(
						'password-store',
						String(flags.passwordStore ?? 'keyring (default)'),
						'a locked gnome-keyring hangs every request: add --password-store=basic'
					)
		);
		if (flags.automation)
			out.push(fail('automation-flags', 'set', 'navigator.webdriver pins the wave and theme off'));
	}

	out.push(
		r.emoji > 0
			? pass('emoji-font', `${r.emoji} font(s)`)
			: warn('emoji-font', 'none', 'sudo apt install fonts-noto-color-emoji')
	);

	const screen = r.outputs.find((o) => o.enabled !== false && o.mode);
	out.push(
		screen
			? pass('display', `${screen.output} ${screen.mode} transform=${screen.transform}`)
			: warn('display', 'no enabled output (asleep or unplugged)')
	);

	const units = Object.entries(r.units);
	if (units.every(([, s]) => s !== 'active'))
		out.push(warn('kiosk-units', 'not installed or not running', 'run kiosk/install.sh on the Pi'));
	else
		for (const [unit, s] of units)
			out.push(s === 'active' ? pass(unit, s) : fail(unit, s || 'unknown'));

	if (r.health) {
		const [code, secs] = r.health.split(' ');
		out.push(
			code === '200'
				? pass('server-from-pi', `200 in ${Math.round(Number(secs) * 1000)} ms`)
				: fail('server-from-pi', `curl ${code}`, 'the Pi cannot reach the hub server')
		);
	}

	if (!facts.devtools) {
		out.push(
			fail(
				'devtools',
				facts.devtoolsError ?? 'unreachable',
				'Chromium needs --remote-debugging-port'
			)
		);
		return out;
	}
	out.push(pass('devtools', facts.devtools));

	const p = facts.page;
	if (!p) {
		out.push(
			fail(
				'page',
				facts.pageError ?? 'no hub page',
				'the page did not answer: kioskctl trace <url>'
			)
		);
		return out;
	}
	out.push(
		p.readyState === 'complete'
			? pass('page-load', p.url)
			: fail('page-load', `${p.readyState} at ${p.url}`, 'a resource is stuck: kioskctl trace')
	);
	out.push(
		p.hydrated
			? pass('hydrated', 'app started')
			: fail(
					'hydrated',
					'inline bootstrap never ran',
					'blocked script or stylesheet: kioskctl trace'
				)
	);

	const f = facts.pageFetch;
	if (f)
		out.push(
			f.result === 200
				? pass(
						'browser-network',
						`/healthz 200 in ${f.ms} ms${p.swControlled ? ' via worker' : ''}`
					)
				: fail(
						'browser-network',
						`/healthz ${f.result} after ${f.ms} ms`,
						r.health?.startsWith('200')
							? 'curl works but Chromium does not: keyring, proxy or a stuck worker (kioskctl sw reset)'
							: 'the server is unreachable'
					)
		);

	const w = p.wave;
	if (!w) out.push(warn('wave', 'off or covered by the photo frame'));
	else if (p.webdriver) out.push(warn('wave', 'navigator.webdriver is set: still gradient only'));
	else if (!w.canvas)
		out.push(warn('wave', 'still gradient (no GPU, too slow, or reduced motion)'));
	else if (!w.drawn)
		out.push(fail('wave', 'canvas never drew', 'check WebGL and that the app hydrated'));
	else if (!w.bodyClear) out.push(fail('wave', 'drawn but covered by the body background'));
	else out.push(pass('wave', `${w.palette} drawing`));

	if (facts.displayRole !== undefined)
		out.push(
			facts.displayRole === 'wall'
				? pass('display-role', 'wall')
				: warn(
						'display-role',
						facts.displayRole ?? 'personal',
						'open the hub once with ?display=wall'
					)
		);
	return out;
}

/** Overall result: ok unless anything failed. */
export function summarize(checks) {
	const count = (s) => checks.filter((c) => c.status === s).length;
	return { ok: count('fail') === 0, pass: count('pass'), warn: count('warn'), fail: count('fail') };
}
