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
echo "=== session"; id kiosk >/dev/null 2>&1 && echo "kioskuser yes" || echo "kioskuser no"
loginctl list-sessions --no-legend 2>/dev/null | awk '{print $1}' | while read -r id; do
  loginctl show-session "$id" -p Name -p Seat -p Type -p Class 2>/dev/null |
    awk -F= '{v[$1]=$2} END{ if (v["Class"]=="user") print "session " v["Name"] " " (v["Seat"]==""?"-":v["Seat"]) " " v["Type"] }'
done
echo "=== recovery"
if [ "$(systemctl show -p LoadState --value hub-kiosk-session-recovery.timer 2>/dev/null)" = loaded ]; then
  echo "timer $(systemctl is-active hub-kiosk-session-recovery.timer 2>/dev/null || true)"
else echo "timer not-installed"; fi
echo "=== health"; ${health}
echo
echo "=== wake"
sed -n 's/^INPUT="\\{0,1\\}\\([a-z]*\\).*/input \\1/p' /etc/hub-kiosk/kiosk.conf 2>/dev/null
AP=$(pgrep -f '^/usr/bin/python3 /usr/local/lib/hub-kiosk/hub-kiosk-display-agent' | head -1)
if [ -n "$AP" ]; then
  for d in $(sudo -n ls -l /proc/$AP/fd 2>/dev/null | grep -o 'event[0-9]*$' | sort -u); do
    echo "dev $d $(cat /sys/class/input/$d/device/name 2>/dev/null)"
  done
fi
echo "=== cec"
if grep -qE '^CEC_MODE="?also' /etc/hub-kiosk/kiosk.conf 2>/dev/null; then
  CD=$(sed -n 's/^CEC_DEVICE="\\{0,1\\}\\([A-Za-z0-9_./-]*\\).*/\\1/p' /etc/hub-kiosk/kiosk.conf 2>/dev/null | head -1)
  echo "device \${CD:-/dev/cec0}"
  [ -e "\${CD:-/dev/cec0}" ] && echo "present yes" || echo "present no"
  sed -n 's/^CEC_BACKEND="\\{0,1\\}\\([a-z-]*\\).*/backend \\1/p' /etc/hub-kiosk/kiosk.conf 2>/dev/null | head -1
fi
echo "=== speaker"
H=$(getent passwd "\${OWNER:-$(id -un)}" | cut -d: -f6)
SPK=$(sudo -n cat "$H/.local/state/hub-kiosk/speaker" 2>/dev/null | tr -d '[:space:]')
[ -n "$SPK" ] || SPK=$(sed -n 's/^BT_SPEAKER="\\{0,1\\}\\([0-9A-Fa-f:]*\\).*/\\1/p' /etc/hub-kiosk/kiosk.conf 2>/dev/null)
case "$SPK" in *[!0-9A-Fa-f:]*) SPK="" ;; esac
echo "mac $SPK"
if [ -n "$SPK" ]; then
  asowner bluetoothctl info "$SPK" 2>/dev/null | grep -E '^\\s+(Alias|Paired|Connected):'
  echo "default $(asowner wpctl inspect @DEFAULT_AUDIO_SINK@ 2>/dev/null | grep -o 'node.name = "[^"]*"')"
fi
echo "=== spotify"
if grep -qE '^SPOTIFY_CONNECT="?on' /etc/hub-kiosk/kiosk.conf 2>/dev/null; then
  echo "enabled yes"
  echo "unit $(asowner systemctl --user is-active hub-kiosk-librespot.service 2>/dev/null || true)"
  sudo -n test -s "$H/.local/state/hub-kiosk/librespot/credentials.json" 2>/dev/null && echo "credentials yes" || echo "credentials no"
  if command -v avahi-browse >/dev/null 2>&1; then
    timeout 8 avahi-browse -tpr _spotify-connect._tcp 2>/dev/null | grep -q '^=;[^;]*;[^;]*;Hub;' && echo "advertised yes" || echo "advertised no"
  else echo "advertised unknown"; fi
fi
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
		...(s.session === undefined ? {} : { session: parseSession(s.session) }),
		...(s.recovery ? { recovery: parseRecovery(s.recovery) } : {}),
		health: s.health && s.health !== 'none' ? s.health : null,
		...(s.wake === undefined ? {} : { wake: parseWake(s.wake) }),
		...(s.cec ? { cec: parseCec(s.cec) } : {}),
		...(s.speaker === undefined ? {} : { speaker: parseSpeaker(s.speaker) }),
		...(s.spotify ? { spotify: parseSpotify(s.spotify) } : {})
	};
}

/** The `session` section (hub-2ik): the kiosk user's login session, and who else holds the seat. */
export function parseSession(text) {
	const rows = text
		.split('\n')
		.filter((l) => l.startsWith('session '))
		.map((l) => l.split(' '))
		// Only graphical sessions count: a tty1 text login or ssh is not a person at the desktop.
		.filter((r) => ['wayland', 'x11', 'mir'].includes(r[3]));
	return {
		kioskUser: /^kioskuser yes$/m.test(text),
		kiosk: rows.some((r) => r[1] === 'kiosk'),
		others: [
			...new Set(
				rows
					.filter((r) => r[1] !== 'kiosk' && r[1] !== 'lightdm' && r[2] === 'seat0')
					.map((r) => r[1])
			)
		]
	};
}

/** The `recovery` section: state of the system-level session recovery timer. */
export function parseRecovery(text) {
	return { timer: /^timer (\S+)/m.exec(text)?.[1] ?? 'unknown' };
}

