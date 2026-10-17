import { eq } from 'drizzle-orm';
import { getDb, schema } from '#lib/server/db/index.js';
import { parseWaveChoice, WAVE_SETTING_KEY, type WaveChoice } from '#lib/domain/wave-background.js';

export function readWaveBackground(): WaveChoice {
	const row = getDb()
		.select()
		.from(schema.settings)
		.where(eq(schema.settings.key, WAVE_SETTING_KEY))
		.get();
	try {
		return parseWaveChoice(row ? JSON.parse(row.value) : undefined);
	} catch {
		return 'auto';
	}
}

export function writeWaveBackground(choice: WaveChoice): void {
	const value = JSON.stringify(choice);
	getDb()
		.insert(schema.settings)
		.values({ key: WAVE_SETTING_KEY, value })
		.onConflictDoUpdate({ target: schema.settings.key, set: { value, updatedAt: Date.now() } })
		.run();
}
