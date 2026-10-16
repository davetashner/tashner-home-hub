import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'hub-sound-api-'));

const { getDb, schema } = await import('#lib/server/db/index.js');
const sound = await import('./sound/+server.js');
const get = () => (sound.GET as unknown as () => Response)().json();

it('defaults to unmuted with quiet hours 20:00 to 07:00', async () => {
	expect(await get()).toEqual({ muted: false, quietStart: '20:00', quietEnd: '07:00' });
});

it('reads settings rows and ignores corrupt ones', async () => {
	const db = getDb();
	db.insert(schema.settings).values({ key: 'sound.muted', value: 'true' }).run();
	db.insert(schema.settings).values({ key: 'sound.quietStart', value: '{oops' }).run();
	db.insert(schema.settings).values({ key: 'sound.quietEnd', value: '"06:00"' }).run();
	expect(await get()).toEqual({ muted: true, quietStart: '20:00', quietEnd: '06:00' });
});
