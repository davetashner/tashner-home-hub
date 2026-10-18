/** In-process pub/sub behind `GET /api/events` (ADR 0001: SSE for live updates). */

export const EVENT_TOPICS = ['lists', 'timers'] as const;
export type EventTopic = (typeof EVENT_TOPICS)[number];

/** What changed, never why or by whom. Clients refetch; the payload only says where to look. */
export interface HubEvent {
	/** Monotonic per process; lets a client ignore a replayed or out-of-order event. */
	id: number;
	topic: EventTopic;
	data: Record<string, string>;
}

export type Listener = (event: HubEvent) => void;

export const MAX_SUBSCRIBERS = 50;

const subscribers = new Set<{ topics: ReadonlySet<EventTopic>; fn: Listener }>();
let seq = 0;

/** Keeps only known topics, de-duplicated; unknown names are dropped. */
export function parseTopics(raw: string | null): EventTopic[] {
	const known = new Set<string>(EVENT_TOPICS);
	return [...new Set((raw ?? '').split(','))].filter((t): t is EventTopic => known.has(t));
}

/** Returns an unsubscribe function, or null when the connection cap is reached. */
export function subscribe(topics: readonly EventTopic[], fn: Listener): (() => void) | null {
	if (subscribers.size >= MAX_SUBSCRIBERS) return null;
	const sub = { topics: new Set(topics), fn };
	subscribers.add(sub);
	return () => void subscribers.delete(sub);
}

/** Delivers to every subscriber of the topic; one failing listener never blocks the others. */
export function publish(topic: EventTopic, data: Record<string, string> = {}): void {
	const event: HubEvent = { id: ++seq, topic, data };
	for (const sub of [...subscribers]) {
		if (!sub.topics.has(topic)) continue;
		try {
			sub.fn(event);
		} catch {
			subscribers.delete(sub);
		}
	}
}

export const subscriberCount = (): number => subscribers.size;

/** One SSE frame. */
export function formatEvent(e: HubEvent): string {
	return `id: ${e.id}\nevent: ${e.topic}\ndata: ${JSON.stringify(e.data)}\n\n`;
}
