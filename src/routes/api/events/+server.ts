import { error } from '@sveltejs/kit';
import { formatEvent, parseTopics, subscribe, type Listener } from '#lib/server/domain/events.js';
import type { RequestHandler } from './$types';

const HEARTBEAT_MS = 25_000;

/**
 * `GET /api/events?topics=lists`: a server-sent-events stream. Behind the LAN-only hook like every
 * route. A comment line every 25 s keeps proxies (Caddy) from idling the connection out.
 */
export const GET: RequestHandler = ({ url, request }) => {
	const topics = parseTopics(url.searchParams.get('topics'));
	if (topics.length === 0) error(400, 'topics must name at least one known topic');
	const enc = new TextEncoder();
	let cleanup = () => {};
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			const send: Listener = (e) => controller.enqueue(enc.encode(formatEvent(e)));
			const unsub = subscribe(topics, send);
			if (!unsub) {
				controller.close();
				return;
			}
			const beat = setInterval(() => controller.enqueue(enc.encode(': hb\n\n')), HEARTBEAT_MS);
			cleanup = () => {
				clearInterval(beat);
				unsub();
			};
			request.signal.addEventListener('abort', () => {
				cleanup();
				try {
					controller.close();
				} catch {
					// Already closed.
				}
			});
			// `retry` sets the browser's own reconnect delay; the first frame also flushes headers.
			controller.enqueue(enc.encode('retry: 3000\n: connected\n\n'));
		},
		cancel() {
			cleanup();
		}
	});
	return new Response(stream, {
		headers: {
			'content-type': 'text/event-stream',
			'cache-control': 'no-store, no-transform',
			'x-accel-buffering': 'no',
			connection: 'keep-alive'
		}
	});
};
