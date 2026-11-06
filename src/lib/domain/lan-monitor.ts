/**
 * Home network monitor (NET-1): the pure part. Parses Nest Wifi status pages, classifies TCP
 * probes, and folds each sweep into per-device state. The real device list (names, IPs) is
 * household data and lives only in the runtime settings table, never in this repo.
 */

/** How a device is checked. Nest units answer `/api/v1/status`; anything else gets a TCP probe. */
export type Probe = { kind: 'nest' } | { kind: 'tcp'; port: number };

export interface NetDevice {
	id: string;
	name: string;
	ip: string;
	probe: Probe;
}

export interface NestStatus {
	model: string;
	/** `root` is the router; `leaf` a mesh point. */
	role: 'root' | 'leaf' | 'unknown';
	uptimeS: number;
	/** Ethernet link on the unit's WAN (globe) port. */
	wanLink: boolean;
	/** Ethernet link on the unit's LAN port. */
	lanLink: boolean;
	/** Only the router reports internet reachability; null for points. */
	online: boolean | null;
	software: string;
}

export type Reach = 'up' | 'down';

export interface Observation {
	reach: Reach;
	/** Round trip in ms when up. */
	ms?: number;
	nest?: NestStatus;
}

export interface DeviceState {
	id: string;
	reach: Reach | 'unknown';
	/** When `reach` last changed (ms epoch); the start of the current up or down spell. */
	since: number;
	lastSeen: number | null;
	ms: number | null;
	nest: NestStatus | null;
	/** Set when a Nest unit's uptime went backwards: it restarted. */
	restartedAt: number | null;
}

export interface NetSnapshot {
	checkedAt: number;
	devices: DeviceState[];
}

const IP_RE = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/i;
const MAX_DEVICES = 64;

const isObj = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

/** True for an RFC 1918 IPv4 address: the monitor never probes anything outside the LAN. */
export function isPrivateIp(ip: string): boolean {
	if (!IP_RE.test(ip)) return false;
	const [a, b] = ip.split('.').map(Number);
	return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function parseProbe(raw: unknown): Probe | null {
	if (!isObj(raw)) return null;
	if (raw.kind === 'nest') return { kind: 'nest' };
	if (
		raw.kind === 'tcp' &&
		Number.isInteger(raw.port) &&
		(raw.port as number) > 0 &&
		(raw.port as number) < 65536
	)
		return { kind: 'tcp', port: raw.port as number };
	return null;
}

/** Validates the stored device list, dropping malformed or non-LAN entries and duplicate ids. */
export function parseDevices(raw: unknown): NetDevice[] {
	if (!Array.isArray(raw)) return [];
	const out: NetDevice[] = [];
	const seen = new Set<string>();
	for (const d of raw) {
		if (out.length >= MAX_DEVICES) break;
		if (!isObj(d)) continue;
		const { id, name, ip } = d;
		if (typeof id !== 'string' || !ID_RE.test(id) || seen.has(id)) continue;
		if (typeof ip !== 'string' || !isPrivateIp(ip)) continue;
		const probe = parseProbe(d.probe);
		if (!probe) continue;
		const label = typeof name === 'string' && name.trim() ? name.trim().slice(0, 60) : id;
		seen.add(id);
		out.push({ id, name: label, ip, probe });
	}
	return out;
}

/** Reads a Nest Wifi unit's `/api/v1/status` body. Null when it isn't one. */
export function parseNestStatus(raw: unknown): NestStatus | null {
	if (!isObj(raw) || !isObj(raw.system)) return null;
	const sys = raw.system;
	const wan = isObj(raw.wan) ? raw.wan : {};
	const sw = isObj(raw.software) ? raw.software : {};
	if (typeof sys.uptime !== 'number' || !Number.isFinite(sys.uptime)) return null;
	const role = sys.groupRole === 'root' || sys.groupRole === 'leaf' ? sys.groupRole : 'unknown';
	return {
		model: typeof sys.modelId === 'string' ? sys.modelId : 'unknown',
		role,
		uptimeS: Math.max(0, Math.floor(sys.uptime)),
		wanLink: wan.ethernetLink === true,
		lanLink: sys.lan0Link === true,
		online: role === 'root' ? wan.online === true : null,
		software: typeof sw.softwareVersion === 'string' ? sw.softwareVersion : ''
	};
}

/**
 * A TCP connect answers "is the host there?" without ICMP, which a container can't send.
 * A refused connection still came from a live host; silence or no route means it's gone.
 */
export function classifyConnect(errorCode: string | null): Reach {
	if (errorCode === null || errorCode === 'ECONNREFUSED' || errorCode === 'ECONNRESET') return 'up';
	return 'down';
}

/** Folds one sweep into the previous state. Devices no longer listed are dropped. */
export function mergeSweep(
	prev: NetSnapshot | null,
	devices: NetDevice[],
	obs: Map<string, Observation>,
	now: number
): NetSnapshot {
	const before = new Map((prev?.devices ?? []).map((d) => [d.id, d]));
	const next: DeviceState[] = [];
	for (const dev of devices) {
		const old = before.get(dev.id);
		const o = obs.get(dev.id);
		if (!o) {
			next.push(
				old ?? {
					id: dev.id,
					reach: 'unknown',
					since: now,
					lastSeen: null,
					ms: null,
					nest: null,
					restartedAt: null
				}
			);
			continue;
		}
		const changed = !old || old.reach !== o.reach;
		const nest = o.nest ?? (o.reach === 'down' ? (old?.nest ?? null) : null);
		let restartedAt = old?.restartedAt ?? null;
		if (o.nest && old?.nest && o.nest.uptimeS < old.nest.uptimeS)
			restartedAt = now - o.nest.uptimeS * 1000;
		next.push({
			id: dev.id,
			reach: o.reach,
			since: changed ? now : old.since,
			lastSeen: o.reach === 'up' ? now : (old?.lastSeen ?? null),
			ms: o.reach === 'up' ? (o.ms ?? null) : null,
			nest,
			restartedAt
		});
	}
	return { checkedAt: now, devices: next };
}

/** Parses a stored snapshot defensively; null when it is missing or the wrong shape. */
export function parseSnapshot(raw: unknown): NetSnapshot | null {
	if (!isObj(raw) || typeof raw.checkedAt !== 'number' || !Array.isArray(raw.devices)) return null;
	const devices = raw.devices.filter(
		(d): d is DeviceState =>
			isObj(d) &&
			typeof d.id === 'string' &&
			(d.reach === 'up' || d.reach === 'down' || d.reach === 'unknown') &&
			typeof d.since === 'number'
	);
	return { checkedAt: raw.checkedAt, devices };
}

/** Counts for a one-line summary: how many are up, down, or not checked yet. */
export function summarize(snap: NetSnapshot | null): { up: number; down: number; unknown: number } {
	const s = { up: 0, down: 0, unknown: 0 };
	for (const d of snap?.devices ?? []) s[d.reach]++;
	return s;
}
