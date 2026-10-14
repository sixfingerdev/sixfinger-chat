#!/usr/bin/env node
/**
 * Yerel geliştirme için gömülü (paket içinde gelen) Postgres.
 *
 * Sistemde Postgres olmayan makinelerde (kod alanı / CI / yeni geliştirici) tek
 * komutla veritabanı ayağa kaldırmak için kullanılır:
 *
 *     npm run dev:db -w @sixfinger/server
 *     # veya: DATABASE_URL=postgres://sixfinger:sixfinger@127.0.0.1:5432/sixfinger
 *
 * Veriler `apps/server/.dev-data/pg` altında kalıcıdır; ikinci çalıştırmada
 * küme yeniden kullanılır. Kapatmak için Ctrl+C ya da SIGTERM yeterlidir.
 *
 * Ortam değişkenleri (hepsi isteğe bağlı):
 *   PG_DATA_DIR  veri klasörü        (varsayılan: apps/server/.dev-data/pg)
 *   PG_PORT      port                (varsayılan: 5432)
 *   PG_USER      kullanıcı           (varsayılan: sixfinger)
 *   PG_PASSWORD  parola              (varsayılan: sixfinger)
 *   PG_DATABASE  veritabanı adı      (varsayılan: sixfinger)
 *   PG_START_DB  başlangıçta açılacak test veritabanı (varsayılan: sixfinger_test)
 *   PG_VERBOSE   1 ise postgres çıktısını da yazdırır
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const dataDir = path.resolve(process.env.PG_DATA_DIR ?? path.join(serverRoot, '.dev-data', 'pg'));
const port = Number(process.env.PG_PORT ?? 5432);
const user = process.env.PG_USER ?? 'sixfinger';
const password = process.env.PG_PASSWORD ?? 'sixfinger';
const database = process.env.PG_DATABASE ?? 'sixfinger';
const startDatabase = process.env.PG_START_DB ?? 'sixfinger_test';
const verbose = process.env.PG_VERBOSE === '1';

/** İkili dosyaların bulunduğu paketi (ör. @embedded-postgres/linux-x64) çözer. */
function findBinaryPackageRoot() {
  const platform =
    process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'windows' : 'linux';
  for (const arch of [process.arch, process.arch === 'x64' ? 'x64' : process.arch]) {
    try {
      const entry = require.resolve(`@embedded-postgres/${platform}-${arch}`);
      return path.resolve(path.dirname(entry), '..');
    } catch {
      /* sıradaki kombinasyonu dene */
    }
  }
  return '';
}

const binaryRoot = findBinaryPackageRoot();
const nativeDir = binaryRoot ? path.join(binaryRoot, 'native') : '';

/**
 * npm bazen (--ignore-scripts, pnpm vb.) ikili paketlerin postinstall betiğini
 * çalıştırmaz; o betik yalnızca lib klasöründeki symlink'leri kurar. Eksikse
 * burada onarıyoruz, aksi halde `postgres` "shared library not found" ile ölür.
 */
function repairBinarySymlinks() {
  const symlinksFile = path.join(nativeDir, 'pg-symlinks.json');
  if (!fs.existsSync(symlinksFile)) return;
  try {
    const links = JSON.parse(fs.readFileSync(symlinksFile, 'utf8'));
    for (const { source, target } of links) {
      const src = path.resolve(binaryRoot, source);
      const dst = path.resolve(binaryRoot, target);
      if (fs.existsSync(dst) || !fs.existsSync(src)) continue;
      fs.symlinkSync(path.relative(path.dirname(dst), src), dst);
    }
  } catch (err) {
    console.warn(`[pg] symlink onarımı atlandı: ${err.message}`);
  }
}

/**
 * Bu ikili dosyalar `--prefix=/usr/local/pg-build` ile derlenmiştir: paylaşılan
 * kütüphaneleri ve uzantı (.so / .control) dosyalarını bu yolda ararlar.
 * Yol yazılabilirse paketin native klasörüne bağlarız; böylece `create
 * extension pgcrypto` gibi komutlar da çalışır. (LD_LIBRARY_PATH yalnızca
 * kütüphaneler için yeterli olur, uzantılar için olmaz.)
 */
