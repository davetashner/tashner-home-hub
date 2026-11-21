import { createSocket } from 'node:dgram';
import { networkInterfaces } from 'node:os';
import { eq } from 'drizzle-orm';
import type { Db } from './db/index.js';
import { settings } from './db/schema.js';
import { readDevices } from './lan-monitor.js';
import { isPrivateIp, subnetHosts } from '#lib/domain/lan-monitor.js';
import {
	GET_PILOT,
	WIZ_PORT,
	bulbViews,
	isSuccess,
	mergeFound,
	parseBulbs,
	parsePilot,
	setPilotMessage,
	type BulbChange,
	type BulbView,
	type Pilot,
	type WizBulb
} from '#lib/domain/wiz.js';

/** The remembered bulbs (runtime data only: names and MACs never live in the repo). */
export const BULBS_KEY = 'lights.wiz';
const STATE_WAIT_MS = 1200;
const SEARCH_WAIT_MS = 2500;

export interface Reply {
	ip: string;
	text: string;
}
/** Sends `msg` to every target and collects the replies that arrive within `waitMs`. */
export type Exchange = (msg: string, targets: string[], waitMs: number) => Promise<Reply[]>;

export class LightError extends Error {
	constructor(
		readonly code: 'not_found' | 'unreachable',
		message: string
	) {
		super(message);
	}
}

/** UDP to the WiZ port; broadcast allowed. Send failures to one target never stop the rest. */
export function udpExchange(port = WIZ_PORT): Exchange {
	return (msg, targets, waitMs) =>
		new Promise((resolve) => {
			const replies: Reply[] = [];
			const sock = createSocket('udp4');
			const finish = () => {
				sock.close();
				resolve(replies);
			};
			sock.on('message', (buf, from) => replies.push({ ip: from.address, text: buf.toString() }));
			sock.on('error', finish);
			sock.bind(0, () => {
				sock.setBroadcast(true);
				for (const ip of targets) sock.send(msg, port, ip, () => {});
				setTimeout(finish, waitMs);
			});
		});
}

export function readBulbs(db: Db): WizBulb[] {
	const row = db.select().from(settings).where(eq(settings.key, BULBS_KEY)).get();
	try {
		return parseBulbs(row ? JSON.parse(row.value) : []);
	} catch {
		return [];
	}
}

function saveBulbs(db: Db, bulbs: WizBulb[]): void {
	const value = JSON.stringify(bulbs);
	db.insert(settings)
		.values({ key: BULBS_KEY, value })
		.onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: Date.now() } })
		.run();
}

/**
 * Where to look: the LAN broadcast, plus every host in the /24 of a known LAN device or a private
 * interface. The unicast sweep matters when the container's network does not pass broadcasts.
 */
export function searchTargets(db: Db, ifaces = networkInterfaces()): string[] {
	const anchors = readDevices(db).map((d) => d.ip);
	for (const list of Object.values(ifaces))
		for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) anchors.push(a.address);
	const anchor = anchors.find(isPrivateIp);
	return ['255.255.255.255', ...(anchor ? [anchor, ...subnetHosts(anchor)] : [])];
}

async function pilots(exchange: Exchange, targets: string[], waitMs: number) {
	const replies = await exchange(GET_PILOT, targets, waitMs);
	const out: (Pilot & { ip: string })[] = [];
	for (const r of replies) {
		const p = parsePilot(r.text);
		if (p && !out.some((x) => x.mac === p.mac)) out.push({ ...p, ip: r.ip });
	}
	return out;
}

/** The remembered bulbs with whatever state they report right now. */
export async function lightStates(db: Db, exchange: Exchange): Promise<BulbView[]> {
	const bulbs = readBulbs(db);
	if (bulbs.length === 0) return [];
	const found = await pilots(exchange, [...new Set(bulbs.map((b) => b.ip))], STATE_WAIT_MS);
	return bulbViews(bulbs, found);
}

/** Searches the LAN, remembers new bulbs and new IPs, and returns every bulb's state. */
export async function searchLights(
	db: Db,
	exchange: Exchange,
	targets = searchTargets(db)
): Promise<BulbView[]> {
	const found = await pilots(exchange, targets, SEARCH_WAIT_MS);
	const bulbs = mergeFound(readBulbs(db), found);
	saveBulbs(db, bulbs);
	return bulbViews(bulbs, found);
}

export function renameLight(db: Db, mac: string, name: string): WizBulb {
	const bulbs = readBulbs(db);
	const bulb = bulbs.find((b) => b.mac === mac);
	if (!bulb) throw new LightError('not_found', 'No light with that MAC');
	bulb.name = name;
	saveBulbs(db, bulbs);
	return bulb;
}

/** Switches or dims one bulb; throws `unreachable` when it does not confirm. */
export async function changeLight(
	db: Db,
	mac: string,
	change: BulbChange,
	exchange: Exchange
): Promise<void> {
	const bulb = readBulbs(db).find((b) => b.mac === mac);
	if (!bulb) throw new LightError('not_found', 'No light with that MAC');
	const replies = await exchange(setPilotMessage(change), [bulb.ip], STATE_WAIT_MS);
	if (!replies.some((r) => r.ip === bulb.ip && isSuccess(r.text)))
		throw new LightError('unreachable', `${bulb.name} did not answer. Try Find lights.`);
}

export function forgetLight(db: Db, mac: string): void {
	saveBulbs(
		db,
		readBulbs(db).filter((b) => b.mac !== mac)
	);
}
