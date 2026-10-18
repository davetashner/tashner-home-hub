/** Home Assistant -> wall display wake/sleep (hub-068, SLP-7). Pure helpers; no I/O. */

export const DISPLAY_REMOTE_PATH = '/api/display/remote';
export const DISPLAY_STATES = ['wake', 'sleep'] as const;
export type DisplayRemoteState = (typeof DISPLAY_STATES)[number];

/** Reads `{ state: "wake" | "sleep" }`; null for anything else. */
export function parseRemoteState(body: unknown): DisplayRemoteState | null {
	if (!body || typeof body !== 'object') return null;
	const s = (body as { state?: unknown }).state;
	return s === 'wake' || s === 'sleep' ? s : null;
}

export const TOKEN_PLACEHOLDER = '<paste the token>';

/** The configuration.yaml snippet an adult pastes into Home Assistant. */
export function restCommandYaml(origin: string, token: string | null): string {
	const auth = `Bearer ${token || TOKEN_PLACEHOLDER}`;
	const cmd = (name: string, state: DisplayRemoteState) =>
		[
			`  ${name}:`,
			`    url: "${origin}${DISPLAY_REMOTE_PATH}"`,
			`    method: POST`,
			`    headers:`,
			`      authorization: "${auth}"`,
			`    content_type: "application/json"`,
			`    payload: '{"state": "${state}"}'`
		].join('\n');
	return ['rest_command:', cmd('hub_wake_screen', 'wake'), cmd('hub_sleep_screen', 'sleep')].join(
		'\n'
	);
}
