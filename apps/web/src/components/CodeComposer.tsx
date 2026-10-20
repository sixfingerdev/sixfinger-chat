import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, Brain, FileText, ListChecks, Paperclip, Square, X, Zap } from 'lucide-react';
import {
  BUILTIN_COMMANDS,
  activeMention,
  expandTemplate,
  matchCommands,
  parseSlash,
  type CodeSessionDTO,
  type DictKey,
  type SlashCommand,
  UPLOAD_MAX_BYTES,
} from '@sixfinger/shared';
import { api } from '../lib/api.ts';
import { reportError } from '../lib/errors.ts';
import { clsx } from '../lib/format.ts';
import { fileToBase64 } from '../lib/files.ts';
import { ensureNotifyPermission } from '../lib/notify.ts';
import type { PendingAttachment } from '../lib/types.ts';
import { useT } from '../lib/i18n/index.ts';
import { useChats } from '../store/chats.ts';
import { useCode } from '../store/code.ts';
import { useUi } from '../store/ui.ts';

/** Code oturumunun yazma alanı: slash komutları, @dosya, plan anahtarı ve ajan çalışırken mesaj kuyruğu. */
export function CodeComposer({ session, generating, focusSignal }: { session: CodeSessionDTO | null; generating: boolean; focusSignal: number }) {
  const t = useT();
  const chatId = session?.chatId;
  const plan = useCode((s) => (chatId ? s.plan[chatId] ?? false : false));
  const codeMode = useCode((s) => s.codeMode);
  const queue = useCode((s) => (chatId ? s.queue[chatId] : undefined)) ?? [];
  const [text, setText] = useState('');
  const area = useRef<HTMLTextAreaElement>(null);
  const [repoCmds, setRepoCmds] = useState<SlashCommand[]>([]);
  const [files, setFiles] = useState<string[] | null>(null);
  const [sel, setSel] = useState(0);
  const [dismissed, setDismissed] = useState('');
  const [attached, setAttached] = useState<PendingAttachment[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const limits = useUi((s) => s.config?.limits);
  const maxAttachments = limits?.maxAttachments ?? 0;

  useEffect(() => {
    if (focusSignal) area.current?.focus();
  }, [focusSignal]);

  // Repo komutları: oturum açılınca ve her tur bittiğinde tazelenir.
  useEffect(() => {
    if (!chatId || generating) return;
    let off = false;
    api
      .codeCommands(chatId)
      .then((r) => !off && setRepoCmds(r.commands))
      .catch(() => {});
    return () => {
      off = true;
    };
  }, [chatId, generating]);

  const grow = () => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  };

  const all = useMemo(() => [...BUILTIN_COMMANDS, ...repoCmds.filter((c) => !BUILTIN_COMMANDS.some((b) => b.name === c.name))], [repoCmds]);
  const slashTyped = /^\/[\w-]*$/.test(text) ? text : null;
  const slashList = slashTyped && dismissed !== text ? matchCommands(all, slashTyped) : [];
  const mention = activeMention(text);

  // @dosya önerileri (kısa gecikmeli).
  useEffect(() => {
    if (!chatId || !mention || generating) {
      setFiles(null);
      return;
    }
    let off = false;
    const h = setTimeout(() => {
      api
        .codeFiles(chatId, mention.query)
        .then((r) => !off && setFiles(r.files.slice(0, 8)))
        .catch(() => !off && setFiles([]));
    }, 150);
    return () => {
      off = true;
      clearTimeout(h);
    };
  }, [chatId, mention?.query, generating]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Her dosya (metin de ikili de) doğrudan çalışma alanına yüklenir (`.sixfinger/uploads/`, git'e girmez); mesaja yalnızca yol notu girer. */
  const addFiles = async (list: FileList) => {
    const ui = useUi.getState();
    const room = maxAttachments - attached.length;
    if (room <= 0) return ui.toast({ kind: 'info', text: t('composer.attachMax', { n: maxAttachments }) });
    if (!chatId) return;
    const next: PendingAttachment[] = [];
    for (const f of Array.from(list).slice(0, room)) {
      if (f.size === 0) continue;
      if (f.size > UPLOAD_MAX_BYTES) {
        ui.toast({ kind: 'error', text: t('composer.uploadTooBig', { name: f.name, n: Math.floor(UPLOAD_MAX_BYTES / 1_048_576) }) });
        continue;
      }
      try {
        const up = await api.codeUpload(chatId, f.name, await fileToBase64(f));
        next.push({ name: up.name, mime: f.type || 'application/octet-stream', text: '', truncated: false, path: up.path, bytes: up.bytes });
      } catch (err) {
        ui.toast({ kind: 'error', text: t('code.upload.failed', { name: f.name }) });
        reportError(err);
      }
    }
    if (next.length) setAttached((cur) => [...cur, ...next]);
  };

  const describe = (c: SlashCommand) => (c.source === 'builtin' ? t(`code.slash.${c.name}` as DictKey) : c.description || t('code.slash.repo'));

  /** Tek bir mesajı (komut ya da düz metin) çalıştırır; ajan çalışıyorsa kuyruğa alır. */
  const dispatch = async (raw: string, planOn: boolean, atts: PendingAttachment[]) => {
    if (!chatId) return;
    const slash = parseSlash(raw);
    const cmd = slash ? all.find((c) => c.name === slash.name) : undefined;
    let content = raw;
    let usePlan = planOn;
    if (cmd && slash) {
      if (cmd.kind === 'plan') {
        useCode.getState().setPlan(chatId, !planOn || Boolean(slash.args));
        if (!slash.args) return;
        usePlan = true;
        content = slash.args;
      } else if (cmd.kind === 'pr') {
        try {
          await api.codeOpenPr(chatId);
          await useChats.getState().openChat(chatId, true);
        } catch (err) {
          reportError(err);
        }
        return;
      } else if (cmd.kind === 'compact') {
        content = '/compact';
        usePlan = false;
      } else if (cmd.template) content = expandTemplate(cmd.template, slash.args);
    }
    if (useChats.getState().generating[chatId]) {
      void useCode
        .getState()
        .enqueue(chatId, { text: content, plan: usePlan, attachments: atts })
        .then((started) => started && void useChats.getState().openChat(chatId, true));
      return;
    }
    void useChats.getState().send({ content, chatId, planMode: usePlan, attachments: atts });
  };

  const submit = () => {
    const content = text.trim();
    if (!content || !chatId) return;
    ensureNotifyPermission();
    const atts = attached;
    setText('');
    setAttached([]);
    setDismissed('');
    requestAnimationFrame(grow);
    void dispatch(content, plan, atts);
  };

  // Kuyruk SUNUCUDA: oturum açılınca yüklenir; tur bitince sıradakini sunucu başlatır. Beklerken sunucuyu yoklarız:
  // kuyruk kısaldıysa sunucu yeni bir tur başlatmıştır, ona bağlanırız.
  useEffect(() => {
    if (chatId) void useCode.getState().loadQueue(chatId);
  }, [chatId]);
  useEffect(() => {
    if (generating || !chatId || queue.length === 0) return;
    let busy = false;
    const id = setInterval(async () => {
      if (busy) return;
      busy = true;
      const before = useCode.getState().queue[chatId]?.length ?? 0;
      await useCode.getState().loadQueue(chatId);
      if ((useCode.getState().queue[chatId]?.length ?? 0) < before) await useChats.getState().openChat(chatId, true);
      busy = false;
    }, 1_500);
    return () => clearInterval(id);
  }, [generating, chatId, queue.length]);

  const pickCommand = (c: SlashCommand) => {
    setText(`/${c.name} `);
    setSel(0);
    requestAnimationFrame(() => {
      area.current?.focus();
      grow();
    });
  };
  const pickFile = (path: string) => {
    if (!mention) return;
    setText(`${text.slice(0, mention.start)}@${path} `);
    setFiles(null);
    requestAnimationFrame(() => area.current?.focus());
  };

  const popup = slashList.length ? 'slash' : mention && files ? 'mention' : null;
  const count = popup === 'slash' ? slashList.length : popup === 'mention' ? files!.length : 0;

  return (
    <div className="composer-wrap">
      <div className={clsx('composer code-composer', plan && 'plan-on')}>
        {popup === 'slash' && (
          <div className="slash-pop" role="listbox" aria-label={t('code.slash.title')}>
            {slashList.map((c, i) => (
              <button key={c.name} role="option" aria-selected={i === sel} className={clsx('slash-item', i === sel && 'on')} onMouseDown={(e) => e.preventDefault()} onClick={() => pickCommand(c)}>
                <code>/{c.name}</code>
                <span>{describe(c)}</span>
              </button>
            ))}
          </div>
        )}
        {popup === 'mention' && (
          <div className="slash-pop" role="listbox">
            {files!.length === 0 && <div className="slash-empty">{t('code.mention.none')}</div>}
            {files!.map((f, i) => (
              <button key={f} role="option" aria-selected={i === sel} className={clsx('slash-item', i === sel && 'on')} onMouseDown={(e) => e.preventDefault()} onClick={() => pickFile(f)}>
                <code>{f}</code>
              </button>
            ))}
          </div>
        )}
        {queue.length > 0 && (
          <ul className="queue-list" aria-label={t('code.queue.title')}>
            {queue.map((q) => (
              <li key={q.id}>
                <span className="queue-tag">{t('code.queue.title')}</span>
                <span className="queue-text">
                  {q.attachments.length > 0 && <Paperclip size={12} style={{ marginRight: 4, verticalAlign: -1 }} />}
                  {q.text}
                </span>
                <button className="icon-btn sm" aria-label={t('code.queue.remove')} onClick={() => chatId && useCode.getState().removeQueued(chatId, q.id)}>
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
        {attached.length > 0 && (
          <div className="composer-files">
            {attached.map((f, i) => (
              <span key={`${f.name}-${i}`} className="file-chip removable" title={f.name}>
                <FileText size={14} />
                <span>{f.name}</span>
                <button aria-label={t('common.delete')} onClick={() => setAttached((cur) => cur.filter((_, j) => j !== i))}>
                  <X size={13} />
                </button>
              </span>
            ))}
          </div>
        )}
        <textarea
          ref={area}
          className="composer-input"
          rows={1}
          value={text}
          disabled={!session}
          placeholder={plan ? t('code.plan.modeHint') : t('code.composer.placeholder')}
          aria-label={t('code.composer.placeholder')}
          onChange={(e) => {
            setText(e.target.value);
            setSel(0);
            setDismissed('');
            grow();
          }}
          onKeyDown={(e) => {
            if (popup && count) {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                setSel((s) => (s + (e.key === 'ArrowDown' ? 1 : count - 1)) % count);
                return;
              }
              if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && !(popup === 'slash' && parseSlash(text)?.name === slashList[sel]?.name && /\s/.test(text)))) {
                e.preventDefault();
                if (popup === 'slash') pickCommand(slashList[sel]!);
                else if (files![sel]) pickFile(files![sel]!);
                return;
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                setDismissed(text);
                setFiles(null);
                return;
              }
            }
            if (e.key === 'Enter' && !e.shiftKey && (e.metaKey || e.ctrlKey || !('ontouchstart' in window))) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <div className="composer-bar">
          {limits?.features.attachments && (
            <>
              <input
                ref={fileInput}
                type="file"
                hidden
                multiple
                onChange={(e) => {
                  if (e.target.files) void addFiles(e.target.files);
                  e.target.value = '';
                }}
              />
              <button className="icon-btn" title={t('composer.attach')} aria-label={t('composer.attach')} onClick={() => fileInput.current?.click()}>
                <Paperclip size={18} />
              </button>
            </>
          )}
          <button
            className={clsx('plan-toggle', plan && 'on')}
            aria-pressed={plan}
            title={t('code.plan.modeHint')}
            onClick={() => chatId && useCode.getState().setPlan(chatId, !plan)}
          >
            <ListChecks size={14} /> {t('code.plan.toggle')}
          </button>
          <span className="mode-seg" role="group" aria-label={t('code.model.hint')} title={t('code.model.hint')}>
            <button className={clsx('plan-toggle', codeMode === 'fast' && 'on')} aria-pressed={codeMode === 'fast'} onClick={() => useCode.getState().setCodeMode('fast')}>
              <Zap size={14} /> {t('code.model.fast')}
            </button>
            <button className={clsx('plan-toggle', codeMode === 'deep' && 'on')} aria-pressed={codeMode === 'deep'} onClick={() => useCode.getState().setCodeMode('deep')}>
              <Brain size={14} /> {t('code.model.deep')}
            </button>
          </span>
          <span className="composer-note">{session ? `${session.repo.split('/')[1]}  ⎇ ${session.workBranch}` : ''}</span>
          <div className="composer-end">
            {generating && !text.trim() ? (
              <button className="send-btn stop" onClick={() => chatId && useChats.getState().stop(chatId)} aria-label={t('composer.stop')} title={t('composer.stop')}>
                <Square size={14} fill="currentColor" />
              </button>
            ) : (
              <button className="send-btn" onClick={submit} disabled={!text.trim() || !session} aria-label={generating ? t('code.queue.note') : t('composer.send')} title={generating ? t('code.queue.note') : t('composer.send')}>
                <ArrowUp size={18} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
