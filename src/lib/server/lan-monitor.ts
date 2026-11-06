import { eq } from 'drizzle-orm';
import { Cron } from 'croner';
import { Socket } from 'node:net';
import { getDb, type Db } from './db/index.js';
import { settings } from './db/schema.js';
import {
	classifyConnect,
	mergeSweep,
	parseDevices,
	parseNestStatus,
	parseSnapshot,
	type NetDevice,
	type NetSnapshot,
	type Observation
} from '#lib/domain/lan-monitor.js';

/** The household's devices: runtime data only (NET-1). Never seeded from the repo. */
export const DEVICES_KEY = 'network.devices';
export const STATUS_KEY = 'network.status';
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
	const snap = mergeSweep(readStatus(db), devices, new Map(results), now());
	writeJson(db, STATUS_KEY, snap);
	return snap;
}

export interface NetworkView {
	devices: (NetDevice & { state: NetSnapshot['devices'][number] | null })[];
	checkedAt: number | null;
}

/** The last sweep joined to the device list. Reads only the database; never waits on the LAN. */
export function getNetwork(db: Db): NetworkView {
	const snap = readStatus(db);
	const byId = new Map((snap?.devices ?? []).map((d) => [d.id, d]));
	return {
		devices: readDevices(db).map((d) => ({ ...d, state: byId.get(d.id) ?? null })),
		checkedAt: snap?.checkedAt ?? null
	};
}

/** Every minute, sweeps the LAN. HUB_LAN_MONITOR=off turns it off; nothing runs with no devices listed. */
export function startLanMonitor(env: NodeJS.ProcessEnv = process.env): Cron | undefined {
	if (env.HUB_LAN_MONITOR === 'off') return undefined;
	const tick = () => {
		const db = getDb();
		if (readDevices(db).length === 0) return;
		void sweepNetwork(db).catch(() => undefined);
	};
	return new Cron('* * * * *', { protect: true, catch: true }, tick);
}
