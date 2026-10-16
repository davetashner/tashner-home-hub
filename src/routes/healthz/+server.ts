import { json } from '@sveltejs/kit';
import { healthReport } from '#lib/server/health.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () =>
	json(healthReport(process.env.APP_VERSION ?? 'dev', process.uptime()));
