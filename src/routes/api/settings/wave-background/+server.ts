import { error, json } from '@sveltejs/kit';
import { requireAdult } from '#lib/server/auth.js';
import { readJson } from '#lib/server/api.js';
import { parseWavePatch } from '#lib/domain/wave-background.js';
import { readWaveBackground, writeWaveBackground } from '#lib/server/wave-background.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () => json({ choice: readWaveBackground() });

/** Adult only. Body: { choice: "auto" | "dusk" | "seafoam" | "sorbet" | "night" | "off" }. */
export const PUT: RequestHandler = async (event) => {
	requireAdult(event);
	const patch = parseWavePatch(await readJson(event.request));
	if (typeof patch === 'string') error(400, patch);
	writeWaveBackground(patch.choice);
	return json({ choice: readWaveBackground() });
};