/** The `wake` section: kiosk.conf INPUT and the input devices the display agent has open. */
export function parseWake(text) {
	const lines = text.split('\n');
	const input = lines.find((l) => l.startsWith('input '))?.slice(6) || 'touch';
	const devices = lines
		.filter((l) => l.startsWith('dev '))
		.map((l) => l.split(' ').slice(2).join(' ') || l.split(' ')[1]);
	return { input, devices };
}

/** The `cec` section, present only when kiosk.conf has CEC_MODE=also. */
export function parseCec(text) {
	const field = (name) => new RegExp(`^${name} (.*)$`, 'm').exec(text)?.[1]?.trim() ?? '';
	return {
		device: field('device') || '/dev/cec0',
		present: field('present') === 'yes',
		backend: field('backend') || null
	};
}

/** The `speaker` section: the chosen speaker's Bluetooth state and whether it is the default sink. */
export function parseSpeaker(text) {
	const field = (name) => new RegExp(`^\\s*${name}:? (.*)$`, 'm').exec(text)?.[1]?.trim() ?? '';
	const mac = field('mac').toUpperCase();
	if (!mac) return { mac: null, name: null, paired: false, connected: false, defaultSink: false };
	return {
		mac,
		name: field('Alias') || null,
		paired: field('Paired') === 'yes',
		connected: field('Connected') === 'yes',
		defaultSink: field('default').includes(`bluez_output.${mac.replaceAll(':', '_')}`)
	};
}

/**
 * The `spotify` section (hub-txj.2), present only when kiosk.conf has SPOTIFY_CONNECT=on: whether
 * the librespot user unit runs, whether a login is cached, and whether "Hub" is advertised by mDNS.
 */
export function parseSpotify(text) {
	const field = (name) => new RegExp(`^${name} (.*)$`, 'm').exec(text)?.[1]?.trim() ?? '';
	const adv = field('advertised');
	return {
		unit: field('unit'),
		credentials: field('credentials') === 'yes',
		advertised: adv === 'yes' ? true : adv === 'no' ? false : null
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

	if (r.session?.kioskUser && !r.session.kiosk) {
		const rec = r.recovery?.timer ?? 'unknown';
		const who = r.session.others.length
			? `${r.session.others.join(', ')} is logged in on the desktop instead`
			: 'LightDM is probably at the login greeter';
		out.push(
			fail(
				'kiosk-session',
				`no kiosk session is running (${who}); recovery timer: ${rec}`,
				rec === 'active'
					? r.session.others.length
						? 'recovery leaves a logged-in person alone: log them out, or sudo systemctl restart lightdm'
						: 'it restarts LightDM after a couple of minutes; or now: sudo systemctl restart lightdm'
					: 'recovery is not running: update the Pi (kiosk/README.md, Updating), or sudo systemctl restart lightdm'
			)
		);
	} else if (r.session?.kioskUser && r.recovery && r.recovery.timer !== 'active')
		out.push(
			warn(
				'session-recovery',
				`timer ${r.recovery.timer}`,
				'a dead kiosk session would stay dead: re-run sudo kiosk/install.sh'
			)
		);

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

	const wk = r.wake;
	if (wk && r.units['hub-kiosk-display-agent.service'] === 'active')
		out.push(
			wk.devices.length
				? pass('wake-input', `${wk.input}: ${[...new Set(wk.devices)].join(', ')}`)
				: fail(
						'wake-input',
						`${wk.input}: no input device watched, nothing at the screen can wake it`,
						wk.input === 'mouse'
							? 'plug in the mouse or keyboard; the agent rescans every 10 s'
							: 'plug in the touch screen, or set INPUT="mouse" in kiosk.conf'
					)
		);

	if (r.cec) {
		if (!r.cec.backend)
			out.push(
				warn('cec', 'CEC_MODE=also but no CEC_BACKEND', 'set CEC_BACKEND="cec-ctl" in kiosk.conf')
			);
		else if (!r.cec.present)
			out.push(
				warn(
					'cec',
					`CEC_MODE=also but ${r.cec.device} is missing`,
					'the TV will not get standby: check the HDMI port, "ls /dev/cec*", sudo apt install v4l-utils'
				)
			);
		else out.push(pass('cec', `${r.cec.backend} on ${r.cec.device}, standby sent with HDMI off`));
	}

	const sp = r.speaker;
	if (sp) {
		const hint = 'pick it in Settings > Music > Speaker';
		if (!sp.mac) out.push(warn('speaker', 'none chosen', hint));
		else if (!sp.paired) out.push(warn('speaker', `${sp.mac} not paired`, hint));
		else if (!sp.connected)
			out.push(warn('speaker', `${sp.name ?? sp.mac} off or out of range`, 'switch it on'));
		else if (!sp.defaultSink)
			out.push(
				fail('speaker', `${sp.name ?? sp.mac} connected but not the default sink`, 'wpctl status')
			);
		else out.push(pass('speaker', `${sp.name ?? sp.mac} connected`));
	}

	const sc = r.spotify;
	if (sc) {
		const logs = 'journalctl --user -u hub-kiosk-librespot (see kiosk/README.md, Spotify Connect)';
		if (sc.unit !== 'active')
			out.push(fail('spotify-connect', `service ${sc.unit || 'not installed'}`, logs));
		else if (sc.credentials)
			out.push(
				sc.advertised === false
					? warn(
							'spotify-connect',
							'signed in, but "Hub" is not advertised on the LAN (avahi-daemon?)',
							logs
						)
					: pass('spotify-connect', 'signed in as the Hub device')
			);
		else if (sc.advertised)
			out.push(
				warn(
					'spotify-connect',
					'advertised but not signed in yet',
					'once: open Spotify on a phone on the same Wi-Fi and pick the speaker "Hub"'
				)
			);
		else out.push(fail('spotify-connect', 'running, but not advertised and not signed in', logs));
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
