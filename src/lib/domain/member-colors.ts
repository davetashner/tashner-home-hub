/** Member color token names (`--color-member-N` in layout.css). Stored in `members.color`. */
export const MEMBER_COLORS = [
	'member-1',
	'member-2',
	'member-3',
	'member-4',
	'member-5',
	'member-6'
] as const;

export type MemberColor = (typeof MEMBER_COLORS)[number];

export function isMemberColor(value: unknown): value is MemberColor {
	return typeof value === 'string' && (MEMBER_COLORS as readonly string[]).includes(value);
}
