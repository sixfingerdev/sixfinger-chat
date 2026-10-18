import { z } from 'zod';
import { ToolError } from './errors.ts';
import { createRateLimiter } from './limits.ts';
import type { ToolContext, ToolDef } from './types.ts';

/** sandboxd ile konuşan istemci (ana uygulamanın Docker'a doğrudan erişimi yoktur). */
export interface SandboxClient {
  exec(session: ScopedSession, command: string, timeoutSeconds: number, signal: AbortSignal): Promise<ExecOutcome>;
  read(session: ScopedSession, path: string, signal: AbortSignal): Promise<{ content: string; truncated: boolean }>;
  write(session: ScopedSession, path: string, content: string, signal: AbortSignal): Promise<{ bytes: number }>;
  edit(session: ScopedSession, args: { path: string; oldString: string; newString: string; replaceAll: boolean }, signal: AbortSignal): Promise<{ replacements: number; snippet: string }>;
}

export interface ScopedSession {
  user: string;
  session: string;
}

export interface ExecOutcome {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  timedOut: boolean;
  durationMs: number;
}

export function createSandboxClient(baseUrl: string, token: string, fetchImpl: typeof fetch = fetch): SandboxClient {
  async function call<T>(path: string, body: object, signal: AbortSignal, timeoutMs: number): Promise<T> {
    let res: Response;
    try {
      res = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/v1/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
        signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
      });
    } catch (err) {
      if (signal.aborted) throw err;
      throw new ToolError('Sandbox servisine ulaşılamıyor.');
    }
    if (res.ok) return (await res.json()) as T;
    let message = '';
    try {
      message = ((await res.json()) as { error?: { message?: string } }).error?.message ?? '';
    } catch {
      /* gövde yok */
    }
    if (res.status === 503) throw new ToolError(message || 'Sandbox şu an dolu. Birkaç saniye sonra tekrar dene.');
    if (res.status === 401) throw new ToolError('Sandbox yapılandırması hatalı.');
    throw new ToolError(message || `Sandbox hatası (${res.status}).`);
  }

  return {
    exec: (s, command, timeoutSeconds, signal) => call('exec', { ...s, command, timeout_seconds: timeoutSeconds }, signal, (timeoutSeconds + 40) * 1000),
    read: (s, path, signal) => call('read', { ...s, path }, signal, 30_000),
    write: (s, path, content, signal) => call('write', { ...s, path, content }, signal, 30_000),
    edit: (s, a, signal) => call('edit', { ...s, path: a.path, old_string: a.oldString, new_string: a.newString, replace_all: a.replaceAll }, signal, 40_000),
  };
}

const scope = (ctx: ToolContext): ScopedSession => ({ user: ctx.user.id, session: `${ctx.user.id}:${ctx.chatId ?? 'none'}` });
const path = z.string().trim().min(1, 'Dosya yolu boş.').max(400, 'Dosya yolu çok uzun.');

const bashArgs = z.object({
  command: z.string().min(1, 'Komut boş.').max(8_000, 'Komut çok uzun.'),
  timeout_seconds: z.number().int().min(1).max(120).optional(),
});
const readArgs = z.object({ path, offset: z.number().int().min(1).optional(), limit: z.number().int().min(1).max(2_000).optional() });
const writeArgs = z.object({ path, content: z.string().max(1_000_000, 'İçerik çok büyük (en fazla ~1 MB).') });
const editArgs = z.object({ path, old_string: z.string().min(1, 'old_string boş olamaz.'), new_string: z.string(), replace_all: z.boolean().optional() });

