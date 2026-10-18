/** Sitter mode storage (hub-7pj): the encrypted info card. */
import { eq } from 'drizzle-orm';
import {
	emptyCard,
	joinCard,
	normalizeCard,
	splitCard,
	type PlainCard,
	type SensitiveCard,
	type SitterCard
} from '#lib/domain/sitter.js';
import type { Db } from '../db/index.js';
import { settings } from '../db/schema.js';
import { decryptSecret, encryptSecret, type Keyring } from './secrets.js';

export const SITTER_CARD_KEY = 'sitter.card';
const AAD = 'sitter.card';

interface Stored {
	plain: PlainCard;
	/** Encrypted JSON of the SensitiveCard. */
	sensitive: string;
}

export function readCard(db: Db, keyring: Keyring): SitterCard {
	const row = db.select().from(settings).where(eq(settings.key, SITTER_CARD_KEY)).get();
	if (!row) return emptyCard();
	try {
		const stored = JSON.parse(row.value) as Stored;
		const sensitive = JSON.parse(decryptSecret(keyring, stored.sensitive, AAD)) as SensitiveCard;
		return joinCard(stored.plain, sensitive);
	} catch {
		// Sealed with a key this server no longer has (e.g. a restore): start a fresh card.
		return emptyCard();
	}
}

export function saveCard(db: Db, keyring: Keyring, raw: unknown): SitterCard {
	const card = normalizeCard(raw);
	const { plain, sensitive } = splitCard(card);
	const stored: Stored = {
		plain,
		sensitive: encryptSecret(keyring, JSON.stringify(sensitive), AAD)
	};
	const value = JSON.stringify(stored);
	db.insert(settings)
		.values({ key: SITTER_CARD_KEY, value })
		.onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: Date.now() } })
		.run();
	return card;
}
