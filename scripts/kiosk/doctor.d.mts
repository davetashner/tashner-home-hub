export declare const KIOSK_UNITS: string[];
export declare const REMOTE_PRELUDE: string;
export declare const PAGE_PROBE: string;
export declare const PAGE_FETCH_PROBE: string;

export interface Output {
	output: string;
	name: string;
	enabled: boolean | null;
	mode: string | null;
	transform: string | null;
}
export interface RemoteFacts {
	host: string | null;
	owner: string | null;
	chromium: string | null;
	emoji: number;
	outputs: Output[];
	units: Record<string, string>;
	health: string | null;
	/** Absent when the remote script had no session section. */
	session?: SessionFacts;
	/** Absent when the remote script had no recovery section. */
	recovery?: RecoveryFacts;
	/** Absent when the remote script had no wake section. */
	wake?: WakeFacts;
	/** Absent unless kiosk.conf has CEC_MODE=also. */
	cec?: CecFacts;
	/** Absent when the remote script had no speaker section. */
	speaker?: SpeakerFacts;
	/** Absent unless kiosk.conf has SPOTIFY_CONNECT=on. */
	spotify?: SpotifyFacts;
}
export interface SessionFacts {
	/** The kiosk user exists on the Pi (install.sh has run). */
	kioskUser: boolean;
	/** The kiosk user has a login session. */
	kiosk: boolean;
	/** Other (non-greeter) users with a session on seat0. */
	others: string[];
}
export interface RecoveryFacts {
	/** active | inactive | failed | not-installed | unknown: hub-kiosk-session-recovery.timer. */
	timer: string;
}
export interface SpotifyFacts {
	/** systemctl is-active of hub-kiosk-librespot.service. */
	unit: string;
	/** A cached login exists (the one-time setup is done). */
	credentials: boolean;
	/** "Hub" is advertised over mDNS; null when avahi-browse is missing. */
	advertised: boolean | null;
}
export interface CecFacts {
	device: string;
	/** The CEC device node exists on the Pi. */
	present: boolean;
	backend: string | null;
}
export interface WakeFacts {
	input: string;
	/** Names of the input devices the display agent has open. */
	devices: string[];
}
export interface SpeakerFacts {
	mac: string | null;
	name: string | null;
	paired: boolean;
	connected: boolean;
	defaultSink: boolean;
}
export interface PageFacts {
	url: string;
	readyState: string;
	hydrated: boolean;
	swControlled: boolean;
	webdriver: boolean;
	wave: { palette: string | null; canvas: boolean; drawn: boolean; bodyClear: boolean } | null;
}
export interface Facts {
	remote?: RemoteFacts;
	sshError?: string;
	devtools?: string;
	devtoolsError?: string;
	page?: PageFacts;
	pageError?: string;
	pageFetch?: { result: number | string; ms: number };
	displayRole?: string | null;
}
export interface Check {
	check: string;
	status: 'pass' | 'warn' | 'fail';
	detail: string;
	hint?: string;
}

export declare function remoteFactsScript(hubOrigin: string | null): string;
export declare function parseSections(text: string): Record<string, string>;
export declare function remoteFacts(text: string): RemoteFacts;
export declare function parseFlags(cmdline: string): {
	passwordStore: string | true | null;
	debugPort: string | true | null;
	appId: string | true | null;
	kiosk: boolean;
	automation: boolean;
};
export declare function parseWake(text: string): WakeFacts;
export declare function parseSpotify(text: string): SpotifyFacts;
export declare function parseSpeaker(text: string): SpeakerFacts;
export declare function parseWlrRandr(text: string): Output[];
export declare function diagnose(facts: Facts): Check[];
export declare function summarize(checks: Check[]): {
	ok: boolean;
	pass: number;
	warn: number;
	fail: number;
};
export declare function parseCec(text: string): CecFacts;
