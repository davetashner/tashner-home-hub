import type { SourceView } from '#lib/server/calendar/sources.js';
import type { MemberColor } from '#lib/domain/member-colors.js';

export type Source = SourceView;

export interface PersonOption {
	id: string;
	name: string;
	color: MemberColor;
	avatar: string | null;
}

export const GUIDE_BASE = 'https://github.com/davetashner/tashner-home-hub/blob/main/docs/setup';

export const field =
	'min-h-tap w-full rounded-control border-2 border-line bg-surface px-4 text-body text-ink';
