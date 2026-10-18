import { describe, expect, it } from 'vitest';
import { TOKEN_PLACEHOLDER, parseRemoteState, restCommandYaml } from './ha-display.js';

describe('parseRemoteState', () => {
	it('accepts wake and sleep only', () => {
		expect(parseRemoteState({ state: 'wake' })).toBe('wake');
		expect(parseRemoteState({ state: 'sleep' })).toBe('sleep');
		for (const bad of [null, undefined, 'wake', 3, {}, { state: 'on' }, { state: 1 }])
			expect(parseRemoteState(bad)).toBeNull();
	});
});

describe('restCommandYaml', () => {
	it('builds both commands with the token or a placeholder', () => {
		const y = restCommandYaml('http://hub.example.test', 'abc');
		expect(y).toContain('hub_wake_screen:');
		expect(y).toContain('hub_sleep_screen:');
		expect(y).toContain('url: "http://hub.example.test/api/display/remote"');
		expect(y).toContain('authorization: "Bearer abc"');
		expect(y).toContain(`payload: '{"state": "sleep"}'`);
		expect(restCommandYaml('http://hub.example.test', null)).toContain(TOKEN_PLACEHOLDER);
	});
});
