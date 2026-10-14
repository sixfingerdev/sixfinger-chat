import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from './pool.ts';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

export async function migrate(db: Db, log: (msg: string) => void = () => {}): Promise<string[]> {
  const client = await db.connect();
  const applied: string[] = [];
  try {
    // Birden çok örnek aynı anda başlarsa göçler sırayla çalışsın.
    await client.query('select pg_advisory_lock(727001)');
    await client.query(
      'create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())',
    );
    const done = new Set(
      (await client.query<{ name: string }>('select name from schema_migrations')).rows.map(
        (r) => r.name,
      ),
    );
    const files = readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = readFileSync(join(dir, file), 'utf8');
      log(`migrasyon uygulanıyor: ${file}`);
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query('insert into schema_migrations (name) values ($1)', [file]);
        await client.query('commit');
        applied.push(file);
      } catch (err) {
        await client.query('rollback');
        throw err;
      }
    }
  } finally {
    await client.query('select pg_advisory_unlock(727001)').catch(() => {});
    client.release();
  }
  return applied;
}
