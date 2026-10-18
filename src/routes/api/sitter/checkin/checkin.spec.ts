import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, it, vi } from 'vitest';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'hub-sitter-checkin-'));

const { getDb } = await import('#lib/server/db/index.js');
const { createSession, listCheckins, currentSession, endSession } =
	await import('#lib/server/domain/sitter.js');
const { saveNotifyConfig } = await import('#lib/server/notify.js');
const { DEFAULT_NOTIFY } = await import('#lib/domain/notify.js');
const route = await import('./+server.js');

const post = (body: unknown) =>
	route.POST({
		request: new Request('http://example.com/api/sitter/checkin', {
			method: 'POST',
			body: JSON.stringify(body)
		}),
		locals: { adult: null }
	} as never) as Promise<Response>;

const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 200 }));
vi.stubGlobal('fetch', fetchMock);
afterAll(() => vi.unstubAllGlobals());

it('refuses with 409 when no session is active', async () => {
	const res = await post({ kind: 'all-good' });
	expect(res.status).toBe(409);
});

it('stores a check-in, returns { ok, at } and notifies the parents without an adult session', async () => {
	saveNotifyConfig(getDb(), { ...DEFAULT_NOTIFY, enabled: true, topic: 'topic_x' });
	const s = createSession(
		getDb(),
		{ endAt: Date.now() + 3_600_000, sitterName: 'Sam' },
		Date.now()
	);
	const res = await post({ kind: 'call-me' });
	expect(res.status).toBe(200);
	const body = await res.json();
	expect(body).toEqual({ ok: true, at: expect.any(Number) });
	expect(listCheckins(getDb(), s.id)).toEqual([{ kind: 'call-me', at: body.at }]);
	await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
	const init = fetchMock.mock.calls[0]![1] as RequestInit;
	expect(init.body).toBe('Please call the sitter (from Sam)');
	expect((init.headers as Record<string, string>).Priority).toBe('4');
});

it('rate limits a repeat of the same kind with 429, allows another kind, rejects bad kinds', async () => {
	const again = await post({ kind: 'call-me' });
	expect(again.status).toBe(429);
	expect(again.headers.get('retry-after')).not.toBeNull();
	expect((await post({ kind: 'in-bed' })).status).toBe(200);
	expect((await post({ kind: 'nope' })).status).toBe(400);
	await expect(post('not an object')).rejects.toMatchObject({ status: 400 });
});

it('refuses again once the session has ended', async () => {
	endSession(getDb(), currentSession(getDb(), Date.now())!.id, Date.now());
	expect((await post({ kind: 'all-good' })).status).toBe(409);
});
