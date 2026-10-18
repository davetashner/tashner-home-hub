import { describe, expect, it } from 'vitest';
import {
	scanSpeakers,
	speakerResponse,
	speakerStatus,
	SpeakerError,
	testSpeaker,
	useSpeaker,
	type SpeakerDeps
} from './speaker.js';

const env = { HUB_KIOSK_SPEAKER_URL: 'http://kiosk.example:8742/', HUB_KIOSK_SPEAKER_TOKEN: 'tok' };
const MAC = 'AA:BB:CC:DD:EE:01';

/** A fake Pi: records each request and answers with `reply(path)`. */
function pi(reply: (path: string, body: unknown) => Response | Promise<Response>) {
	const calls: { url: string; method: string; auth: string | null; body: unknown }[] = [];
	const deps: SpeakerDeps = {
		env,
		fetch: (async (url: string, init: RequestInit) => {
			const body = init.body ? JSON.parse(String(init.body)) : undefined;
			calls.push({
				url,
				method: init.method ?? 'GET',
				auth: new Headers(init.headers).get('authorization'),
				body
			});
			return reply(new URL(url).pathname, body);
		}) as typeof fetch
	};
	return { calls, deps };
}
const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('speaker status', () => {
	it('reads the Pi with the token and keeps only known fields', async () => {
		const { calls, deps } = pi(() =>
			ok({ state: 'connected', mac: MAC, name: 'Synthetic Speaker', defaultSink: true, x: 1 })
		);
		expect(await speakerStatus(deps)).toEqual({
			state: 'connected',
			mac: MAC,
			name: 'Synthetic Speaker',
			defaultSink: true
		});
		expect(calls).toEqual([
			{
				url: 'http://kiosk.example:8742/speaker',
				method: 'GET',
				auth: 'Bearer tok',
				body: undefined
			}
		]);
	});

	it('repairs nonsense from the Pi', async () => {
		const { deps } = pi(() => ok({ state: 'exploded', mac: 'nope', name: 7 }));
		expect(await speakerStatus(deps)).toEqual({
			state: 'none',
			mac: null,
			name: null,
			defaultSink: false
		});
	});

	it('never throws: missing config, a wrong token and a dead Pi each have a state', async () => {
		expect((await speakerStatus({ env: {} })).state).toBe('not_configured');
		expect((await speakerStatus({ env: { ...env, HUB_KIOSK_SPEAKER_URL: 'ftp://x' } })).state).toBe(
			'not_configured'
		);
		expect((await speakerStatus(pi(() => ok({ error: 'unauthorized' }, 401)).deps)).state).toBe(
			'not_configured'
		);
		expect((await speakerStatus(pi(() => ok({}, 500)).deps)).state).toBe('unreachable');
		const down = pi(() => Promise.reject(new TypeError('fetch failed')));
		expect((await speakerStatus(down.deps)).state).toBe('unreachable');
	});
});

describe('speaker actions', () => {
	it('scans and cleans the device list', async () => {
		const { deps } = pi(() =>
			ok({
				devices: [
					{
						mac: 'aa:bb:cc:dd:ee:01',
						name: 'Synthetic Speaker',
						kind: 'speaker',
						bars: 9,
						rssi: -50
					},
					{
						mac: 'AA:BB:CC:DD:EE:02',
						name: 'Synthetic Phone',
						kind: 'phone',
						bars: 2,
						paired: true
					},
					{ mac: 'AA:BB:CC:DD:EE:03', name: 'Thing', kind: 'toaster', bars: 'x' },
					{ mac: 'bad', name: 'Nope' },
					{ mac: 'AA:BB:CC:DD:EE:04', name: '' }
				]
			})
		);
		expect(await scanSpeakers(deps)).toEqual([
			{
				mac: MAC,
				name: 'Synthetic Speaker',
				kind: 'speaker',
				bars: 4,
				paired: false,
				connected: false
			},
			{
				mac: 'AA:BB:CC:DD:EE:02',
				name: 'Synthetic Phone',
				kind: 'phone',
				bars: 2,
				paired: true,
				connected: false
			},
			{
				mac: 'AA:BB:CC:DD:EE:03',
				name: 'Thing',
				kind: 'other',
				bars: 0,
				paired: false,
				connected: false
			}
		]);
		expect(await scanSpeakers(pi(() => ok({})).deps)).toEqual([]);
	});

	it('uses a speaker by its address and passes the Pi’s reason through when it fails', async () => {
		const { calls, deps } = pi((path, body) =>
			(body as { mac: string }).mac === MAC
				? ok({ state: 'connected', mac: MAC, name: 'Synthetic Speaker', defaultSink: true })
				: ok({ error: 'Could not pair. Is the speaker in pairing mode? (Failed to pair: x)' }, 409)
		);
		expect((await useSpeaker(' aa:bb:cc:dd:ee:01 ', deps)).state).toBe('connected');
		expect(calls[0]).toMatchObject({ method: 'POST', body: { mac: MAC } });
		await expect(useSpeaker('AA:BB:CC:DD:EE:09', deps)).rejects.toMatchObject({
			code: 'failed',
			message: 'Could not pair. Is the speaker in pairing mode?'
		});
		await expect(useSpeaker('nope', deps)).rejects.toMatchObject({ code: 'invalid' });
		await expect(useSpeaker(42, deps)).rejects.toMatchObject({ code: 'invalid' });
		expect(calls).toHaveLength(2);
	});

	it('plays the test sound, and a 409 without a message still explains itself', async () => {
		const good = pi(() => ok({ ok: true }));
		await expect(testSpeaker(good.deps)).resolves.toBeUndefined();
		expect(good.calls[0].url).toBe('http://kiosk.example:8742/speaker/test');
		await expect(
			testSpeaker(pi(() => new Response('x', { status: 409 })).deps)
		).rejects.toMatchObject({ code: 'failed', message: 'The speaker did not respond' });
		await expect(testSpeaker({ env: {} })).rejects.toMatchObject({ code: 'not_configured' });
	});
});

describe('speakerResponse', () => {
	it('maps errors to statuses the UI can show, and rethrows anything else', async () => {
		const res = await speakerResponse(async () => {
			throw new SpeakerError('failed', 'Speaker off');
		});
		expect(res.status).toBe(409);
		expect(await res.json()).toEqual({ code: 'failed', message: 'Speaker off' });
		const codes = ['not_configured', 'unreachable', 'invalid'] as const;
		const statuses = await Promise.all(
			codes.map(
				async (c) => (await speakerResponse(() => Promise.reject(new SpeakerError(c, c)))).status
			)
		);
		expect(statuses).toEqual([503, 502, 400]);
		expect((await speakerResponse(async () => ({ ok: true }))).status).toBe(200);
		await expect(speakerResponse(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
	});
});
