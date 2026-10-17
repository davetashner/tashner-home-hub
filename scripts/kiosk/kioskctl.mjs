#!/usr/bin/env node
// kioskctl (hub-suy): inspect and drive the Pi kiosk from a dev machine, for agents and humans.
// Everything goes over SSH, plus a port-forward to Chromium's DevTools (127.0.0.1 on the Pi).
// Every command prints JSON, has a timeout (a hung page never hangs the tool), and exits 0 on
// success, 1 when a check or the page failed, 2 on usage or connection errors.
// Usage: KIOSK_HOST=user@pi.local node scripts/kiosk/kioskctl.mjs <command> (see `help`).
import { spawn } from 'node:child_process';
import { writeFileSync, writeSync } from 'node:fs';
import { createServer } from 'node:net';
import {
	diagnose,
	PAGE_FETCH_PROBE,
	PAGE_PROBE,
	REMOTE_PRELUDE,
	remoteFacts,
	remoteFactsScript,
	summarize
} from './doctor.mjs';

const HELP = `kioskctl <command> [options]

  doctor                     every health check, pass/warn/fail (exit 1 on any fail)
  screenshot [--out f.png] [--scale 0.5]
  eval <js>                  evaluate in the hub page (awaits promises)
  trace [url] [--secs 15]    navigate and log network, console and exceptions
  reload                     reload the page, then probe it
  restart                    restart Chromium (the kiosk unit, or the same command line)
  sw status | sw reset       service worker registrations and caches; reset clears both
  logs [--lines 100]         journal of the kiosk session user
  tunnel                     hold a DevTools port-forward open and print its port

env: KIOSK_HOST (required, user@host), KIOSK_SSH_KEY, KIOSK_DEBUG_PORT (9222), KIOSK_HUB_URL`;

const args = process.argv.slice(2);
const opt = (name, fallback) => {
	const i = args.indexOf(`--${name}`);
	if (i === -1) return fallback;
	const [, value] = args.splice(i, 2);
	return value;
};
const out = (value, code = 0) => {
	// Synchronous: process.exit next must not cut off piped output, and callers rely on not returning.
	writeSync(1, JSON.stringify(value, null, 2) + '\n');
	process.exit(code);
};
const die = (error, code = 2) => out({ ok: false, error: String(error?.message ?? error) }, code);

const host = opt('host', process.env.KIOSK_HOST);
const key = opt('key', process.env.KIOSK_SSH_KEY);
const debugPort = Number(opt('port', process.env.KIOSK_DEBUG_PORT ?? 9222));
const sshBase = [
	'-o',
	'BatchMode=yes',
	'-o',
	'ConnectTimeout=5',
	'-o',
	'ServerAliveInterval=5',
	...(key ? ['-i', key, '-o', 'IdentitiesOnly=yes'] : [])
];

/** Runs a bash script on the Pi; resolves with stdout as a Buffer (binary-safe). */
function ssh(script, timeoutMs = 20_000) {
	return new Promise((resolve, reject) => {
		const child = spawn('ssh', [...sshBase, host, 'bash -s'], { stdio: ['pipe', 'pipe', 'pipe'] });
		const chunks = [];
		let stderr = '';
		const timer = setTimeout(() => {
			child.kill();
			reject(new Error(`ssh timed out after ${timeoutMs} ms`));
		}, timeoutMs);
		child.stdout.on('data', (c) => chunks.push(c));
		child.stderr.on('data', (c) => (stderr += c));
		child.on('close', (code) => {
			clearTimeout(timer);
			if (code === 255) reject(new Error(stderr.trim() || 'ssh failed'));
			else resolve(Buffer.concat(chunks));
		});
		child.stdin.end(script);
	});
}

const freePort = () =>
	new Promise((resolve) => {
		const srv = createServer().listen(0, '127.0.0.1', () => {
			const { port } = srv.address();
			srv.close(() => resolve(port));
		});
	});

