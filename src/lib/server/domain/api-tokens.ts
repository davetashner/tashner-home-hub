/** Per-device bearer tokens for Siri / Shortcuts (hub-6tr). Only a SHA-256 hash is ever stored. */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import { TOKEN_NAME_MAX, TOKEN_SCOPES, isScope, type SiriScope } from '#lib/domain/siri.js';
import type { Db } from '../db/index.js';
import { apiTokens } from '../db/schema.js';
import { LedgerError } from './ledger.js';

export interface TokenView {
	id: string;
	name: string;
	scopes: SiriScope[];
	createdAt: number;
	lastUsedAt: number | null;
}

const invalid = (m: string) => new LedgerError('invalid', m);

export const hashToken = (token: string): string =>
	createHash('sha256').update(token).digest('hex');

function view(r: typeof apiTokens.$inferSelect): TokenView {
	let scopes: SiriScope[] = [];
	try {
		const parsed: unknown = JSON.parse(r.scopes);
		if (Array.isArray(parsed)) scopes = parsed.filter(isScope);
	} catch {
		// a corrupt row grants nothing
	}
	return {
		id: r.id,
		name: r.name,
		scopes,
		createdAt: r.createdAt,
		lastUsedAt: r.lastUsedAt
	};
}

export function listTokens(db: Db): TokenView[] {
	return db.select().from(apiTokens).orderBy(desc(apiTokens.createdAt)).all().map(view);
}

/** Creates a token. The plaintext is returned here once and can never be read back. */
export function createToken(db: Db, name: unknown, scopes: unknown): TokenView & { token: string } {
	const n = typeof name === 'string' ? name.replace(/\s+/g, ' ').trim() : '';
	if (n.length < 1 || n.length > TOKEN_NAME_MAX)
		throw invalid(`Name must be 1-${TOKEN_NAME_MAX} characters`);
	if (!Array.isArray(scopes) || scopes.length === 0 || !scopes.every(isScope))
		throw invalid(`Pick at least one of: ${TOKEN_SCOPES.join(', ')}`);
	const token = randomBytes(32).toString('base64url');
	const row = db
		.insert(apiTokens)
		.values({
			id: randomUUID(),
			name: n,
			tokenHash: hashToken(token),
			scopes: JSON.stringify([...new Set(scopes)])
		})
		.returning()
		.get();
	return { ...view(row), token };
}

/** Revoking deletes the row, so the token stops working at once. */
export function revokeToken(db: Db, id: string): { id: string } {
	const gone = db.delete(apiTokens).where(eq(apiTokens.id, id)).returning().all();
	if (gone.length === 0) throw new LedgerError('not_found', 'Token not found');
	return { id };
}

/** Finds the token a bearer secret belongs to (constant-time hash compare) and stamps last use. */
export function verifyToken(db: Db, secret: string, now = Date.now()): TokenView | null {
	const hash = hashToken(secret);
	const row = db.select().from(apiTokens).where(eq(apiTokens.tokenHash, hash)).get();
	if (!row) return null;
	const a = Buffer.from(row.tokenHash, 'hex');
	const b = Buffer.from(hash, 'hex');
	if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
	db.update(apiTokens).set({ lastUsedAt: now }).where(eq(apiTokens.id, row.id)).run();
	return { ...view(row), lastUsedAt: now };
}
