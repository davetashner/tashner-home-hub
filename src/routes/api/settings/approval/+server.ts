import { error, json } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { requireAdult } from '#lib/server/auth.js';
import { readJson } from '#lib/server/api.js';
import {
	approvalDefault,
	setApprovalDefault,
	turnOffAllApprovals
} from '#lib/server/domain/approval-setting.js';
import type { RequestHandler } from './$types';

/** Whether new to-dos need a grown-up's OK (default off: kids self-serve). Adult only. */
export const GET: RequestHandler = (event) => {
	requireAdult(event);
	return json({ on: approvalDefault(getDb()) });
};

/** Adult only. Body: { on: boolean }. Changes what new to-dos start with; existing ones keep theirs. */
export const PUT: RequestHandler = async (event) => {
	requireAdult(event);
	const { on } = await readJson(event.request);
	if (typeof on !== 'boolean') error(400, 'on must be true or false');
	return json({ on: setApprovalDefault(getDb(), on) });
};

/** Adult only. Turns approval off on every to-do and approves anything still waiting. */
export const POST: RequestHandler = (event) => {
	requireAdult(event);
	return json({ on: false, ...turnOffAllApprovals(getDb()) });
};
