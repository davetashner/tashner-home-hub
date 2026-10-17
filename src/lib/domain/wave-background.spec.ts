import { describe, expect, it } from 'vitest';
import {
	canvasSize,
	dueForFrame,
	isSoftwareRenderer,
	parseColor,
	parseWaveChoice,
	parseWavePatch,
	renderScale,
	resolvePalette,
	waveShape
} from './wave-background.js';

describe('choice and palette', () => {
	it('parses unknown values to auto', () => {
		expect(parseWaveChoice('sorbet')).toBe('sorbet');
		expect(parseWaveChoice('nope')).toBe('auto');
		expect(parseWaveChoice(undefined)).toBe('auto');
	});
	it('validates a PUT body', () => {
		expect(parseWavePatch({ choice: 'off' })).toEqual({ choice: 'off' });
		expect(parseWavePatch({ choice: 'x' })).toMatch(/choice must be/);
	});
	it('matches the palette to the theme', () => {
		expect(resolvePalette('off', 'light')).toBeNull();
		expect(resolvePalette('off', 'night')).toBeNull();
		expect(resolvePalette('seafoam', 'night')).toBe('night');
		expect(resolvePalette('seafoam', 'light')).toBe('seafoam');
		expect(resolvePalette('night', 'light')).toBe('dusk');
		expect(resolvePalette('auto', 'light')).toBe('dusk');
	});
});

describe('shader numbers', () => {
	it('uses the chosen defaults', () => {
		expect(waveShape.amp).toBeCloseTo(0.1125);
		expect(waveShape.cols).toBe(105);
		expect(waveShape.rows).toBe(11);
		expect(waveShape.dot).toBeCloseTo(0.0016 * 0.4 * Math.sqrt(120 / 105));
	});
	it('sizes the canvas with dpr, scale and the 3840 cap', () => {
		expect(canvasSize(1000, 500, 1, 0.6)).toEqual({ width: 600, height: 300 });
		expect(canvasSize(1000, 500, 3, 0.5)).toEqual({ width: 1000, height: 500 });
		expect(canvasSize(7000, 4000, 2, 1)).toEqual({ width: 3840, height: 2194 });
		expect(canvasSize(0, 0, 0, 0.5)).toEqual({ width: 2, height: 2 });
		expect(renderScale(true)).toBeLessThan(renderScale(false));
	});
	it('gates frames to 30 fps', () => {
		expect(dueForFrame(100, 80)).toBe(false);
		expect(dueForFrame(114, 80)).toBe(true);
		expect(dueForFrame(50, 0, 60)).toBe(true);
	});
});

it('spots software renderers', () => {
	expect(isSoftwareRenderer('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device))')).toBe(true);
	expect(isSoftwareRenderer('V3D 7.1')).toBe(false);
});

describe('parseColor', () => {
	it('reads hex and oklch', () => {
		expect(parseColor('#fff')).toEqual([1, 1, 1]);
		expect(parseColor(' #000000 ')).toEqual([0, 0, 0]);
		const white = parseColor('oklch(100% 0 0)')!;
		white.forEach((v) => expect(v).toBeCloseTo(1, 2));
		const red = parseColor('oklch(62.8% 0.258 29.2)')!;
		expect(red[0]).toBeCloseTo(1, 1);
		expect(red[1]).toBeLessThan(0.1);
		expect(parseColor('oklch(0% 0 0)')).toEqual([0, 0, 0]);
	});
	it('rejects what it cannot read', () => {
		expect(parseColor('')).toBeNull();
		expect(parseColor('banana')).toBeNull();
		expect(parseColor('oklch(a b c)')).toBeNull();
	});
});
