/**
 * Prompt starters, batch E (see drawing-starters.ts). Keyed by the exact prompt text in
 * DRAWING_PROMPTS; each leaves the subject to draw. Names go in names-e.ts too.
 */
import type { Path } from './shapes.js';

export const SET_E: Readonly<Record<string, readonly Path[]>> = {};
