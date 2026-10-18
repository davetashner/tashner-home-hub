import { defineConfig } from 'drizzle-kit';

export default defineConfig({
	dialect: 'sqlite',
	schema: './src/lib/server/db/schema.ts',
	out: './drizzle',
	// Timestamp-named migrations (YYYYMMDDHHMMSS_name) so concurrent branches never collide on a number.
	// 0000-0009 predate this and keep their index prefix.
	migrations: { prefix: 'timestamp' },
	dbCredentials: { url: `${process.env.DATA_DIR ?? './data'}/hub.db` }
});
