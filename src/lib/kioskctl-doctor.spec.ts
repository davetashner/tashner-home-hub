import { describe, expect, it } from 'vitest';
import {
	diagnose,
	parseFlags,
	parseSpeaker,
	parseWlrRandr,
	remoteFacts,
	remoteFactsScript,
	summarize,
	type Facts,
	type PageFacts,
	type RemoteFacts
} from '../../scripts/kiosk/doctor.mjs';

const WLR = `HDMI-A-1 "Synthetic TV (HDMI-A-1)"
  Enabled: yes
  Modes:
    1920x1080 px, 60.000000 Hz
    3840x2160 px, 60.000000 Hz (preferred, current)
  Transform: normal
  Scale: 1.000000`;

const CMDLINE =
	'/usr/lib/chromium/chromium --password-store=basic --profile-directory=Default --app-id=abc --remote-debugging-port=9222';

const remote = (over: Partial<RemoteFacts> = {}): RemoteFacts => ({
	host: 'kiosk',
	owner: 'kiosk',
	chromium: CMDLINE,
	emoji: 1,
	outputs: parseWlrRandr(WLR),
	units: { 'hub-kiosk.service': 'active' },
	health: '200 0.050',
	...over
});
const page = (over: Partial<PageFacts> = {}): PageFacts => ({
	url: 'https://hub.example/',
	readyState: 'complete',
	hydrated: true,
	swControlled: true,
	webdriver: false,
	wave: { palette: 'dusk', canvas: true, drawn: true, bodyClear: true },
	...over
});
const healthy = (over: Partial<Facts> = {}): Facts => ({
	remote: remote(),
	devtools: 'Chrome/155',
	page: page(),
	pageFetch: { result: 200, ms: 20 },
	displayRole: 'wall',
	...over
});
const status = (facts: Facts, check: string) => diagnose(facts).find((c) => c.check === check);

describe('parsers', () => {
	it('reads the current mode and transform from wlr-randr', () => {
		expect(parseWlrRandr(WLR)).toEqual([
			{
				output: 'HDMI-A-1',
				name: 'Synthetic TV (HDMI-A-1)',
				enabled: true,
				mode: '3840x2160@60',
				transform: 'normal'
			}
		]);
	});

	it('reads the flags that matter from a Chromium command line', () => {
		expect(parseFlags(CMDLINE)).toEqual({
			passwordStore: 'basic',
			debugPort: '9222',
			appId: 'abc',
			kiosk: false,
			automation: false
		});
		expect(parseFlags('chromium --kiosk --headless=new')).toMatchObject({
			kiosk: true,
			automation: true,
			passwordStore: null
		});
	});

	it('turns the remote script output into facts', () => {
		const text = `=== host\nkiosk\n=== owner\nkiosk\n=== chromium\n${CMDLINE}\n\n=== emoji\n2\n=== wlr\n${WLR}\n=== units\nhub-kiosk.service active\nhub-kiosk-watchdog.timer inactive\n=== health\n200 0.031\n\n=== end`;
		expect(remoteFacts(text)).toEqual({
			host: 'kiosk',
			owner: 'kiosk',
			chromium: CMDLINE,
			emoji: 2,
			outputs: parseWlrRandr(WLR),
			units: { 'hub-kiosk.service': 'active', 'hub-kiosk-watchdog.timer': 'inactive' },
			health: '200 0.031'
		});
		expect(remoteFacts('=== health\nnone')).toMatchObject({
			health: null,
			chromium: null,
			emoji: 0,
			outputs: []
		});
	});

	it('reads the chosen speaker and whether it is the default sink', () => {
		const info = `mac aa:bb:cc:dd:ee:01\n\tAlias: Shower Speaker\n\tPaired: yes\n\tConnected: yes\ndefault node.name = "bluez_output.AA_BB_CC_DD_EE_01.1"`;
		expect(parseSpeaker(info)).toEqual({
			mac: 'AA:BB:CC:DD:EE:01',
			name: 'Shower Speaker',
			paired: true,
			connected: true,
			defaultSink: true
		});
		expect(parseSpeaker('mac \ndefault ')).toMatchObject({ mac: null, connected: false });
		expect(remoteFacts('=== speaker\nmac \n=== end').speaker).toMatchObject({ mac: null });
		expect(remoteFacts('=== host\nkiosk').speaker).toBeUndefined();
	});

	it('only probes the server when it knows where it is', () => {
		expect(remoteFactsScript('https://hub.example')).toContain("'https://hub.example/healthz'");
		expect(remoteFactsScript(null)).not.toContain('healthz');
		expect(remoteFactsScript("https://x.example'; rm -rf ~; '")).not.toContain('healthz');
		expect(remoteFactsScript('http://192.168.0.4:3000')).toContain(
			"'http://192.168.0.4:3000/healthz'"
		);
	});
});

