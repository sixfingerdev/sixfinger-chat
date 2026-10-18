import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, FileText, Lock, Mic, MicOff, Paperclip, Square, X } from 'lucide-react';
import { CHAT_MODES, THINKING_LEVELS, modeSupportsThinkingLevel, type ChatMode } from '@sixfinger/shared';
import type { Effort, PendingAttachment } from '../lib/types.ts';
import { clsx, timeUntil } from '../lib/format.ts';
import { ACCEPT_ATTR, readTextFile } from '../lib/files.ts';
import { useLocale, useT } from '../lib/i18n/index.ts';
import { dictationSupported, startDictation, type Dictation } from '../lib/speech.ts';
import { useAuth } from '../store/auth.ts';
import { useChats } from '../store/chats.ts';
import { useUi } from '../store/ui.ts';
import { Popover } from './Popover.tsx';
import { SlashMeter } from './SlashMeter.tsx';

const drafts = new Map<string, string>();
const MAX_HEIGHT = 220;

export function Composer({
  chatId,
  onChatCreated,
  seed,
}: {
  chatId: string | null;
  onChatCreated: (id: string) => void;
  seed: { text: string; n: number } | null;
}) {
  const t = useT();
  const locale = useLocale();
  const user = useAuth((s) => s.user);
  const config = useUi((s) => s.config);
  const mode = useUi((s) => s.mode);
  const setMode = useUi((s) => s.setMode);
  const effort = useUi((s) => s.effort);
  const setEffort = useUi((s) => s.setEffort);
  const generating = useChats((s) => s.generating);
  const prefill = useUi((s) => s.prefill);
  const draftKey = chatId ?? 'new';

  const [value, setValue] = useState(() => drafts.get(draftKey) ?? '');
  const [files, setFiles] = useState<PendingAttachment[]>([]);
  const [dragging, setDragging] = useState(false);
  const [listening, setListening] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);
  const dictation = useRef<Dictation | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const limits = config?.limits;
  const maxChars = limits?.maxMessageChars ?? 4_000;
  const canAttach = Boolean(limits?.features.attachments);
  const busy = Boolean(generating);
  const remaining = config ? Math.max(0, config.usage.limit - config.usage.used) : null;
  const coarse = useMemo(() => matchMedia('(pointer: coarse)').matches, []);

  // Sohbet değişince taslağı geri yükle.
  useEffect(() => {
    setValue(drafts.get(draftKey) ?? '');
    setFiles([]);
    if (!coarse) ta.current?.focus();
  }, [draftKey, coarse]);

  useEffect(() => {
    if (seed) {
      setValue(seed.text);
      ta.current?.focus();
    }
  }, [seed]);

  useEffect(() => {
    if (prefill) {
      setValue(prefill.text);
      drafts.set(draftKey, prefill.text);
      ta.current?.focus();
    }
  }, [prefill]); // eslint-disable-line react-hooks/exhaustive-deps

  const resize = useCallback(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }, []);
  useEffect(resize, [value, resize]);

  useEffect(() => () => dictation.current?.stop(), []);

  const update = (v: string) => {
    setValue(v);
    drafts.set(draftKey, v);
  };

  const addFiles = async (list: FileList | File[]) => {
    const ui = useUi.getState();
    if (!canAttach) return lockedNotice();
    const room = (limits?.maxAttachments ?? 0) - files.length;
    if (room <= 0) return ui.toast({ kind: 'info', text: t('composer.attachMax', { n: limits?.maxAttachments ?? 0 }) });
    const next: PendingAttachment[] = [];
    for (const f of Array.from(list).slice(0, room)) {
      const r = await readTextFile(f);
      if (!r.ok) {
        ui.toast({ kind: 'error', text: t('composer.attachUnsupported', { name: f.name }) });
        continue;
      }
      if (r.file.truncated) ui.toast({ kind: 'info', text: t('composer.attachTooBig', { name: f.name, n: r.file.text.length }) });
      next.push(r.file);
    }
    if (next.length) setFiles((cur) => [...cur, ...next]);
  };

  const lockedNotice = () => {
    const ui = useUi.getState();
    if (user?.isGuest) {
      ui.toast({ kind: 'info', text: t('limits.title'), action: { label: t('limits.upgrade'), run: () => ui.openAuth('register') } });
    } else {
      ui.toast({ kind: 'info', text: t('composer.attachLocked'), action: { label: t('limits.verify'), run: () => ui.openAuth('verify') } });
    }
  };

  const submit = () => {
    const text = value.trim();
    if (!text || busy) return;
    if (text.length > maxChars) return useUi.getState().toast({ kind: 'error', text: t('composer.tooLong') });
    dictation.current?.stop();
    void useChats.getState().send({ content: text, attachments: files, chatId, onChatCreated });
    update('');
    drafts.delete(draftKey);
    setFiles([]);
  };

  const toggleDictation = () => {
    if (listening) {
      dictation.current?.stop();
      return;
    }
    let base = value ? `${value.trimEnd()} ` : '';
    const d = startDictation(locale, {
      onText: (finalText, interim) => {
        base += finalText;
        setValue(base + interim);
      },
      onEnd: () => {
        setListening(false);
        setValue((v) => {
          drafts.set(draftKey, v);
          return v;
        });
      },
    });
    if (d) {
      dictation.current = d;
      setListening(true);
    }
  };

  const modes: Array<{ id: ChatMode; label: string; hint: string }> = CHAT_MODES.map((id) => ({ id, label: t(`composer.mode.${id}`), hint: t(`composer.mode.${id}Hint`) }));
  const levels: Array<{ id: Effort; label: string; hint: string }> = THINKING_LEVELS.map((id) => ({ id, label: t(`composer.thinking.${id}`), hint: t(`composer.thinking.${id}Hint`) }));
  const currentMode = modes.find((m) => m.id === mode) ?? modes[0]!;
  const depthOf = (m: ChatMode): 1 | 2 | 3 => (m === 'fast' ? 1 : m === 'balanced' ? 2 : 3);
  const currentLevel = levels.find((l) => l.id === effort) ?? levels[1]!;
  const over = value.length > maxChars;
  const showCounter = value.length > maxChars * 0.8;
  const lowQuota = remaining !== null && (user?.isGuest || remaining <= 5);

  return (
    <div className="composer-wrap">
      <div
        className={clsx('composer', dragging && 'dragging', busy && 'is-busy')}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files.length) void addFiles(e.dataTransfer.files);
        }}
      >
        {files.length > 0 && (
          <div className="composer-files">
            {files.map((f, i) => (
              <span key={`${f.name}-${i}`} className="file-chip removable" title={f.name}>
                <FileText size={14} />
                <span>{f.name}</span>
                <button aria-label={t('common.delete')} onClick={() => setFiles((cur) => cur.filter((_, j) => j !== i))}>
                  <X size={13} />
                </button>
              </span>
            ))}
          </div>
        )}
        <textarea
          ref={ta}
          className="composer-input"
          rows={1}
          value={value}
          placeholder={user?.isGuest ? t('composer.placeholderGuest') : t('composer.placeholder')}
          onChange={(e) => update(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && !coarse) {
              e.preventDefault();
              submit();
            }
          }}
          aria-label={t('composer.placeholder')}
        />
        <div className="composer-bar">
          <div className="composer-tools">
            <input
              ref={fileInput}
              type="file"
              hidden
              multiple
              accept={ACCEPT_ATTR}
              onChange={(e) => {
                if (e.target.files) void addFiles(e.target.files);
                e.target.value = '';
              }}
            />
            <button
              className={clsx('icon-btn', !canAttach && 'is-locked')}
              title={canAttach ? t('composer.attach') : t('composer.attachLocked')}
              aria-label={t('composer.attach')}
              onClick={() => (canAttach ? fileInput.current?.click() : lockedNotice())}
            >
              {canAttach ? <Paperclip size={18} /> : <Lock size={16} />}
            </button>
            {dictationSupported() && (
              <button
                className={clsx('icon-btn', listening && 'is-active is-listening')}
                aria-pressed={listening}
                title={listening ? t('composer.voiceStop') : t('composer.voice')}
                aria-label={listening ? t('composer.voiceStop') : t('composer.voice')}
                onClick={toggleDictation}
              >
                {listening ? <MicOff size={18} /> : <Mic size={18} />}
              </button>
            )}
            <Popover
              direction="up"
              menuClassName="effort-menu"
              trigger={({ toggle, open }) => (
                <button className={clsx('effort-btn', open && 'is-active')} onClick={toggle} aria-haspopup="menu" aria-expanded={open}>
                  <SlashMeter level={depthOf(mode)} />
                  <span>{currentMode.label}</span>
                </button>
              )}
            >
              {() => (
                <>
                  {modes.map((m) => (
                    <button key={m.id} className="mode-row" role="menuitemradio" aria-checked={mode === m.id} onClick={() => setMode(m.id)}>
                      <span className="grow">
                        {m.label}
                        <small>{m.hint}</small>
                      </span>
                      <SlashMeter level={depthOf(m.id)} />
                    </button>
                  ))}
                  <div className="think">
                    <div className="think-head">
                      <span>{t('composer.thinking')}</span>
                      {modeSupportsThinkingLevel(mode) && <span className="think-now">{currentLevel.label}</span>}
                    </div>
                    {modeSupportsThinkingLevel(mode) ? (
                      <>
                        <div className="seg" role="radiogroup" aria-label={t('composer.thinking')}>
                          {levels.map((l) => (
                            <button key={l.id} role="radio" aria-checked={effort === l.id} onClick={() => setEffort(l.id)}>
                              <span>{l.label}</span>
                            </button>
                          ))}
                        </div>
                        <small className="think-hint">{currentLevel.hint}</small>
                      </>
                    ) : (
                      <small className="think-hint">{t('composer.thinking.auto')}</small>
                    )}
                  </div>
                </>
              )}
            </Popover>
          </div>
          <div className="composer-end">
            {showCounter && (
              <span className={clsx('counter', over && 'over')}>{t('composer.chars', { n: value.length, max: maxChars })}</span>
            )}
            {busy ? (
              <button className="send-btn stop" onClick={() => useChats.getState().stop()} aria-label={t('composer.stop')} title={t('composer.stop')}>
                <Square size={14} fill="currentColor" />
              </button>
            ) : (
              <button className="send-btn" onClick={submit} disabled={!value.trim() || over} aria-label={t('composer.send')} title={t('composer.send')}>
                <ArrowUp size={18} strokeWidth={2.4} />
              </button>
            )}
          </div>
        </div>
      </div>
      <div className="composer-foot">
        {lowQuota && config ? (
          <span className={clsx('quota-note', remaining === 0 && 'out')}>
            {t('composer.remaining', { n: remaining ?? 0 })}
            {remaining === 0 ? ` · ${t('composer.remainingReset', { time: timeUntil(config.usage.resetsAt, locale) })}` : ''}
          </span>
        ) : (
          <span>{t('composer.disclaimer')}</span>
        )}
      </div>
    </div>
  );
}
