/**
 * Reward emoji (hub-3yn): the curated picker set and the single-emoji check shared by the
 * Settings > Rewards form and the rewards API.
 */
export interface EmojiChoice {
	emoji: string;
	label: string;
}

export const REWARD_EMOJI: readonly EmojiChoice[] = [
	{ emoji: '📖', label: 'Book' },
	{ emoji: '🎮', label: 'Video game' },
	{ emoji: '🍦', label: 'Ice cream' },
	{ emoji: '🍭', label: 'Candy' },
	{ emoji: '🍪', label: 'Treat' },
	{ emoji: '🍕', label: 'Pizza' },
	{ emoji: '🌳', label: 'Park' },
	{ emoji: '🎢', label: 'Outing' },
	{ emoji: '📺', label: 'Screen time' },
	{ emoji: '🎬', label: 'Movie' },
	{ emoji: '🧸', label: 'Toy' },
	{ emoji: '💵', label: 'Money' },
	{ emoji: '🛌', label: 'Sleepover' },
	{ emoji: '🎁', label: 'Gift' },
	{ emoji: '⚽', label: 'Sports' },
	{ emoji: '🎨', label: 'Art' },
	{ emoji: '🎵', label: 'Music' },
	{ emoji: '🏊', label: 'Swimming' },
	{ emoji: '🚲', label: 'Bike ride' },
	{ emoji: '🐶', label: 'Pet' },
	{ emoji: '🎂', label: 'Cake' },
	{ emoji: '⭐', label: 'Star' },
	{ emoji: '🏆', label: 'Trophy' },
	{ emoji: '🛍️', label: 'Shopping' }
];

const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });

/** True when `v` is exactly one emoji grapheme (flags and keycaps included). */
export function isSingleEmoji(v: unknown): v is string {
	return (
		typeof v === 'string' &&
		[...segmenter.segment(v)].length === 1 &&
		/\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u.test(v)
	);
}

/** Trimmed emoji, or null when blank; undefined when the text is not a single emoji. */
export function cleanEmoji(v: string): string | null | undefined {
	const t = v.trim();
	if (t === '') return null;
	return isSingleEmoji(t) ? t : undefined;
}
