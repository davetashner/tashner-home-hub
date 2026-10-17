/** Game list storage (hub-wzg): one JSON value in the settings table. Rules: `#lib/domain/games.js`. */
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import {
	checkNewGame,
	checkPatch,
	GAMES_SETTING_KEY,
	MAX_GAMES,
	moveGame,
	parseGames,
	type Game
} from '#lib/domain/games.js';
import type { Db } from '../db/index.js';

/** A database or an open transaction on it. */
type Conn = Pick<Db, 'select' | 'insert'>;
import { settings } from '../db/schema.js';
import { LedgerError } from './ledger.js';

/** `hubOrigin` (the request's origin) drops any stored game on the hub itself. */
export function listGames(db: Conn, hubOrigin?: string): Game[] {
	const row = db.select().from(settings).where(eq(settings.key, GAMES_SETTING_KEY)).get();
	try {
		return parseGames(row ? JSON.parse(row.value) : [], hubOrigin);
	} catch {
		return [];
	}
}

function save(db: Conn, games: Game[]): void {
	const value = JSON.stringify(games);
	db.insert(settings)
		.values({ key: GAMES_SETTING_KEY, value })
		.onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: Date.now() } })
		.run();
}

const invalid = (msg: string) => new LedgerError('invalid', msg);

export function createGame(db: Db, raw: Record<string, unknown>, hubOrigin?: string): Game {
	return db.transaction((tx) => {
		const checked = checkNewGame(raw, hubOrigin);
		if (!checked.ok) throw invalid(checked.error);
		const games = listGames(tx);
		if (games.length >= MAX_GAMES) throw invalid(`at most ${MAX_GAMES} games`);
		const game = { id: randomUUID(), ...checked.value };
		save(tx, [...games, game]);
		return game;
	});
}

/** Body: any of { title, url, image } and/or { move: -1 | 1 } to reorder. */
export function updateGame(
	db: Db,
	id: string,
	raw: Record<string, unknown>,
	hubOrigin?: string
): Game {
	return db.transaction((tx) => {
		const checked = checkPatch(raw, hubOrigin);
		if (!checked.ok) throw invalid(checked.error);
		if (raw.move !== undefined && raw.move !== -1 && raw.move !== 1)
			throw invalid('move must be -1 or 1');
		let games = listGames(tx);
		const existing = games.find((g) => g.id === id);
		if (!existing) throw new LedgerError('not_found', 'Game not found');
		const updated = { ...existing, ...checked.value };
		games = games.map((g) => (g.id === id ? updated : g));
		if (raw.move !== undefined) games = moveGame(games, id, raw.move);
		save(tx, games);
		return updated;
	});
}

export function deleteGame(db: Db, id: string): { id: string } {
	return db.transaction((tx) => {
		const games = listGames(tx);
		if (!games.some((g) => g.id === id)) throw new LedgerError('not_found', 'Game not found');
		save(
			tx,
			games.filter((g) => g.id !== id)
		);
		return { id };
	});
}