function first<T extends z.ZodTypeAny>(schema: T, raw: unknown): z.infer<T> {
  const r = schema.safeParse(raw);
  if (!r.success) throw new ToolError(r.error.issues[0]?.message ?? 'Geçersiz argüman.');
  return r.data;
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;

export function createSandboxTools(client: SandboxClient): ToolDef[] {
  const limiter = createRateLimiter(40, 60_000);
  const guard = (ctx: ToolContext) => {
    if (!limiter.take(ctx.user.id)) throw new ToolError('Çok sık komut çalıştırıldı. Biraz bekleyip tekrar dene.');
  };
  const available = (u: ToolContext['user']) => u.limits.features.sandbox;

  const bash: ToolDef = {
    name: 'bash',
    description:
      'İzole bir Linux ortamında (/work klasörü) bash komutu çalıştırır. Hesaplama, veri işleme, kısa betikler (python3, node), dosya dönüştürme ve bir şeyi denemek için kullan. ' +
      'Çalışma klasörü bu sohbet boyunca korunur. Komut en fazla 30 sn (en çok 120 sn) çalışır; arka planda sunucu başlatma. İnternet yalnızca 80/443 portlarıyla vardır.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Çalıştırılacak bash komutu.' },
        timeout_seconds: { type: 'integer', description: 'Zaman aşımı (1-120 sn, varsayılan 30).' },
      },
      required: ['command'],
    },
    available,
    async run(raw, ctx) {
      const a = first(bashArgs, raw);
      guard(ctx);
      const r = await client.exec(scope(ctx), a.command, a.timeout_seconds ?? 30, ctx.signal);
      const parts = [`$ ${a.command.length > 300 ? `${a.command.slice(0, 300)}…` : a.command}`, r.timedOut ? `[zaman aşımı: komut durduruldu · ${seconds(r.durationMs)}]` : `[çıkış kodu ${r.exitCode ?? '?'} · ${seconds(r.durationMs)}]`];
      if (r.stdout) parts.push(r.stdout.replace(/\n$/, ''));
      if (r.stderr) parts.push(`[stderr]\n${r.stderr.replace(/\n$/, '')}`);
      if (!r.stdout && !r.stderr) parts.push('(çıktı yok)');
      if (r.truncated) parts.push('[çıktı kısaltıldı]');
      return { output: parts.join('\n'), summary: r.timedOut ? 'zaman aşımı' : `çıkış ${r.exitCode ?? '?'} · ${seconds(r.durationMs)}` };
    },
  };

  const read: ToolDef = {
    name: 'read',
    description: 'Çalışma klasöründeki (/work) bir metin dosyasını satır numaralarıyla okur. Düzenlemeden önce dosyayı okumak için kullan.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Dosya yolu (ör. "app.py" ya da "/work/app.py").' },
        offset: { type: 'integer', description: 'Başlangıç satırı (1\'den, varsayılan 1).' },
        limit: { type: 'integer', description: 'Satır sayısı (varsayılan/en çok 2000).' },
      },
      required: ['path'],
    },
    available,
    async run(raw, ctx) {
      const a = first(readArgs, raw);
      guard(ctx);
      const f = await client.read(scope(ctx), a.path, ctx.signal);
      const lines = f.content.split('\n');
      if (lines.at(-1) === '') lines.pop();
      const start = (a.offset ?? 1) - 1;
      const slice = lines.slice(start, start + (a.limit ?? 2_000));
      const numbered = slice.map((l, i) => `${String(start + i + 1).padStart(5)}\t${l}`).join('\n');
      const notes = [start + slice.length < lines.length ? `[… ${lines.length - start - slice.length} satır daha var; offset ile devam et]` : '', f.truncated ? '[dosya boyut sınırında kesildi]' : ''].filter(Boolean);
      return { output: [`Dosya: ${a.path} (${lines.length} satır)`, numbered || '(boş dosya)', ...notes].join('\n'), summary: `${lines.length} satır` };
    },
  };

  const write: ToolDef = {
    name: 'write',
    description: 'Çalışma klasöründe (/work) bir dosya oluşturur ya da üzerine yazar; gerekli klasörleri açar. Mevcut dosyada küçük değişiklik için edit kullan.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Dosya yolu.' }, content: { type: 'string', description: 'Dosyanın tüm içeriği.' } },
      required: ['path', 'content'],
    },
    available,
    async run(raw, ctx) {
      const a = first(writeArgs, raw);
      guard(ctx);
      const r = await client.write(scope(ctx), a.path, a.content, ctx.signal);
      return { output: `Yazıldı: ${a.path} (${r.bytes} bayt)`, summary: a.path };
    },
  };

  const edit: ToolDef = {
    name: 'edit',
    description:
      'Bir dosyada metni birebir değiştirir. old_string dosyada tam olarak (boşluk ve girinti dahil) ve benzersiz olarak geçmeli; birden çok yer için replace_all kullan. ' +
      'Önce read ile dosyayı oku. Yeni dosya için write kullan.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Dosya yolu.' },
        old_string: { type: 'string', description: 'Değiştirilecek mevcut metin (birebir).' },
        new_string: { type: 'string', description: 'Yeni metin.' },
        replace_all: { type: 'boolean', description: 'Tüm eşleşmeleri değiştir (varsayılan false).' },
      },
      required: ['path', 'old_string', 'new_string'],
    },
    available,
    async run(raw, ctx) {
      const a = first(editArgs, raw);
      guard(ctx);
      const r = await client.edit(scope(ctx), { path: a.path, oldString: a.old_string, newString: a.new_string, replaceAll: a.replace_all ?? false }, ctx.signal);
      return { output: `Düzenlendi: ${a.path} (${r.replacements} değişiklik)\n\n${r.snippet}`, summary: `${r.replacements} değişiklik` };
    },
  };

  return [bash, read, write, edit];
}