/** Port-forward to DevTools; resolves once /json/version answers through it. */
async function tunnel() {
	const port = await freePort();
	const child = spawn(
		'ssh',
		[
			...sshBase,
			'-N',
			'-o',
			'ExitOnForwardFailure=yes',
			'-L',
			`${port}:127.0.0.1:${debugPort}`,
			host
		],
		{ stdio: 'ignore' }
	);
	const close = () => child.kill();
	process.on('exit', close);
	const deadline = Date.now() + 10_000;
	while (Date.now() < deadline) {
		if (child.exitCode !== null) throw new Error('ssh port-forward exited');
		try {
			const version = await (
				await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) })
			).json();
			return { port, version, close };
		} catch {
			await new Promise((r) => setTimeout(r, 300));
		}
	}
	close();
	throw new Error(`DevTools not answering on the Pi's port ${debugPort}`);
}

/** A CDP session on one target, with per-command timeouts and an event hook. */
async function cdp(wsUrl) {
	const ws = new WebSocket(wsUrl);
	await new Promise((resolve, reject) => {
		ws.addEventListener('open', resolve, { once: true });
		ws.addEventListener('error', () => reject(new Error('DevTools WebSocket failed')), {
			once: true
		});
	});
	let id = 0;
	const pending = new Map();
	const listeners = [];
	ws.addEventListener('message', (m) => {
		const msg = JSON.parse(m.data);
		if (msg.id && pending.has(msg.id)) {
			const { resolve, reject } = pending.get(msg.id);
			pending.delete(msg.id);
			if (msg.error) reject(new Error(msg.error.message));
			else resolve(msg.result);
		} else if (msg.method) for (const fn of listeners) fn(msg);
	});
	return {
		send(method, params = {}, timeoutMs = 10_000) {
			return new Promise((resolve, reject) => {
				const n = ++id;
				pending.set(n, { resolve, reject });
				ws.send(JSON.stringify({ id: n, method, params }));
				setTimeout(() => {
					if (pending.delete(n))
						reject(new Error(`${method} timed out after ${timeoutMs} ms (page hung?)`));
				}, timeoutMs);
			});
		},
		on: (fn) => listeners.push(fn),
		close: () => ws.close()
	};
}

async function pageSession(port) {
	const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
	const page =
		targets.find((t) => t.type === 'page' && /^https?:/.test(t.url)) ??
		targets.find((t) => t.type === 'page');
	if (!page) throw new Error('no page target');
	return { target: page, session: await cdp(page.webSocketDebuggerUrl) };
}

async function evaluate(session, expression, timeoutMs = 10_000) {
	const { result, exceptionDetails } = await session.send(
		'Runtime.evaluate',
		{ expression, awaitPromise: true, returnByValue: true },
		timeoutMs
	);
	if (exceptionDetails)
		throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
	return result.value;
}

async function withPage(fn) {
	const t = await tunnel();
	const { target, session } = await pageSession(t.port);
	try {
		return await fn(session, target);
	} finally {
		session.close();
		t.close();
	}
}

const waitForLoad = (session, timeoutMs) =>
	new Promise((resolve) => {
		const timer = setTimeout(() => resolve(false), timeoutMs);
		session.on((m) => {
			if (m.method === 'Page.loadEventFired') {
				clearTimeout(timer);
				resolve(true);
			}
		});
	});

async function doctor() {
	const facts = {};
	let origin = process.env.KIOSK_HUB_URL ? new URL(process.env.KIOSK_HUB_URL).origin : null;
	let t = null;
	try {
		t = await tunnel();
		facts.devtools = t.version.Browser;
	} catch (e) {
		facts.devtoolsError = e.message;
	}
	let page = null;
	if (t) {
		try {
			page = await pageSession(t.port);
			if (/^https?:/.test(page.target.url)) origin = new URL(page.target.url).origin;
		} catch (e) {
			facts.pageError = e.message;
		}
	}
	try {
		facts.remote = remoteFacts((await ssh(remoteFactsScript(origin))).toString());
	} catch (e) {
		facts.sshError = e.message;
	}
	if (page) {
		try {
			facts.page = await evaluate(page.session, PAGE_PROBE, 5000);
			facts.pageFetch = await evaluate(page.session, PAGE_FETCH_PROBE, 8000);
			const { cookies } = await page.session.send('Network.getCookies', { urls: [origin] });
			facts.displayRole = cookies.find((c) => c.name === 'hub_display')?.value ?? null;
		} catch (e) {
			facts.pageError = e.message;
		}
		page.session.close();
	}
	t?.close();
	const checks = diagnose(facts);
	const summary = summarize(checks);
	out({ ...summary, checks }, summary.ok ? 0 : 1);
}

