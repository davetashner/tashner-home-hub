import { error, json } from '@sveltejs/kit';
import { requireAdult } from '#lib/server/auth.js';
import { readJson } from '#lib/server/api.js';
import { applyAppearancePatch, parseAppearancePatch } from '#lib/domain/appearance.js';
import { readAppearance, writeAppearance } from '#lib/server/appearance.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () => json(readAppearance());

/**
 * Adult only. Partial body: { theme?: "light" | "dark" | "auto", eveningStart?: "HH:MM" (12:00 to
 * 23:59), dim?: 0.5-1 | null (null = no evening dimming) }.
 */
export const PUT: RequestHandler = async (event) => {
	requireAdult(event);
	const patch = parseAppearancePatch(await readJson(event.request));
	if (typeof patch === 'string') error(400, patch);
	writeAppearance(applyAppearancePatch(readAppearance(), patch));
	return json(readAppearance());
};
