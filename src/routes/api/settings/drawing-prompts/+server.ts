import { error, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '#lib/server/db/index.js';
import { requireAdult } from '#lib/server/auth.js';
import { readJson } from '#lib/server/api.js';
import { localDate } from '#lib/domain/kid-chores.js';
import { parsePromptsEnabled, parsePromptsPatch } from '#lib/domain/drawing-prompts.js';
import { householdTimeZone } from '#lib/server/household.js';
import type { RequestHandler } from './$types';

const KEY = 'drawing.prompts';

function read(): boolean {
	const row = getDb().select().from(schema.settings).where(eq(schema.settings.key, KEY)).get();
	if (!row) return true;
	try {
		return parsePromptsEnabled(JSON.parse(row.value));
	} catch {
		return true;
	}
}

/** { enabled, date }: `date` is the household's local day, so every device picks the same prompt. */
export const GET: RequestHandler = () =>
	json({ enabled: read(), date: localDate(Date.now(), householdTimeZone(getDb())) });

/** Adult only. Body: { enabled: boolean }. Daily drawing prompts are on unless turned off. */
export const PUT: RequestHandler = async (event) => {
	requireAdult(event);
	const enabled = parsePromptsPatch(await readJson(event.request));
	if (typeof enabled === 'string') error(400, enabled);
	const value = JSON.stringify(enabled);
	getDb()
		.insert(schema.settings)
		.values({ key: KEY, value })
		.onConflictDoUpdate({ target: schema.settings.key, set: { value, updatedAt: Date.now() } })
		.run();
	return json({ enabled: read() });
};
