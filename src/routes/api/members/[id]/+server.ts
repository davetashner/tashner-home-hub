import { error } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { requireAdult } from '#lib/server/auth.js';
import { deleteMember, getMember, updateMember } from '#lib/server/domain/members.js';
import { body, handle, json } from '#lib/server/members-api.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ params }) => {
	const member = getMember(getDb(), params.id);
	if (!member) error(404, 'Member not found.');
	return json(member);
};

export const PATCH: RequestHandler = async (event) => {
	requireAdult(event);
	const data = await body(event);
	return json(handle(() => updateMember(getDb(), event.params.id, data)));
};

/** Cascades to the member's stars and history: requires `?confirm=true`. */
export const DELETE: RequestHandler = (event) => {
	requireAdult(event);
	const confirm = event.url.searchParams.get('confirm') === 'true';
	handle(() => deleteMember(getDb(), event.params.id, { confirm }));
	return new Response(null, { status: 204 });
};
