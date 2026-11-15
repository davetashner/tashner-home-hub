/**
 * Grown-up challenges (hub-t27j.11): an adult sets a custom drawing prompt for one kid. It shows on
 * the board's banner in place of the daily prompt until that kid posts a drawing or taps Done.
 * One challenge per kid; setting another replaces it.
 */
export interface Challenge {
	id: string;
	memberId: string;
	text: string;
}

export const CHALLENGE_MAX_LENGTH = 80;
export const CHALLENGE_MAX_COUNT = 20;

const clean = (v: unknown): string => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '');

/** The stored list: junk entries, repeats and extra challenges for one kid are dropped. */
export function parseChallenges(raw: unknown): Challenge[] {
	if (!Array.isArray(raw)) return [];
	const out: Challenge[] = [];
	const kids = new Set<string>();
	for (const item of raw) {
		if (!item || typeof item !== 'object') continue;
		const { id, memberId } = item as Record<string, unknown>;
		const text = clean((item as Record<string, unknown>).text);
		if (typeof id !== 'string' || !id || typeof memberId !== 'string' || !memberId) continue;
		if (!text || text.length > CHALLENGE_MAX_LENGTH || kids.has(memberId)) continue;
		kids.add(memberId);
		out.push({ id, memberId, text });
		if (out.length === CHALLENGE_MAX_COUNT) break;
	}
	return out;
}

/** A request body { memberId, text } as a clean value, or the reason it is not one. */
export function parseChallengeInput(body: unknown): { memberId: string; text: string } | string {
	const b = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
	if (typeof b.memberId !== 'string' || !b.memberId) return 'memberId is required';
	const text = clean(b.text);
	if (!text) return 'text is required';
	if (text.length > CHALLENGE_MAX_LENGTH)
		return `text must be ${CHALLENGE_MAX_LENGTH} characters or fewer`;
	return { memberId: b.memberId, text };
}

/** The list with `next` in it, replacing that kid's earlier challenge. */
export function setChallenge(list: readonly Challenge[], next: Challenge): Challenge[] {
	return [...list.filter((c) => c.memberId !== next.memberId), next].slice(-CHALLENGE_MAX_COUNT);
}

export const removeChallenge = (list: readonly Challenge[], id: string): Challenge[] =>
	list.filter((c) => c.id !== id);

export const clearForMember = (list: readonly Challenge[], memberId: string): Challenge[] =>
	list.filter((c) => c.memberId !== memberId);

/** Challenges for kids who are on the board's list, so a removed kid's challenge never shows. */
export const visibleChallenges = (
	list: readonly Challenge[],
	people: readonly { id: string }[]
): Challenge[] => list.filter((c) => people.some((p) => p.id === c.memberId));
