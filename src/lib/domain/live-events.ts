import { shouldReconnect } from './live-resume.js';

/** The slice of EventSource the channel uses, so tests can fake it. */
export interface SourceLike {
	readyState: number;
	onopen: ((ev: never) => unknown) | null;
	onerror: ((ev: never) => unknown) | null;
	addEventListener(type: string, fn: (e: { data: string }) => void): void;
	close(): void;
}

export const BACKOFF_START_MS = 1_000;
export const BACKOFF_MAX_MS = 30_000;

/** Doubling delay with a ceiling: 1 s, 2 s, 4 s ... 30 s. */
export const backoffDelay = (attempt: number): number =>
	Math.min(BACKOFF_MAX_MS, BACKOFF_START_MS * 2 ** Math.max(0, attempt));

export interface LiveChannelOptions {
	url: string;
	topics: readonly string[];
	create: (url: string) => SourceLike;
	/** A change event arrived on one of the topics. */
	onEvent: (topic: string, data: Record<string, string>) => void;
	/** The stream is (re)established: refetch, since events may have been missed while down. */
	onOpen?: () => void;
	/** Connected or not; callers keep a slow fallback poll running while it is false. */
	onStatus?: (up: boolean) => void;
	setTimer?: (fn: () => void, ms: number) => unknown;
	clearTimer?: (id: unknown) => void;
}

/** An EventSource that reopens itself with backoff and when the page comes back. */
export function createLiveChannel(opts: LiveChannelOptions) {
	const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
	const clearTimer = opts.clearTimer ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
	let source: SourceLike | null = null;
	let timer: unknown = null;
	let attempt = 0;
	let stopped = true;

	const status = (up: boolean) => opts.onStatus?.(up);

	function drop() {
		source?.close();
		source = null;
	}

	function schedule() {
		if (stopped || timer !== null) return;
		timer = setTimer(() => {
			timer = null;
			open();
		}, backoffDelay(attempt++));
	}

	function open() {
		if (stopped) return;
		drop();
		if (timer !== null) {
			clearTimer(timer);
			timer = null;
		}
		const src = opts.create(`${opts.url}?topics=${encodeURIComponent(opts.topics.join(','))}`);
		source = src;
		src.onopen = () => {
			attempt = 0;
			status(true);
			opts.onOpen?.();
		};
		src.onerror = () => {
			status(false);
			// readyState 2: the browser gave up (HTTP error, or iOS killed it); retry ourselves.
			// Otherwise it is already retrying on its own.
			if (src.readyState === 2) {
				drop();
				schedule();
			}
		};
		for (const topic of opts.topics)
			src.addEventListener(topic, (e) => {
				let data: Record<string, string> = {};
				try {
					data = JSON.parse(e.data) as Record<string, string>;
				} catch {
					// A malformed frame still means "something changed".
				}
				opts.onEvent(topic, data);
			});
	}

	return {
		start() {
			stopped = false;
			attempt = 0;
			open();
		},
		/** Page visible again: reopen at once if the connection died while it was away. */
		resume() {
			if (stopped || !shouldReconnect(source?.readyState)) return;
			attempt = 0;
			open();
		},
		stop() {
			stopped = true;
			if (timer !== null) clearTimer(timer);
			timer = null;
			drop();
			status(false);
		}
	};
}
