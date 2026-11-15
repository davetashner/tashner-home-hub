/**
 * Prompt starters, batch D (see drawing-starters.ts). Keyed by the exact prompt text in
 * DRAWING_PROMPTS; each leaves the subject to draw. Names go in names-d.ts too.
 */
import type { Path } from './shapes.js';

export const SET_D: Readonly<Record<string, readonly Path[]>> = {};
