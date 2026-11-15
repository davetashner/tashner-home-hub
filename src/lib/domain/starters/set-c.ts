/**
 * Prompt starters, batch C (see drawing-starters.ts). Keyed by the exact prompt text in
 * DRAWING_PROMPTS; each leaves the subject to draw. Names go in names-c.ts too.
 */
import type { Path } from './shapes.js';

export const SET_C: Readonly<Record<string, readonly Path[]>> = {};
