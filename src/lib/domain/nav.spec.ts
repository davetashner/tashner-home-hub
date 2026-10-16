import { describe, expect, it } from 'vitest';
import { DESTINATIONS, destinationIndex, isActive, swipeTarget } from './nav.js';

describe('nav', () => {
	it('lists the five destinations in order', () => {
		expect(DESTINATIONS.map((d) => d.label)).toEqual([
			'Calendar',
			'Chores',
			'Photos',
			'Lists',
			'Meals'
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
		expect(swipeTarget('/meals', 'left')).toBeNull();
	});

	it('enters the strip from home and ignores other pages', () => {
		expect(swipeTarget('/', 'left')).toBe('/calendar');
		expect(swipeTarget('/', 'right')).toBe('/meals');
		expect(swipeTarget('/settings', 'left')).toBeNull();
	});
});
