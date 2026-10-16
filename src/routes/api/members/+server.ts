import { getDb } from '#lib/server/db/index.js';
import { requireAdult } from '#lib/server/auth.js';
import { createMember, listMembers, type MemberInput } from '#lib/server/domain/members.js';
import { body, handle, json } from '#lib/server/members-api.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () => json(listMembers(getDb()));

export const POST: RequestHandler = async (event) => {
	requireAdult(event);
	const data = await body(event);
	return json(
		handle(() => createMember(getDb(), data as unknown as MemberInput)),
		{ status: 201 }
	);
};
