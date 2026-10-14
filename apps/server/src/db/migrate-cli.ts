import { loadConfig } from '../config.ts';
import { createPool } from './pool.ts';
import { migrate } from './migrate.ts';

const config = loadConfig();
const db = createPool(config);
try {
  const applied = await migrate(db, (m) => console.log(m));
  console.log(applied.length ? `${applied.length} migrasyon uygulandı.` : 'Veritabanı güncel.');
} finally {
  await db.end();
}
