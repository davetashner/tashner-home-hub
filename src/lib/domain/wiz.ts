/**
 * WiZ smart bulbs on the LAN. They answer JSON over UDP port 38899 with no account or key, so the
 * server can find and drive them directly. Bulbs are remembered by MAC because DHCP moves IPs.
 */
export const WIZ_PORT = 38899;
export const NAME_MAX = 40;
/** WiZ refuses brightness below 10%. */
export const DIM_MIN = 10;
export const DIM_MAX = 100;

/** The colours offered on the Lights page: whites by colour temperature, the rest by RGB. */
export const COLORS = [
	{ id: 'warm', label: 'Warm white', emoji: '🕯️', params: { temp: 2700 } },
	{ id: 'daylight', label: 'Daylight', emoji: '☀️', params: { temp: 4200 } },
	{ id: 'cool', label: 'Cool white', emoji: '❄️', params: { temp: 6500 } },
	{ id: 'red', label: 'Red', emoji: '🔴', params: { r: 255, g: 0, b: 0 } },
	{ id: 'orange', label: 'Orange', emoji: '🟠', params: { r: 255, g: 110, b: 0 } },
	{ id: 'yellow', label: 'Yellow', emoji: '🟡', params: { r: 255, g: 200, b: 0 } },
	{ id: 'green', label: 'Green', emoji: '🟢', params: { r: 0, g: 255, b: 0 } },
	{ id: 'blue', label: 'Blue', emoji: '🔵', params: { r: 0, g: 0, b: 255 } },
	{ id: 'purple', label: 'Purple', emoji: '🟣', params: { r: 140, g: 0, b: 255 } }
] as const;
export type ColorId = (typeof COLORS)[number]['id'];

export function isColorId(v: unknown): v is ColorId {
	return COLORS.some((c) => c.id === v);
}

/** Which offered colour a bulb is showing, if any (a scene or a custom colour is null). */
function colorOf(r: Record<string, unknown>): ColorId | null {
	if (r.sceneId !== undefined && r.sceneId !== 0) return null;
	const hit = COLORS.find((c) => Object.entries(c.params).every(([k, v]) => r[k] === v));
	return hit?.id ?? null;
}

export const GET_PILOT = JSON.stringify({ method: 'getPilot', params: {} });

export interface WizBulb {
	mac: string;
	ip: string;
	name: string;
}

/** What a bulb says about itself right now. */
export interface Pilot {
	mac: string;
	on: boolean;
	dimming: number;
	color: ColorId | null;
}

/** A remembered bulb plus its live state; `reachable` is false when it did not answer. */
export interface BulbView extends WizBulb {
	reachable: boolean;
	on: boolean;
	dimming: number;
	color: ColorId | null;
}

export interface BulbChange {
	on?: boolean;
	dimming?: number;
	color?: ColorId;
}

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** Twelve lowercase hex digits, from any common MAC spelling; null if it is not a MAC. */
export function normMac(v: unknown): string | null {
	if (typeof v !== 'string') return null;
	const hex = v.toLowerCase().replace(/[:-]/g, '');
	return /^[0-9a-f]{12}$/.test(hex) ? hex : null;
}

export function isIpv4(v: unknown): v is string {
	const m = typeof v === 'string' ? IPV4.exec(v) : null;
	return !!m && m.slice(1).every((p) => Number(p) <= 255);
}

export function isDimming(v: unknown): v is number {
	return Number.isInteger(v) && (v as number) >= DIM_MIN && (v as number) <= DIM_MAX;
}

export function cleanName(v: unknown): string | null {
	if (typeof v !== 'string') return null;
	const name = v.trim().replace(/\s+/g, ' ');
	return name.length > 0 && name.length <= NAME_MAX ? name : null;
}

/** The stored bulb list, keeping only valid entries and the first of any repeated MAC. */
export function parseBulbs(raw: unknown): WizBulb[] {
	if (!Array.isArray(raw)) return [];
	const out: WizBulb[] = [];
	for (const item of raw) {
		if (!item || typeof item !== 'object') continue;
		const r = item as Record<string, unknown>;
		const mac = normMac(r.mac);
		const name = cleanName(r.name);
		if (!mac || !isIpv4(r.ip) || !name || out.some((b) => b.mac === mac)) continue;
		out.push({ mac, ip: r.ip, name });
	}
	return out;
}

function parseResult(text: string): Record<string, unknown> | null {
	try {
		const msg: unknown = JSON.parse(text);
		const result = (msg as { result?: unknown } | null)?.result;
		return result && typeof result === 'object' ? (result as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}

/** A getPilot reply, or null for anything else (errors, other devices, garbage). */
export function parsePilot(text: string): Pilot | null {
	const r = parseResult(text);
	const mac = normMac(r?.mac);
	if (!r || !mac || typeof r.state !== 'boolean') return null;
	const dimming = isDimming(r.dimming) ? r.dimming : DIM_MAX;
	return { mac, on: r.state, dimming, color: colorOf(r) };
}

/** True when a setPilot reply says the bulb took the change. */
export function isSuccess(text: string): boolean {
	return parseResult(text)?.success === true;
}

export function setPilotMessage(change: BulbChange): string {
	const params: Record<string, unknown> = {};
	if (change.on !== undefined) params.state = change.on;
	if (change.dimming !== undefined) params.dimming = change.dimming;
	const color = COLORS.find((c) => c.id === change.color);
	if (color) Object.assign(params, color.params);
	return JSON.stringify({ method: 'setPilot', params });
}

/**
 * Folds bulbs that answered a search into the remembered list: known MACs get their new IP and keep
 * their name, new ones are added as "Light N" with the first free number.
 */
export function mergeFound(stored: WizBulb[], found: { mac: string; ip: string }[]): WizBulb[] {
	const out = stored.map((b) => ({ ...b }));
	for (const f of found) {
		const known = out.find((b) => b.mac === f.mac);
		if (known) {
			known.ip = f.ip;
			continue;
		}
		let n = 1;
		while (out.some((b) => b.name === `Light ${n}`)) n++;
		out.push({ mac: f.mac, ip: f.ip, name: `Light ${n}` });
	}
	return out;
}

/** Joins the remembered bulbs with the pilots that answered, in the remembered order. */
export function bulbViews(bulbs: WizBulb[], pilots: Pilot[]): BulbView[] {
	return bulbs.map((b) => {
		const p = pilots.find((x) => x.mac === b.mac);
		return p
			? { ...b, reachable: true, on: p.on, dimming: p.dimming, color: p.color }
			: { ...b, reachable: false, on: false, dimming: DIM_MAX, color: null };
	});
}
