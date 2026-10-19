// SixFinger Code ajan sınaması: GERÇEK modeli (Qwen → varsa Claude yedeği) küçük görevlerde araç çağırırken dener.
//
//   cd apps/server
//   AI_DEEP_API_KEY=... npx tsx scripts/code-smoke.ts            # tüm görevler
//   AI_DEEP_API_KEY=... npx tsx scripts/code-smoke.ts --task 2   # yalnızca 2. görev
//   npx tsx scripts/code-smoke.ts --runs 3                       # her görevi 3 kez (kararlılık)
//
// Amaç: Qwen3.8'in araç çağırma kalitesini (geçerli JSON, doğru araç, edit eşleşmesi, kendini doğrulama) ölçmek.
// Çalışma alanı GEÇİCİ bir klasördür ve komutlar bu makinede (yalıtımsız) çalışır: yalnızca kendi makinende / Pi'de çalıştır.
// Sandboxd, veritabanı ve GitHub gerekmez; üretim ajan döngüsünün (code-run.ts) araçlarını ve istemini kullanır.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { loadConfig } from '../src/config.ts';
import { createAi, type AiMessage, type AiToolCall } from '../src/services/ai.ts';
import { buildCodeSystemPrompt } from '../src/services/code-prompt.ts';
import { createTools, runToolCall, toolSpecs, FileNotFoundError, IsDirectoryError, type CodeSandboxClient } from '../src/services/tools/index.ts';
import type { AuthUser } from '../src/lib/types.ts';

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
};
const ONLY = Number(arg('task', '0'));
const RUNS = Number(arg('runs', '1'));
const MAX_STEPS = Number(arg('max-steps', '40'));

// ------------------------------------------------------------------------------------------ yerel çalışma alanı
const SKIP = new Set(['.git', 'node_modules']);

function walk(root: string, base = root): string[] {
  const out: string[] = [];
  for (const name of readdirSync(base)) {
    if (SKIP.has(name)) continue;
    const full = join(base, name);
    if (statSync(full).isDirectory()) out.push(...walk(root, full));
    else out.push(relative(root, full).split(sep).join('/'));
  }
  return out.sort();
}

const globToRegExp = (g: string) =>
  new RegExp(
    `^${g
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*\//g, '(?:.*/)?')
      .replace(/\*\*/g, '.*')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '[^/]')}$`,
  );

function run(dir: string, command: string, timeoutS: number): Promise<{ exitCode: number | null; stdout: string; stderr: string; timedOut: boolean; durationMs: number }> {
  return new Promise((resolveRun) => {
    const started = Date.now();
    const child = spawn('bash', ['-c', command], { cwd: dir, env: { PATH: process.env.PATH, HOME: dir, LANG: 'C.UTF-8' } });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutS * 1000);
    child.stdout.on('data', (d: Buffer) => (stdout = (stdout + d).slice(-64_000)));
    child.stderr.on('data', (d: Buffer) => (stderr = (stderr + d).slice(-64_000)));
    child.on('close', (code) => {
      clearTimeout(timer);
      resolveRun({ exitCode: code, stdout, stderr, timedOut, durationMs: Date.now() - started });
    });
  });
}

