import { getDb } from '#lib/server/db/index.js';
import { deleteMeal, listRange, listWeek, setMeal } from '#lib/server/domain/meals.js';
import { handle, readJson } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

/** `?week=YYYY-MM-DD` (any day; the Monday-based week holding it) or `?from=&to=`. Anyone may read. */
export const GET: RequestHandler = ({ url }) =>
	handle(() => {
		const { searchParams: q } = url;
		const from = q.get('from');
		const to = q.get('to');
		if (from !== null && to !== null) return listRange(getDb(), from, to);
		return listWeek(getDb(), q.get('week'));
	});

/** Body: { date, meal, title }. Family-fridge style: no sign-in needed. */
export const PUT: RequestHandler = async ({ request }) => {
	const body = await readJson(request);
	return handle(() => setMeal(getDb(), body));
};

/** Body: { date, meal }. Send a JSON content-type: SvelteKit's CSRF check refuses DELETEs without one. */
export const DELETE: RequestHandler = async ({ request }) => {
	const body = await readJson(request);
	return handle(() => deleteMeal(getDb(), body));
};
