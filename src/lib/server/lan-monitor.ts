import { eq } from 'drizzle-orm';
import { Cron } from 'croner';
import { Socket } from 'node:net';
import { getDb, type Db } from './db/index.js';
import { settings } from './db/schema.js';
import {
	DISCOVERY_PORTS,
	classifyConnect,
	decideAlerts,
	mergeSeen,
	parseSeen,
	subnetHosts,
	type Alerted,
	type SeenHost,
	mergeSweep,
	parseDevices,
	parseNestStatus,
	parseSnapshot,
	type NetDevice,
	type NetSnapshot,
	type Observation
} from '#lib/domain/lan-monitor.js';
import { notifyNetwork } from './notify.js';
import { parseLayout, type DeviceView, type NetLayout } from '#lib/domain/net-layout.js';

/** The household's devices: runtime data only (NET-1). Never seeded from the repo. */
export const DEVICES_KEY = 'network.devices';
export const STATUS_KEY = 'network.status';
/** The house floor plan and device placement (NET-3): runtime data only. */
export const LAYOUT_KEY = 'network.layout';
const ALERTED_KEY = 'network.alerted';
const SEEN_KEY = 'network.seen';
const IGNORED_KEY = 'network.ignored';
const DISCOVERY_EVERY_MIN = 15;
const TIMEOUT_MS = 2500;

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
/** Opens a TCP connection; resolves null on connect, or the error code it failed with. */
export type Connect = (ip: string, port: number, timeoutMs: number) => Promise<string | null>;

function readJson(db: Db, key: string): unknown {
	const row = db.select().from(settings).where(eq(settings.key, key)).get();
	if (!row) return null;
	try {
		return JSON.parse(row.value);
	} catch {
		return null;
	}
}

function writeJson(db: Db, key: string, value: unknown): void {
	const json = JSON.stringify(value);
	db.insert(settings)
		.values({ key, value: json })
		.onConflictDoUpdate({ target: settings.key, set: { value: json, updatedAt: Date.now() } })
		.run();
}

export const readDevices = (db: Db): NetDevice[] => parseDevices(readJson(db, DEVICES_KEY));
export const readStatus = (db: Db): NetSnapshot | null => parseSnapshot(readJson(db, STATUS_KEY));

/** Replaces the device list with the valid entries of `raw`; returns what was kept. */
export function saveDevices(db: Db, raw: unknown): NetDevice[] {
	const list = parseDevices(raw);
	writeJson(db, DEVICES_KEY, list);
	return list;
}

export const tcpConnect: Connect = (ip, port, timeoutMs) =>
	new Promise((resolve) => {
		const sock = new Socket();
		const done = (code: string | null) => {
			sock.destroy();
			resolve(code);
		};
		sock.setTimeout(timeoutMs, () => done('ETIMEDOUT'));
		sock.once('connect', () => done(null));
		sock.once('error', (e: NodeJS.ErrnoException) => done(e.code ?? 'EUNKNOWN'));
		sock.connect(port, ip);
	});

/** Checks one device. Never throws: a failure is an observation of "down". */
export async function probeDevice(
	dev: NetDevice,
	doFetch: Fetch,
	connect: Connect
): Promise<Observation> {
	const start = Date.now();
	if (dev.probe.kind === 'nest') {
		try {
			const res = await doFetch(`http://${dev.ip}/api/v1/status`, {
				signal: AbortSignal.timeout(TIMEOUT_MS)
			});
			const nest = res.ok ? parseNestStatus(await res.json()) : null;
			// Something answered HTTP, so the host is up even if the page wasn't a Nest status.
			return { reach: 'up', ms: Date.now() - start, ...(nest ? { nest } : {}) };
		} catch {
			return { reach: 'down' };
		}
	}
	const reach = classifyConnect(await connect(dev.ip, dev.probe.port, TIMEOUT_MS));
	return reach === 'up' ? { reach, ms: Date.now() - start } : { reach };
}

