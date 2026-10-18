import { join } from 'node:path';

/**
 * The data dir of the server under test. playwright.config.ts points it at a fresh
 * `.e2e-data/<port>/` for every run (E2E_DATA_DIR); without that it falls back to the dev `data/`.
 */
export const DATA_DIR = process.env.E2E_DATA_DIR ?? 'data';
export const DB_PATH = join(DATA_DIR, 'hub.db');