async function screenshot() {
	const scale = Number(opt('scale', '0.5'));
	const file = opt('out', `kiosk-${new Date().toISOString().replace(/[:.]/g, '-')}.png`);
	const png = await ssh(`${REMOTE_PRELUDE}\nasowner grim -s ${scale} -`, 30_000);
	if (png.subarray(1, 4).toString() !== 'PNG')
		throw new Error(`grim failed: ${png.toString().slice(0, 200)}`);
	writeFileSync(file, png);
	out({ ok: true, file, bytes: png.length, scale });
}

async function trace() {
	const secs = Number(opt('secs', '15'));
	await withPage(async (session, target) => {
		const url = args[1] ?? target.url;
		const t0 = Date.now();
		const events = [];
		const log = (kind, detail) => events.push({ t: (Date.now() - t0) / 1000, kind, ...detail });
		const open = new Map();
		session.on(({ method, params: p }) => {
			if (method === 'Network.requestWillBeSent') {
				open.set(p.requestId, p.request.url);
				log('request', { method: p.request.method, url: p.request.url });
			} else if (method === 'Network.responseReceived')
				log('response', {
					status: p.response.status,
					url: p.response.url,
					protocol: p.response.protocol,
					fromServiceWorker: p.response.fromServiceWorker
				});
			else if (method === 'Network.loadingFinished') open.delete(p.requestId);
			else if (method === 'Network.loadingFailed') {
				log('failed', { url: open.get(p.requestId), error: p.errorText, blocked: p.blockedReason });
				open.delete(p.requestId);
			} else if (method === 'Runtime.exceptionThrown')
				log('exception', {
					text: p.exceptionDetails.exception?.description ?? p.exceptionDetails.text
				});
			else if (method === 'Runtime.consoleAPICalled')
				log(`console.${p.type}`, { text: p.args.map((a) => a.value ?? a.description).join(' ') });
			else if (method === 'Log.entryAdded') log(`log.${p.entry.level}`, { text: p.entry.text });
			else if (method === 'Page.loadEventFired') log('load', {});
		});
		for (const domain of ['Network', 'Page', 'Runtime', 'Log'])
			await session.send(`${domain}.enable`);
		await session.send('Page.navigate', { url });
		await new Promise((r) => setTimeout(r, secs * 1000));
		const stuck = [...open.values()];
		out({ ok: stuck.length === 0, url, secs, stuck, events }, stuck.length ? 1 : 0);
	});
}

async function reload() {
	await withPage(async (session) => {
		await session.send('Page.enable');
		const loaded = waitForLoad(session, 20_000);
		await session.send('Page.reload', { ignoreCache: true });
		const fired = await loaded;
		const page = await evaluate(session, PAGE_PROBE, 5000);
		out({ ok: fired && page.hydrated, loaded: fired, page }, fired && page.hydrated ? 0 : 1);
	});
}

