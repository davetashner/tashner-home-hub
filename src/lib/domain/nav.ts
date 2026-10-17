export type IconName = 'home' | 'calendar' | 'chores' | 'photos' | 'lists' | 'meals' | 'settings';

export type DestinationPath = '/calendar' | '/chores' | '/photos' | '/lists' | '/meals';

export interface Destination {
	id: string;
	label: string;
	href: DestinationPath;
	icon: IconName;
}

/** Main destinations in display order (UI-2). Swiping walks this order. */
export const DESTINATIONS: readonly Destination[] = [
	{
		id: 'calendar',
		label: 'Calendar',
		href: '/calendar',
		icon: 'calendar'
	},
	{ id: 'chores', label: 'To-Do List', href: '/chores', icon: 'chores' },
	{ id: 'photos', label: 'Photos', href: '/photos', icon: 'photos' },
	{ id: 'lists', label: 'Lists', href: '/lists', icon: 'lists' },
	{ id: 'meals', label: 'Meals', href: '/meals', icon: 'meals' }
];

export function isActive(href: string, pathname: string): boolean {
	return pathname === href || pathname.startsWith(`${href}/`);
}

/** Index of the destination owning `pathname`, or -1 (home, settings, unknown). */
export function destinationIndex(pathname: string): number {
	return DESTINATIONS.findIndex((d) => isActive(d.href, pathname));
}

/**
 * Where a swipe should go. Swiping left advances, right goes back. Home enters
 * the strip from either end; the ends do not wrap; non-strip pages (settings) stay put.
 */
export function swipeTarget(pathname: string, direction: 'left' | 'right'): DestinationPath | null {
	const last = DESTINATIONS.length - 1;
	if (pathname === '/') return DESTINATIONS[direction === 'left' ? 0 : last].href;
	const i = destinationIndex(pathname);
	if (i < 0) return null;
	const next = direction === 'left' ? i + 1 : i - 1;
	return DESTINATIONS[next]?.href ?? null;
}
