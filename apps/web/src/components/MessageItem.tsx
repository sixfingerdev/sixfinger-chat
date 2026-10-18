import { memo, useEffect, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Copy, FileText, Pencil, RefreshCw, ThumbsDown, ThumbsUp, Volume2, Square } from 'lucide-react';
import type { MessageDTO } from '@sixfinger/shared';
import { clsx, copyText } from '../lib/format.ts';
import { useLocale, useT } from '../lib/i18n/index.ts';
import { speak, stopSpeaking, ttsSupported } from '../lib/speech.ts';
import type { Versions } from '../lib/tree.ts';
import { useChats } from '../store/chats.ts';
import { messageParts } from '@sixfinger/shared';
import { LogoMark } from './Logo.tsx';
import { RichText } from './RichText.tsx';
import { ReasoningBlock } from './ReasoningBlock.tsx';
import { ToolCard } from './ToolCard.tsx';

interface Props {
  msg: MessageDTO;
  versions: Versions;
  isLast: boolean;
  /** Bu mesaj şu an üretiliyor. */
  live: boolean;
  /** Sohbette herhangi bir üretim sürüyor. */
  busy: boolean;
}

function VersionNav({ versions, chatId, disabled }: { versions: Versions; chatId: string; disabled: boolean }) {
  const t = useT();
  if (versions.total < 2) return null;
  const go = (delta: number) => {
    const id = versions.ids[versions.index + delta];
    if (id) useChats.getState().switchVersion(chatId, id);
  };
  return (
    <span className="version-nav" aria-label={t('msg.version', { i: versions.index + 1, n: versions.total })}>
      <button className="icon-btn sm" disabled={disabled || versions.index === 0} onClick={() => go(-1)} aria-label={t('msg.prevVersion')}>
        <ChevronLeft size={15} />
      </button>
      <span className="version-count">
        {versions.index + 1}/{versions.total}
      </span>
      <button
        className="icon-btn sm"
        disabled={disabled || versions.index === versions.total - 1}
        onClick={() => go(1)}
        aria-label={t('msg.nextVersion')}
      >
        <ChevronRight size={15} />
      </button>
    </span>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="icon-btn sm"
      title={label}
      aria-label={label}
      onClick={async () => {
        if (await copyText(text)) {
          setDone(true);
          setTimeout(() => setDone(false), 1_500);
        }
      }}
    >
      {done ? <Check size={15} /> : <Copy size={15} />}
    </button>
  );
}