async function restart() {
	// The kiosk unit when install.sh ran; otherwise relaunch the same command line, detached in a
	// transient user unit so it survives this SSH session.
	const script = `${REMOTE_PRELUDE}
if asowner systemctl --user cat hub-kiosk.service >/dev/null 2>&1; then
  asowner systemctl --user restart hub-kiosk.service && echo "unit hub-kiosk.service"; exit
fi
P=$(browser_pid); [ -n "$P" ] || { echo "error: chromium not running and no kiosk unit"; exit; }
# Chromium rewrites its process title, so cmdline is one space-joined string: split on spaces.
ARGS=$(tr '\\0' ' ' < /proc/$P/cmdline)
# Relaunch through the distro wrapper so /etc/chromium.d flags (password-store=basic) still apply.
case "$ARGS" in /usr/lib/chromium/chromium\\ *) [ -x /usr/bin/chromium ] && ARGS="/usr/bin/chromium \${ARGS#/usr/lib/chromium/chromium }" ;; esac
# Wait for every helper too: a new launch hands off to a dying instance's singleton and quits.
kill $P; for i in $(seq 1 30); do pgrep -x chromium >/dev/null || break; sleep 0.5; done
pkill -9 -x chromium 2>/dev/null; sleep 0.5
asowner systemd-run --user --collect --unit=kioskctl-chromium-$(date +%s) $ARGS >/dev/null 2>&1
for i in $(seq 1 20); do N=$(browser_pid); [ -n "$N" ] && { echo "relaunched $N"; exit; }; sleep 0.5; done
echo "error: chromium did not come back"`;
	const result = (await ssh(script, 40_000)).toString().trim();
	const failed = result.startsWith('error');
	out({ ok: !failed, result }, failed ? 1 : 0);
}

const SW_STATUS = `(async () => {
	const regs = navigator.serviceWorker ? await navigator.serviceWorker.getRegistrations() : [];
	return {
		controlled: !!(navigator.serviceWorker && navigator.serviceWorker.controller),
		registrations: regs.map((r) => ({ scope: r.scope, active: r.active?.state ?? null, waiting: !!r.waiting, installing: !!r.installing })),
		caches: await caches.keys()
	};
})()`;
const SW_RESET = `(async () => {
	const regs = navigator.serviceWorker ? await navigator.serviceWorker.getRegistrations() : [];
	const unregistered = await Promise.all(regs.map((r) => r.unregister()));
	const keys = await caches.keys();
	await Promise.all(keys.map((k) => caches.delete(k)));
	return { unregistered: unregistered.length, cachesDeleted: keys };
})()`;

async function sw() {
	const action = args[1] ?? 'status';
	if (!['status', 'reset'].includes(action)) die(`unknown sw action ${action}`);
	await withPage(async (session) => {
		if (action === 'status') out({ ok: true, ...(await evaluate(session, SW_STATUS, 8000)) });
		const result = await evaluate(session, SW_RESET, 8000);
		await session.send('Page.enable');
		const loaded = waitForLoad(session, 20_000);
		await session.send('Page.reload', { ignoreCache: true });
		out({ ok: true, ...result, reloaded: await loaded });
	});
}

async function logs() {
	const lines = Number(opt('lines', '100'));
	const text = // Our own SSH and sudo lines are noise when the session user is also the SSH user.
		(
			await ssh(
				`${REMOTE_PRELUDE}\nU=$(id -u "\${OWNER:-$(id -un)}")\n{ sudo -n journalctl _UID=$U -n ${lines * 10} --no-pager 2>&1 || journalctl --user -n ${lines * 10} --no-pager 2>&1; } | grep -vE ' (sshd-session|sshd|sudo)\\[' | tail -n ${lines}`
			)
		).toString();
	out({ ok: true, lines: text.trimEnd().split('\n') });
}

const commands = {
	doctor,
	screenshot,
	trace,
	reload,
	restart,
	sw,
	logs,
	eval: () =>
		withPage(async (session) =>
			out({ ok: true, value: await evaluate(session, args[1] ?? 'location.href') })
		),
	tunnel: async () => {
		const t = await tunnel();
		process.stdout.write(
			JSON.stringify({
				ok: true,
				port: t.port,
				devtools: `http://127.0.0.1:${t.port}`,
				browser: t.version.Browser
			}) + '\n'
		);
		await new Promise(() => {}); // held until Ctrl-C
	}
};

const command = args[0];
if (!command || command === 'help' || command === '--help') {
	process.stdout.write(HELP + '\n');
	process.exit(command ? 0 : 2);
}
if (!commands[command]) die(`unknown command ${command}; try help`);
if (!host) die('set KIOSK_HOST (user@host) or pass --host');
commands[command]().catch(die);