describe('diagnose', () => {
	it('passes a healthy kiosk', () => {
		const checks = diagnose(healthy());
		expect(summarize(checks)).toEqual({ ok: true, pass: checks.length, warn: 0, fail: 0 });
	});

	it('stops at ssh when the Pi is unreachable', () => {
		expect(diagnose({ sshError: 'timed out' })).toEqual([
			expect.objectContaining({ check: 'ssh', status: 'fail', detail: 'timed out' })
		]);
	});

	it('fails a keyring-backed password store, and flags automation switches', () => {
		const facts = healthy({
			remote: remote({ chromium: '/usr/bin/chromium --enable-automation' })
		});
		expect(status(facts, 'password-store')).toMatchObject({
			status: 'fail',
			detail: 'keyring (default)'
		});
		expect(status(facts, 'automation-flags')?.status).toBe('fail');
		expect(status(healthy({ remote: remote({ chromium: null }) }), 'chromium')?.status).toBe(
			'fail'
		);
	});

	it('warns about the font, a sleeping screen and a kiosk that was never installed', () => {
		const facts = healthy({
			remote: remote({ emoji: 0, outputs: [], units: { 'hub-kiosk.service': '' } })
		});
		expect(status(facts, 'emoji-font')?.status).toBe('warn');
		expect(status(facts, 'display')?.status).toBe('warn');
		expect(status(facts, 'kiosk-units')?.status).toBe('warn');
	});

	it('fails each installed unit that is not active', () => {
		const facts = healthy({
			remote: remote({
				units: { 'hub-kiosk.service': 'active', 'hub-kiosk-watchdog.timer': 'failed' }
			})
		});
		expect(status(facts, 'hub-kiosk-watchdog.timer')).toMatchObject({
			status: 'fail',
			detail: 'failed'
		});
	});

	it('tells "curl works but Chromium hangs" apart from a server outage', () => {
		const hung = healthy({ pageFetch: { result: 'timeout', ms: 5000 } });
		expect(status(hung, 'browser-network')?.hint).toMatch(/curl works/);
		const down = healthy({
			remote: remote({ health: '000 5.0' }),
			pageFetch: { result: 'timeout', ms: 5000 }
		});
		expect(status(down, 'server-from-pi')?.status).toBe('fail');
		expect(status(down, 'browser-network')?.hint).toMatch(/unreachable/);
	});

	it('stops at DevTools or the page when they do not answer', () => {
		const noTools = diagnose(healthy({ devtools: undefined, devtoolsError: 'refused' }));
		expect(noTools.at(-1)).toMatchObject({ check: 'devtools', status: 'fail' });
		const noPage = diagnose(healthy({ page: undefined, pageError: 'Runtime.evaluate timed out' }));
		expect(noPage.at(-1)).toMatchObject({
			check: 'page',
			status: 'fail',
			detail: 'Runtime.evaluate timed out'
		});
	});

	it('fails a page that never finished loading or never hydrated', () => {
		const facts = healthy({ page: page({ readyState: 'loading', hydrated: false }) });
		expect(status(facts, 'page-load')?.status).toBe('fail');
		expect(status(facts, 'hydrated')?.status).toBe('fail');
	});

	it('explains why the wave is not showing', () => {
		const wave = (w: PageFacts['wave'], webdriver = false) =>
			status(healthy({ page: page({ wave: w, webdriver }) }), 'wave');
		const on = { palette: 'dusk', canvas: true, drawn: true, bodyClear: true };
		expect(wave(null)?.status).toBe('warn');
		expect(wave(on, true)?.detail).toMatch(/webdriver/);
		expect(wave({ ...on, canvas: false })?.detail).toMatch(/still gradient/);
		expect(wave({ ...on, drawn: false })?.status).toBe('fail');
		expect(wave({ ...on, bodyClear: false })).toMatchObject({
			status: 'fail',
			detail: expect.stringMatching(/covered/)
		});
	});

	it('reports the speaker, and fails one that is connected but not playing', () => {
		const sp = (over = {}) => ({
			mac: 'AA:BB:CC:DD:EE:01',
			name: 'Shower Speaker',
			paired: true,
			connected: true,
			defaultSink: true,
			...over
		});
		const check = (over: object | null) =>
			status(healthy({ remote: remote(over ? { speaker: sp(over) } : {}) }), 'speaker');
		expect(check(null)).toBeUndefined();
		expect(check({})).toMatchObject({ status: 'pass', detail: 'Shower Speaker connected' });
		expect(check({ mac: null })).toMatchObject({ status: 'warn', detail: 'none chosen' });
		expect(check({ paired: false, connected: false })).toMatchObject({ status: 'warn' });
		expect(check({ connected: false })).toMatchObject({ status: 'warn', hint: 'switch it on' });
		expect(check({ defaultSink: false })).toMatchObject({ status: 'fail' });
	});

	it('warns when this browser is not a wall display', () => {
		expect(status(healthy({ displayRole: null }), 'display-role')).toMatchObject({
			status: 'warn',
			detail: 'personal'
		});
		expect(status(healthy({ displayRole: undefined }), 'display-role')).toBeUndefined();
	});
});
