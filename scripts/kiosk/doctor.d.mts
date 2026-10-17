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
export declare function parseWlrRandr(text: string): Output[];
export declare function diagnose(facts: Facts): Check[];
export declare function summarize(checks: Check[]): {
	ok: boolean;
	pass: number;
	warn: number;
	fail: number;
};