/** Probes every listed device in parallel and stores the merged snapshot. */
export async function sweepNetwork(
	db: Db,
	doFetch: Fetch = fetch,
	connect: Connect = tcpConnect,
	now: () => number = Date.now
): Promise<NetSnapshot> {
	const devices = readDevices(db);
	const results = await Promise.all(
		devices.map(async (d) => [d.id, await probeDevice(d, doFetch, connect)] as const)
	);
	const prev = readStatus(db);
	const at = now();
	const snap = mergeSweep(prev, devices, new Map(results), at);
	writeJson(db, STATUS_KEY, snap);
	const alerted = (readJson(db, ALERTED_KEY) ?? {}) as Alerted;
	const decided = decideAlerts(prev, snap, devices, alerted, at);
	writeJson(db, ALERTED_KEY, decided.alerted);
	if (decided.notices.length) notifyNetwork(db, decided.notices);
	return snap;
}

export const readLayout = (db: Db): NetLayout | null => parseLayout(readJson(db, LAYOUT_KEY));

/** Replaces the floor plan with the valid parts of `raw`; null (nothing saved) when it isn't a layout. */
export function saveLayout(db: Db, raw: unknown): NetLayout | null {
	const layout = parseLayout(raw);
	if (layout) writeJson(db, LAYOUT_KEY, layout);
	return layout;
}

const readIgnored = (db: Db): string[] => {
	const raw = readJson(db, IGNORED_KEY);
	return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : [];
};

/** Hosts seen on the LAN that aren't listed or ignored. */
export function readUnknown(db: Db): SeenHost[] {
	const skip = new Set([...readDevices(db).map((d) => d.ip), ...readIgnored(db)]);
	return parseSeen(readJson(db, SEEN_KEY)).filter((h) => !skip.has(h.ip));
}

/** Stops listing a host under "New on the network". */
export function ignoreHost(db: Db, ip: string): void {
	writeJson(db, IGNORED_KEY, [...new Set([...readIgnored(db), ip])].slice(-256));
}

/**
 * Looks for hosts in the router's /24 that answer on a common port. 32 hosts at a time with a
 * short timeout, so a pass takes well under a minute. Results feed "New on the network".
 */
export async function discoverHosts(
	db: Db,
	connect: Connect = tcpConnect,
	now: () => number = Date.now
): Promise<SeenHost[]> {
	const devices = readDevices(db);
	const anchor = devices.find((d) => d.probe.kind === 'nest') ?? devices[0];
	if (!anchor) return [];
	const hosts = [anchor.ip, ...subnetHosts(anchor.ip)];
	const found = new Map<string, number>();
	let next = 0;
	const worker = async () => {
		while (next < hosts.length) {
			const ip = hosts[next++];
			for (const port of DISCOVERY_PORTS) {
				if (classifyConnect(await connect(ip, port, 500)) === 'up') {
					found.set(ip, port);
					break;
				}
			}
		}
	};
	await Promise.all(Array.from({ length: 32 }, worker));
	const skip = new Set([...devices.map((d) => d.ip), ...readIgnored(db)]);
	const seen = mergeSeen(parseSeen(readJson(db, SEEN_KEY)), found, skip, now());
	writeJson(db, SEEN_KEY, seen);
	return seen;
}

export interface NetworkView {
	unknown: SeenHost[];
	layout: NetLayout | null;
	devices: DeviceView[];
	checkedAt: number | null;
}

/** The last sweep joined to the device list. Reads only the database; never waits on the LAN. */
export function getNetwork(db: Db): NetworkView {
	const snap = readStatus(db);
	const byId = new Map((snap?.devices ?? []).map((d) => [d.id, d]));
	return {
		devices: readDevices(db).map((d) => ({ ...d, state: byId.get(d.id) ?? null })),
		checkedAt: snap?.checkedAt ?? null,
		layout: readLayout(db),
		unknown: readUnknown(db)
	};
}

/** Every minute, sweeps the LAN. HUB_LAN_MONITOR=off turns it off; nothing runs with no devices listed. */
export function startLanMonitor(env: NodeJS.ProcessEnv = process.env): Cron | undefined {
	if (env.HUB_LAN_MONITOR === 'off') return undefined;
	const tick = () => {
		const db = getDb();
		if (readDevices(db).length === 0) return;
		void sweepNetwork(db).catch(() => undefined);
		if (new Date().getMinutes() % DISCOVERY_EVERY_MIN === 0)
			void discoverHosts(db).catch(() => undefined);
	};
	return new Cron('* * * * *', { protect: true, catch: true }, tick);
}
