import { describe, expect, it } from 'vitest';
import {
	DESTINATIONS,
	TODO_FALLBACK,
	destinationIndex,
	destinationsFor,
	isActive,
	swipeTarget,
	todoLabel
} from './nav.js';

describe('nav', () => {
	it('lists the seven destinations in order', () => {
		expect(DESTINATIONS.map((d) => d.label)).toEqual([
			'Calendar',
			'To-Dos',
			'Photos',
			'Lists',
			'Meals',
			'Games',
			'Music'
		]);
	});

	it('matches exact and nested paths only', () => {
		expect(isActive('/chores', '/chores')).toBe(true);
		expect(isActive('/chores', '/chores/rotation')).toBe(true);
		expect(isActive('/chores', '/chores-old')).toBe(false);
		expect(destinationIndex('/')).toBe(-1);
		expect(destinationIndex('/photos')).toBe(2);
	});

	it('swipes to adjacent destinations', () => {
		expect(swipeTarget('/chores', 'left')).toBe('/photos');
		expect(swipeTarget('/chores', 'right')).toBe('/calendar');
	});

	it('does not wrap at the ends', () => {
		expect(swipeTarget('/calendar', 'right')).toBeNull();
		expect(swipeTarget('/meals', 'left')).toBe('/games');
		expect(swipeTarget('/games', 'left')).toBe('/music');
		expect(swipeTarget('/music', 'left')).toBeNull();
	});

	it('enters the strip from home and ignores other pages', () => {
		expect(swipeTarget('/', 'left')).toBe('/calendar');
		expect(swipeTarget('/', 'right')).toBe('/music');
		expect(swipeTarget('/settings', 'left')).toBeNull();
	});

	it('names the to-do list after the only child', () => {
		expect(todoLabel(['Robin'])).toBe("Robin's To-Dos");
		expect(todoLabel(['  Robin  '])).toBe("Robin's To-Dos");
		expect(todoLabel(['Chris'])).toBe("Chris's To-Dos");
	});

	it('falls back to To-Dos with no child or several', () => {
		expect(todoLabel([])).toBe(TODO_FALLBACK);
		expect(todoLabel(['   '])).toBe(TODO_FALLBACK);
		expect(todoLabel(['Robin', 'Sam'])).toBe('To-Dos');
	});

	it('relabels only the to-do destination', () => {
		const named = destinationsFor("Robin's To-Dos");
		expect(named.find((d) => d.id === 'chores')?.label).toBe("Robin's To-Dos");
		expect(named.map((d) => d.href)).toEqual(DESTINATIONS.map((d) => d.href));
		expect(named.filter((d) => d.id !== 'chores')).toEqual(
			DESTINATIONS.filter((d) => d.id !== 'chores')
		);
	});
});
