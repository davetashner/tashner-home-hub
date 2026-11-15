import { error, json } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { requireAdult } from '#lib/server/auth.js';
import { readJson } from '#lib/server/api.js';
import { parsePromptsPatch } from '#lib/domain/drawing-prompts.js';
import { gameStarsEnabled, setGameStarsEnabled } from '#lib/server/domain/drawing-stars.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () => json({ enabled: gameStarsEnabled(getDb()) });

/** Adult only. Body: { enabled: boolean }. Guess-game stars are on unless turned off. */
export const PUT: RequestHandler = async (event) => {
	requireAdult(event);
	const enabled = parsePromptsPatch(await readJson(event.request));
	if (typeof enabled === 'string') error(400, enabled);
	setGameStarsEnabled(getDb(), enabled);
	return json({ enabled: gameStarsEnabled(getDb()) });
};
