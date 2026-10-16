import { isNotNull, and, eq } from 'drizzle-orm';
import { getDb, schema } from '#lib/server/db/index.js';
import { safeNext } from '#lib/server/domain/session.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url }) => {
	const adults = getDb()
		.select({ id: schema.members.id, name: schema.members.name, color: schema.members.color })
		.from(schema.members)
		.where(and(eq(schema.members.role, 'adult'), isNotNull(schema.members.pinHash)))
		.all();
	return { adults, next: safeNext(url.searchParams.get('next')) };
};
