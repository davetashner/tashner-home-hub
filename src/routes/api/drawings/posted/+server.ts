import { error, json } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { listMemberDrawings } from '#lib/server/domain/art-book.js';
import type { RequestHandler } from './$types';

/** One member's posted drawings with dates, newest first (`?memberId=`). Open to the LAN like the notes they come from. */
export const GET: RequestHandler = ({ url }) => {
	const memberId = url.searchParams.get('memberId');
	if (!memberId || memberId.length > 200) error(400, 'memberId is required');
	return json(listMemberDrawings(getDb(), memberId));
};