function localClient(dir: string): CodeSandboxClient {
  const safe = (p: string) => {
    const full = resolve(dir, p);
    if (full !== dir && !full.startsWith(dir + sep)) throw new Error('path escapes the workspace');
    return full;
  };
  return {
    async prepare() {
      return { cloned: false, setupRan: false, setupOk: null, setupOutput: '', baseSha: 'a'.repeat(40), branch: 'smoke', diskUsedMb: 1, diskMb: 512 };
    },
    async exec(_s, command, timeoutSeconds) {
      return { ...(await run(dir, command, timeoutSeconds)), truncated: false, diskUsedMb: 1 };
    },
    async read(_s, path) {
      const full = safe(path);
      let st;
      try {
        st = statSync(full);
      } catch {
        throw new FileNotFoundError();
      }
      if (st.isDirectory()) throw new IsDirectoryError();
      return { content: readFileSync(full, 'utf8'), truncated: false };
    },
    async write(_s, path, content) {
      const full = safe(path);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content);
      return { bytes: Buffer.byteLength(content), diskUsedMb: 1 };
    },
    async glob(_s, a) {
      const re = globToRegExp(a.pattern);
      const prefix = a.path ? `${a.path.replace(/\/$/, '')}/` : '';
      const files = walk(dir).filter((f) => f.startsWith(prefix) && re.test(f.slice(prefix.length)));
      return { files: files.slice(0, a.limit ?? 200), truncated: files.length > (a.limit ?? 200) };
    },
    async grep(_s, a) {
      const flags = [a.caseSensitive === false ? '-i' : '', a.literal ? '-F' : '-E'].filter(Boolean).join(' ');
      const inc = a.include ? `--include='${a.include.replace(/'/g, '')}'` : '';
      const target = a.path ? `'${a.path.replace(/'/g, '')}'` : '.';
      const r = await run(dir, `grep -rn ${flags} ${inc} --exclude-dir=node_modules --exclude-dir=.git -e '${a.pattern.replace(/'/g, `'\\''`)}' ${target} | sed 's|^\\./||' | head -n ${a.limit ?? 100}`, 20);
      return { lines: r.stdout.split('\n').filter(Boolean), truncated: false };
    },
    async changes() {
      return { files: [], additions: 0, deletions: 0, baseSha: 'a'.repeat(40) };
    },
    async commit() {
      return { sha: null };
    },
    async archive() {
      return Buffer.alloc(0);
    },
    async push() {
      throw new Error('push bu sınamada yok');
    },
    async usage() {
      return { diskUsedMb: 1, diskMb: 512, running: true };
    },
    async destroy() {},
  };
}

// ------------------------------------------------------------------------------------------ görevler
type Files = Record<string, string>;
interface Task {
  name: string;
  prompt: string;
  files: Files;
  /** Görev bittikten sonra çalışma alanında doğrulama; boş dize = başarılı, aksi halde nedeni. */
  verify(dir: string): Promise<string>;
}

const PKG = JSON.stringify({ name: 'smoke', version: '1.0.0', type: 'module', scripts: { test: 'node --test' } }, null, 2) + '\n';
const passes = async (dir: string) => {
  const r = await run(dir, 'node --test 2>&1 | tail -n 15', 60);
  return /# fail 0/.test(r.stdout) && /# pass [1-9]/.test(r.stdout) ? '' : `testler geçmiyor:\n${r.stdout.slice(-600)}`;
};

const TASKS: Task[] = [
  {
    name: 'yeni işlev + test yaz, çalıştır',
    prompt: 'src/text.js dosyasına `slugify(text)` işlevini ekle: küçük harfe çevirsin, Türkçe karakterleri (ç,ğ,ı,ö,ş,ü) ASCII karşılığına dönüştürsün, harf/rakam dışındaki her şeyi tek tire yapsın ve baştaki/sondaki tireleri atsın. Bir de test/text.test.js içinde en az 3 testini yaz (node:test) ve testleri çalıştırıp geçtiğini doğrula.',
    files: { 'package.json': PKG, 'src/text.js': "export function capitalize(s) {\n  return s.charAt(0).toUpperCase() + s.slice(1);\n}\n" },
    async verify(dir) {
      const src = readFileSync(join(dir, 'src/text.js'), 'utf8');
      if (!/export\s+(function\s+slugify|const\s+slugify)/.test(src)) return 'slugify dışa aktarılmamış';
      const probe = await run(dir, `node -e "import('./src/text.js').then(m=>console.log(JSON.stringify([m.slugify('Çılgın Şöför  Ğüzel!'), m.slugify('  --Hello, World--  ')])))"`, 20);
      if (probe.stdout.trim() !== JSON.stringify(['cilgin-sofor-guzel', 'hello-world'])) return `yanlış çıktı: ${probe.stdout.trim() || probe.stderr.slice(0, 200)}`;
      return passes(dir);
    },
  },
  {
    name: 'başarısız testi bul ve hatayı düzelt',
    prompt: 'Testler başarısız oluyor. Nedenini bul, hatayı kaynak kodda düzelt (testleri değiştirme) ve testlerin geçtiğini doğrula.',
    files: {
      'package.json': PKG,
      'src/math.js': "export function sum(list) {\n  let total = 0;\n  for (let i = 1; i < list.length; i++) total += list[i];\n  return total;\n}\n\nexport function average(list) {\n  if (list.length === 0) return 0;\n  return sum(list) / list.length;\n}\n",
      'test/math.test.js': "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { sum, average } from '../src/math.js';\n\ntest('sum', () => assert.equal(sum([1, 2, 3, 4]), 10));\ntest('average', () => assert.equal(average([2, 4, 6]), 4));\ntest('empty', () => assert.equal(average([]), 0));\n",
    },
    async verify(dir) {
      const tests = readFileSync(join(dir, 'test/math.test.js'), 'utf8');
      if (!tests.includes('assert.equal(sum([1, 2, 3, 4]), 10)')) return 'testler değiştirilmiş';
      return passes(dir);
    },
  },
  {
    name: 'birden çok dosyada yeniden adlandır',
    prompt: '`getUser` işlevinin adını tüm projede `fetchUser` olarak değiştir (tanım, çağrılar, testler ve README\'deki örnek dahil). Bittiğinde testleri çalıştırıp geçtiğini doğrula.',
    files: {
      'package.json': PKG,
      'README.md': '# Smoke\n\nKullanım:\n\n```js\nimport { getUser } from "./src/users.js";\nconst u = getUser(1);\n```\n',
      'src/users.js': "const DB = new Map([[1, { id: 1, name: 'Ada' }], [2, { id: 2, name: 'Linus' }]]);\n\nexport function getUser(id) {\n  return DB.get(id) ?? null;\n}\n",
      'src/greet.js': "import { getUser } from './users.js';\n\nexport function greet(id) {\n  const user = getUser(id);\n  return user ? `Merhaba ${user.name}` : 'Merhaba yabancı';\n}\n",
      'test/users.test.js': "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { getUser } from '../src/users.js';\nimport { greet } from '../src/greet.js';\n\ntest('getUser', () => assert.equal(getUser(1).name, 'Ada'));\ntest('greet', () => assert.equal(greet(2), 'Merhaba Linus'));\n",
    },
    async verify(dir) {
      const left = await run(dir, "grep -rn 'getUser' . --exclude-dir=node_modules --exclude-dir=.git | head -n 3", 10);
      if (left.stdout.trim()) return `hâlâ getUser var:\n${left.stdout.trim()}`;
      const cnt = await run(dir, "grep -rln 'fetchUser' . --exclude-dir=node_modules --exclude-dir=.git | wc -l", 10);
      if (Number(cnt.stdout.trim()) < 4) return `fetchUser yalnızca ${cnt.stdout.trim()} dosyada`;
      return passes(dir);
    },
  },
];

// ------------------------------------------------------------------------------------------ ajan döngüsü
interface Result {
  ok: boolean;
  reason: string;
  steps: number;
  calls: Record<string, number>;
  toolErrors: number;
  badJson: number;
  seconds: number;
  usedClaude: boolean;
}

// Yapılandırma gereksinimleri (veritabanı/JWT) bu betikte kullanılmaz; yalnızca doğrulamayı geçmek için.
process.env.DATABASE_URL ??= 'postgres://unused:unused@127.0.0.1:5432/unused';
process.env.JWT_SECRET ??= 'smoke-smoke-smoke-smoke-smoke-smoke-smoke-smoke';
const config = loadConfig();
const ai = createAi(config, { warn: (o: object, m: string) => console.log(`  [uyarı] ${m} ${JSON.stringify(o).slice(0, 160)}`) });
const user = { id: 'smoke', email: 'smoke@local', locale: 'tr' } as unknown as AuthUser;

async function runTask(task: Task): Promise<Result> {
  const dir = mkdtempSync(join(tmpdir(), 'sf-code-smoke-'));
  const started = Date.now();
  const r: Result = { ok: false, reason: '', steps: 0, calls: {}, toolErrors: 0, badJson: 0, seconds: 0, usedClaude: false };
  try {
    for (const [p, c] of Object.entries(task.files)) {
      mkdirSync(dirname(join(dir, p)), { recursive: true });
      writeFileSync(join(dir, p), c);
    }
    const client = localClient(dir);
    const defs = createTools([], { code: client }).forCode();
    const specs = toolSpecs(defs);
    const brief = (await run(dir, 'ls -1Ap | head -n 40', 10)).stdout;
    const system = buildCodeSystemPrompt({ locale: 'tr', repo: 'smoke/project', baseBranch: 'main', workBranch: 'smoke/work', network: 'none', allowedDomains: [], diskMb: 512, brief });
    const messages: AiMessage[] = [{ role: 'system', content: system }, { role: 'user', content: task.prompt }];
    const controller = new AbortController();
    const ctx = { user, signal: controller.signal, chatId: 'smoke', code: { session: 'smoke', diskMb: 512, prepare: async () => {} } };

    for (let step = 0; step < MAX_STEPS; step++) {
      r.steps = step + 1;
      let text = '';
      let calls: AiToolCall[] = [];
      for await (const chunk of ai.stream({ messages, signal: controller.signal, mode: 'deep', route: 'code', tools: specs, patient: step > 0, onProvider: (n) => (r.usedClaude ||= n === 'claude') })) {
        if (chunk.type === 'content') text += chunk.text;
        else if (chunk.type === 'tool_calls') calls = chunk.calls;
      }
      if (!calls.length) {
        messages.push({ role: 'assistant', content: text });
        break;
      }
      messages.push({ role: 'assistant', content: text, tool_calls: calls });
      for (const call of calls) {
        r.calls[call.function.name] = (r.calls[call.function.name] ?? 0) + 1;
        try {
          JSON.parse(call.function.arguments || '{}');
        } catch {
          r.badJson++;
        }
        const out = await runToolCall(defs, call, ctx);
        if (out.status === 'error') r.toolErrors++;
        messages.push({ role: 'tool', tool_call_id: call.id, content: out.output });
      }
    }
    r.reason = await task.verify(dir);
    r.ok = r.reason === '';
  } catch (err) {
    r.reason = `hata: ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    r.seconds = Math.round((Date.now() - started) / 100) / 10;
    rmSync(dir, { recursive: true, force: true });
  }
  return r;
}

console.log(`Model: ${config.AI_DEEP_MODEL}${config.BEDROCK_MODEL_ID ? ` (yedek: Bedrock ${config.BEDROCK_MODEL_ID})` : ''}`);
if (!config.AI_DEEP_API_KEY) console.log('Uyarı: AI_DEEP_API_KEY boş; OVH uç noktası anahtarsız yanıt vermeyebilir.');
let failed = 0;
const stats = { runs: 0, ok: 0, steps: 0, toolErrors: 0, badJson: 0 };
for (const [i, task] of TASKS.entries()) {
  if (ONLY && ONLY !== i + 1) continue;
  for (let n = 1; n <= RUNS; n++) {
    process.stdout.write(`\n#${i + 1} ${task.name}${RUNS > 1 ? ` (${n}/${RUNS})` : ''}\n`);
    const r = await runTask(task);
    stats.runs++;
    stats.ok += r.ok ? 1 : 0;
    stats.steps += r.steps;
    stats.toolErrors += r.toolErrors;
    stats.badJson += r.badJson;
    if (!r.ok) failed++;
    console.log(`  ${r.ok ? 'GEÇTİ' : 'KALDI'}  ${r.steps} adım, ${r.seconds} sn${r.usedClaude ? ', Claude yedeği devreye girdi' : ''}`);
    console.log(`  araçlar: ${Object.entries(r.calls).map(([k, v]) => `${k}×${v}`).join(' ') || '-'}  | araç hatası: ${r.toolErrors}  | bozuk JSON: ${r.badJson}`);
    if (!r.ok) console.log(`  neden: ${r.reason.split('\n').join('\n         ')}`);
  }
}
console.log(`\nÖzet: ${stats.ok}/${stats.runs} görev geçti; ortalama ${(stats.steps / Math.max(1, stats.runs)).toFixed(1)} adım; toplam araç hatası ${stats.toolErrors}, bozuk JSON ${stats.badJson}.`);
process.exit(failed ? 1 : 0);