const PREFIX = '/usr/local/pg-build';
function ensureCompiledInPrefix() {
  if (process.platform === 'win32') return;
  const wanted = ['bin', 'lib', 'share/postgresql'];
  if (wanted.every((p) => fs.existsSync(path.join(PREFIX, p)))) return;
  try {
    fs.mkdirSync(PREFIX, { recursive: true });
    for (const rel of wanted) {
      const target = path.join(nativeDir, rel);
      const link = path.join(PREFIX, rel);
      if (!fs.existsSync(target)) continue;
      fs.mkdirSync(path.dirname(link), { recursive: true });
      // Eski/kopuk bağlantı varsa (ör. paket yolu değiştiyse) tazele.
      try {
        const st = fs.lstatSync(link);
        if (st.isSymbolicLink() && fs.readlinkSync(link) === target) continue;
        fs.rmSync(link, { recursive: true, force: true });
      } catch {
        /* yok: oluşturacağız */
      }
      fs.symlinkSync(target, link);
    }
    if (!fs.existsSync(path.join(PREFIX, 'etc')))
      fs.mkdirSync(path.join(PREFIX, 'etc'), { recursive: true });
    console.log(`[pg] ikili dosya yolları bağlandı: ${PREFIX} → ${nativeDir}`);
  } catch (err) {
    console.warn(
      `[pg] uyarı: ${PREFIX} oluşturulamadı (${err.message}).\n` +
        `[pg] uzantılar (pgcrypto) yüklenemeyebilir; gerekirse bir kez şunu çalıştır:\n` +
        `[pg]   sudo mkdir -p ${PREFIX} && sudo ln -sfn ${nativeDir}/bin ${PREFIX}/bin && ` +
        `sudo ln -sfn ${nativeDir}/lib ${PREFIX}/lib && sudo mkdir -p ${PREFIX}/share && ` +
        `sudo ln -sfn ${nativeDir}/share/postgresql ${PREFIX}/share/postgresql`,
    );
  }
}

if (nativeDir) {
  repairBinarySymlinks();
  ensureCompiledInPrefix();
  const ldPath = [path.join(nativeDir, 'lib'), process.env.LD_LIBRARY_PATH]
    .filter(Boolean)
    .join(':');
  if (process.platform !== 'darwin') process.env.LD_LIBRARY_PATH = ldPath;
  else if (!process.env.DYLD_FALLBACK_LIBRARY_PATH)
    process.env.DYLD_FALLBACK_LIBRARY_PATH = path.join(nativeDir, 'lib');
}

const EmbeddedPostgres = (await import('embedded-postgres')).default;

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  port,
  user,
  password,
  persistent: true,
  onLog: verbose ? (msg) => process.stdout.write(`[pg] ${msg}`) : () => {},
  onError: (err) => console.error(`[pg] ${err?.message ?? err}`),
});

const initialised = fs.existsSync(path.join(dataDir, 'PG_VERSION'));
if (!initialised) {
  console.log(`[pg] ilk kurulum: ${dataDir}`);
  fs.mkdirSync(path.dirname(dataDir), { recursive: true });
  await pg.initialise();
}

await pg.start();

// Veritabanları yoksa oluştur (uygulama ve test veritabanı).
async function ensureDatabase(client, name) {
  const { rowCount } = await client.query('select 1 from pg_database where datname = $1', [name]);
  if (!rowCount) {
    await client.query(`create database ${client.escapeIdentifier(name)}`);
    console.log(`[pg] veritabanı oluşturuldu: ${name}`);
  }
}

const admin = pg.getPgClient('postgres', '127.0.0.1');
await admin.connect();
await ensureDatabase(admin, database);
if (startDatabase) await ensureDatabase(admin, startDatabase);
await admin.end();

const url = `postgres://${user}:${password}@127.0.0.1:${port}/${database}`;
console.log(`[pg] hazır → ${url}`);
console.log(`[pg] veri klasörü: ${dataDir}`);
console.log(`[pg] durdurmak için Ctrl+C`);

let stopping = false;
const shutdown = async (signal) => {
  if (stopping) return;
  stopping = true;
  console.log(`[pg] kapatılıyor (${signal})`);
  try {
    await pg.stop();
  } catch {
    /* yine de çık */
  }
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

// Süreci canlı tut.
await new Promise(() => {});
