import pg from 'pg';
import type { Config } from '../config.ts';

// `date` sütunlarını Date nesnesine çevirme; 'YYYY-MM-DD' olarak kalsın.
pg.types.setTypeParser(1082, (v) => v);
// bigint -> number (seq vb. küçük değerler)
pg.types.setTypeParser(20, (v) => Number(v));

export type Db = pg.Pool;
export type Queryable = Pick<pg.Pool, 'query'>;

export function createPool(config: Config): Db {
  return new pg.Pool({
    connectionString: config.DATABASE_URL,
    ssl: config.DATABASE_SSL ? { rejectUnauthorized: false } : undefined,
    max: config.isTest ? 4 : 10,
    idleTimeoutMillis: 30_000,
  });
}

export async function withTx<T>(db: Db, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