function UserMessage({ msg, versions, busy }: Props) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(msg.content);
  const ta = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!editing) return;
    const el = ta.current;
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
    }
  }, [editing]);

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    setEditing(false);
    void useChats.getState().send({
      content: text,
      chatId: msg.chatId,
      parentId: msg.parentId,
      attachments: msg.attachments.map((a) => ({ ...a, truncated: false })),
    });
  };

  if (editing) {
    return (
      <div className="msg msg-user editing">
        <div className="edit-box">
          <textarea
            ref={ta}
            className="edit-textarea"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = `${Math.min(e.target.scrollHeight, 320)}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
              if (e.key === 'Escape') setEditing(false);
            }}
          />
          <div className="edit-actions">
            <button className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>
              {t('common.cancel')}
            </button>
            <button className="btn btn-primary btn-sm" onClick={submit} disabled={!draft.trim()}>
              {t('msg.editSave')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="msg msg-user">
      {msg.attachments.length > 0 && (
        <div className="msg-attachments">
          {msg.attachments.map((a, i) => (
            <span key={i} className="file-chip" title={a.name}>
              <FileText size={14} />
              <span>{a.name}</span>
            </span>
          ))}
        </div>
      )}
      <div className="bubble">{msg.content}</div>
      <div className="msg-actions">
        <VersionNav versions={versions} chatId={msg.chatId} disabled={busy} />
        <CopyButton text={msg.content} label={t('msg.copy')} />
        <button
          className="icon-btn sm"
          title={t('msg.edit')}
          aria-label={t('msg.edit')}
          disabled={busy}
          onClick={() => {
            setDraft(msg.content);
            setEditing(true);
          }}
        >
          <Pencil size={15} />
        </button>
      </div>
    </div>
  );
}

function AssistantMessage({ msg, versions, isLast, live, busy }: Props) {
  const t = useT();
  const locale = useLocale();
  const [speaking, setSpeaking] = useState(false);
  const streaming = live || msg.status === 'streaming';
  const hasAnswer = msg.content.length > 0;
  const ordered = messageParts(msg);
  const waiting = streaming && ordered.length === 0;

  useEffect(() => () => {
    if (speaking) stopSpeaking();
  }, [speaking]);

  return (
    <div className={clsx('msg msg-assistant', streaming && 'is-streaming')}>
      <div className="msg-avatar" aria-hidden>
        <LogoMark size={14} animate={streaming} />
      </div>
      <div className="msg-main">
        {waiting && <div className="waiting-line" aria-label={t('msg.thinking')} />}
        {/* Sıralı parçalar: her düşünce parçası kendi bloğunda, araçtan sonraki düşünce aşağıda yeni blok olarak açılır. */}
        {ordered.map((p, i) =>
          p.type === 'reasoning' ? (
            <ReasoningBlock key={`r${i}`} text={p.text} thinking={streaming && i === ordered.length - 1} ms={p.ms} />
          ) : p.type === 'text' ? (
            <RichText key={`t${i}`} text={p.text} />
          ) : (
            <ToolCard key={p.id} part={p} />
          ),
        )}
        {!streaming && msg.status === 'stopped' && <div className="msg-note">{t('msg.stopped')}</div>}
        {!streaming && msg.status === 'error' && (
          <div className="msg-note error">
            {t('msg.failed')}{' '}
            <button className="link-btn" disabled={busy} onClick={() => void useChats.getState().regenerate(msg.chatId, msg.id)}>
              {t('common.retry')}
            </button>
          </div>
        )}
        {!streaming && (hasAnswer || msg.status === 'error') && (
          <div className={clsx('msg-actions', isLast && 'always')}>
            <VersionNav versions={versions} chatId={msg.chatId} disabled={busy} />
            {hasAnswer && <CopyButton text={msg.content} label={t('msg.copy')} />}
            {hasAnswer && (
              <>
                <button
                  className={clsx('icon-btn sm', msg.feedback === 1 && 'is-active')}
                  aria-pressed={msg.feedback === 1}
                  title={t('msg.good')}
                  aria-label={t('msg.good')}
                  onClick={() => void useChats.getState().setFeedback(msg.chatId, msg.id, msg.feedback === 1 ? null : 1)}
                >
                  <ThumbsUp size={15} />
                </button>
                <button
                  className={clsx('icon-btn sm', msg.feedback === -1 && 'is-active')}
                  aria-pressed={msg.feedback === -1}
                  title={t('msg.bad')}
                  aria-label={t('msg.bad')}
                  onClick={() => void useChats.getState().setFeedback(msg.chatId, msg.id, msg.feedback === -1 ? null : -1)}
                >
                  <ThumbsDown size={15} />
                </button>
                {ttsSupported() && (
                  <button
                    className={clsx('icon-btn sm', speaking && 'is-active')}
                    title={speaking ? t('msg.stopRead') : t('msg.read')}
                    aria-label={speaking ? t('msg.stopRead') : t('msg.read')}
                    onClick={() => {
                      if (speaking) {
                        stopSpeaking();
                        setSpeaking(false);
                      } else {
                        setSpeaking(true);
                        speak(msg.content, locale, () => setSpeaking(false));
                      }
                    }}
                  >
                    {speaking ? <Square size={14} /> : <Volume2 size={15} />}
                  </button>
                )}
              </>
            )}
            <button
              className="icon-btn sm"
              title={t('msg.regenerate')}
              aria-label={t('msg.regenerate')}
              disabled={busy}
              onClick={() => void useChats.getState().regenerate(msg.chatId, msg.id)}
            >
              <RefreshCw size={15} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export const MessageItem = memo(function MessageItem(props: Props) {
  return props.msg.role === 'user' ? <UserMessage {...props} /> : <AssistantMessage {...props} />;
});
