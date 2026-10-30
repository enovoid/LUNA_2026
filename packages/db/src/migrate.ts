import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb } from './index.js';

const db = createDb();
await migrate(db, { migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)) });
await db.$client.end();
console.log('migrations applied');
