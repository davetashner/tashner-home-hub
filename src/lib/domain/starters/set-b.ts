/**
 * Prompt starters, batch B (see drawing-starters.ts). Keyed by the exact prompt text in
 * DRAWING_PROMPTS; each leaves the subject to draw. Names go in names-b.ts too.
 */
import type { Path } from './shapes.js';

export const SET_B: Readonly<Record<string, readonly Path[]>> = {};
