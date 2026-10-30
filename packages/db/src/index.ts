import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

export * from './schema.js';
export { schema };

/** Postgres 연결과 Drizzle 인스턴스를 만든다. 끝나면 `db.$client.end()`로 연결을 닫는다. */
export function createDb(url: string = process.env.DATABASE_URL ?? '') {
  if (!url) throw new Error('DATABASE_URL이 설정되지 않았습니다.');
  return drizzle(postgres(url, { max: 5 }), { schema });
}

export type Db = ReturnType<typeof createDb>;
