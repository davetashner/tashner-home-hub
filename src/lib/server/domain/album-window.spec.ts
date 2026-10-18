import { describe, expect, it } from 'vitest';
import {
	albumShows,
	anyWindowOpen,
	isMonthDay,
	isWindowOpen,
	parseWindows,
	patchWindows,
	type AlbumRules
} from './album-window.js';

const june = { from: '06-01', to: '06-10' };
const newYear = { from: '12-28', to: '01-03' };

describe('isMonthDay', () => {
	it('accepts real calendar days only', () => {
		for (const ok of ['01-01', '02-29', '04-30', '12-31']) expect(isMonthDay(ok)).toBe(true);
		for (const bad of ['00-10', '13-01', '04-31', '02-30', '06-00', '6-1', '06-1', 601, null])
			expect(isMonthDay(bad)).toBe(false);
	});
});

describe('parseWindows', () => {
	it('keeps valid windows and drops the rest', () => {
		expect(parseWindows(undefined)).toEqual({});
		expect(parseWindows([june])).toEqual({});
		expect(
			parseWindows({ Anniversary: { ...june, extra: 1 }, Bad: { from: '06-01' }, Junk: 'x' })
		).toEqual({ Anniversary: june });
	});
});

describe('patchWindows', () => {
	it('sets, replaces and clears windows', () => {
		const set = patchWindows({}, { Anniversary: june });
		expect(set).toEqual({ Anniversary: june });
		expect(patchWindows({ Anniversary: june }, { Anniversary: newYear })).toEqual({
			Anniversary: newYear
		});
		expect(patchWindows({ Anniversary: june, Trip: newYear }, { Anniversary: null })).toEqual({
			Trip: newYear
		});
	});

	it('rejects bad input', () => {
		expect(patchWindows({}, null)).toMatch(/object/);
		expect(patchWindows({}, [june])).toMatch(/object/);
		expect(patchWindows({}, { '': june })).toMatch(/album names/);
		expect(patchWindows({}, { Anniversary: { from: '06-01', to: '06-31' } })).toMatch(/MM-DD/);
		expect(patchWindows({}, { Anniversary: 'june' })).toMatch(/MM-DD/);
	});
});

describe('isWindowOpen', () => {
	it('is inclusive at both ends', () => {
		expect(isWindowOpen(june, '05-31')).toBe(false);
		expect(isWindowOpen(june, '06-01')).toBe(true);
		expect(isWindowOpen(june, '06-10')).toBe(true);
		expect(isWindowOpen(june, '06-11')).toBe(false);
		expect(isWindowOpen({ from: '07-04', to: '07-04' }, '07-04')).toBe(true);
	});

	it('wraps the new year', () => {
		for (const d of ['12-28', '12-31', '01-01', '01-03'])
			expect(isWindowOpen(newYear, d)).toBe(true);
		for (const d of ['12-27', '01-04', '06-15']) expect(isWindowOpen(newYear, d)).toBe(false);
	});
});

describe('albumShows', () => {
	const rules = (selected: string[], windows = {}): AlbumRules => ({
		selected: (a) => selected.length === 0 || selected.includes(a),
		windows
	});
	const lib = rules([], { Anniversary: june });

	it('hides a windowed album outside its window and keeps the rest', () => {
		const takeover = anyWindowOpen([lib], '03-01');
		expect(takeover).toBe(false);
		expect(albumShows('Anniversary', lib, '03-01', takeover)).toBe(false);
		expect(albumShows('Trip', lib, '03-01', takeover)).toBe(true);
	});

	it('shows only windowed albums while a window is open', () => {
		const takeover = anyWindowOpen([lib], '06-05');
		expect(takeover).toBe(true);
		expect(albumShows('Anniversary', lib, '06-05', takeover)).toBe(true);
		expect(albumShows('Trip', lib, '06-05', takeover)).toBe(false);
	});

	it('never shows unticked albums, and an unticked window takes nothing over', () => {
		const off = rules(['Trip'], { Anniversary: june });
		const takeover = anyWindowOpen([off], '06-05');
		expect(takeover).toBe(false);
		expect(albumShows('Anniversary', off, '06-05', takeover)).toBe(false);
		expect(albumShows('Trip', off, '06-05', takeover)).toBe(true);
		expect(albumShows('Pets', off, '06-05', takeover)).toBe(false);
	});

	it('lets a window in one source take over every source', () => {
		const other = rules([]);
		const takeover = anyWindowOpen([other, lib], '06-05');
		expect(albumShows('Pets', other, '06-05', takeover)).toBe(false);
	});
});
