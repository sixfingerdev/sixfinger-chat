import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowDown, ArrowUp, Ellipsis, GitPullRequest, Square, Trash2 } from 'lucide-react';
import type { CodeSessionDTO } from '@sixfinger/shared';
import { api } from '../lib/api.ts';
import { reportError } from '../lib/errors.ts';
import { clsx } from '../lib/format.ts';
import { useT } from '../lib/i18n/index.ts';
import { activePath, indexMessages } from '../lib/tree.ts';
import { selectPath, useChats } from '../store/chats.ts';
import { useCode } from '../store/code.ts';
import { ChangesSheet, ContextRing, Delta, PullsSheet, UsageSheet } from '../components/CodeSheets.tsx';
import { CreatePrSheet, DiffSheet } from '../components/CodeGitSheets.tsx';
import { CodeMascot } from '../components/CodeMascot.tsx';
import { CodeMessage } from '../components/CodeMessage.tsx';
import { CodeTopBar } from '../components/CodeTopBar.tsx';
import { Popover } from '../components/Popover.tsx';

type Sheet = 'usage' | 'pulls' | 'changes' | 'pr' | null;

export function CodeSessionPage() {
  const t = useT();
  const nav = useNavigate();
  const location = useLocation();
  const { chatId } = useParams();
  const [session, setSession] = useState<CodeSessionDTO | null>(null);
  const [missing, setMissing] = useState(false);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [diffPath, setDiffPath] = useState<{ path?: string } | null>(null);
  const [text, setText] = useState('');
  const area = useRef<HTMLTextAreaElement>(null);

  const detail = useChats((s) => (chatId ? s.detail[chatId] : undefined));
  const generating = useChats((s) => (chatId ? s.generating[chatId] : undefined));
  const live = useChats((s) => (chatId ? s.codeLive[chatId] : undefined));

  const loadSession = () => {
    if (!chatId) return;
    api
      .codeSession(chatId)
      .then((r) => setSession(r.session))
      .catch((err) => {
        setMissing(true);
        reportError(err);
      });
  };

  // Oturumu ve mesajları aç. İlk istem (yeni-oturum ekranından) bir kez gönderilir.
  const firstPrompt = useRef<string | undefined>((location.state as { firstPrompt?: string } | null)?.firstPrompt);
  useEffect(() => {
    if (!chatId) return;
    setSession(null);
    setMissing(false);
    loadSession();
    let off = false;
    void useChats
      .getState()
      .openChat(chatId)
      .then(() => {
        const prompt = firstPrompt.current;
        if (off || !prompt || !useChats.getState().detail[chatId]) return;
        firstPrompt.current = undefined;
        nav('.', { replace: true, state: null });
        void useChats.getState().send({ content: prompt, chatId });
      });
    return () => {
      off = true;
    };
  }, [chatId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Tur bitince oturum istatistiklerini (değişiklik, disk, bağlam) sunucudan eşitle ve listeyi tazele.
  const wasRunning = useRef(false);
  useEffect(() => {
    if (generating) wasRunning.current = true;
    else if (wasRunning.current) {
      wasRunning.current = false;
      loadSession();
      void useCode.getState().loadSessions();
    }
  }, [generating]); // eslint-disable-line react-hooks/exhaustive-deps

  const idx = useMemo(() => (detail ? indexMessages(detail.messages) : null), [detail?.messages]); // eslint-disable-line react-hooks/exhaustive-deps
  const path = useMemo(() => (idx && detail ? activePath(idx, detail.chat.leafId) : selectPath(detail)), [idx, detail?.chat.leafId]); // eslint-disable-line react-hooks/exhaustive-deps
  const last = path[path.length - 1];

  // --- Otomatik kaydırma (sohbet ekranıyla aynı mantık) ---
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const lastTop = useRef(0);
  const [showJump, setShowJump] = useState(false);
  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (dist <= 24) stick.current = true;
    else if (el.scrollTop < lastTop.current - 1) stick.current = false;
    lastTop.current = el.scrollTop;
    setShowJump(dist > 360);
  };
  useLayoutEffect(() => {
    stick.current = true;
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chatId, Boolean(detail)]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [path.length, last?.content.length, last?.parts.length, live?.phase]);
  useEffect(() => {
    if (generating) stick.current = true;
  }, [generating?.assistantId]); // eslint-disable-line react-hooks/exhaustive-deps

  const remove = async () => {
    if (!session || !window.confirm(t('code.session.deleteConfirm'))) return;
    if (await useCode.getState().deleteSession(session.chatId)) nav('/code', { replace: true });
  };

  const title = detail?.chat.title && detail.chat.title !== 'Yeni oturum' ? detail.chat.title : session ? (session.title === 'Yeni oturum' ? t('code.session.untitled') : session.title) : '';
  const ctx = live?.context ?? (session ? { tokens: session.contextTokens, limit: session.contextLimit } : null);
  const changes = live?.changes ?? (session ? { additions: session.additions, deletions: session.deletions, files: session.filesChanged } : null);

  const grow = () => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  };
  const submit = () => {
    const content = text.trim();
    if (!content || !chatId || generating) return;
    setText('');
    requestAnimationFrame(grow);
    void useChats.getState().send({ content, chatId });
  };

  const empty = Boolean(session && detail && detail.messages.length === 0 && !generating);

  return (
    <div className="code-page">
      <CodeTopBar
        title={title}
        subtitle={session ? `${session.repo}${session.environmentName ? ` · ${session.environmentName}` : ''}` : undefined}
        right={
          session && (
            <>
              {ctx && ctx.limit > 0 && (
                <button className="icon-btn ctx-btn" onClick={() => setSheet('usage')} aria-label={t('code.usage.title')} title={t('code.usage.title')}>
                  <ContextRing tokens={ctx.tokens} limit={ctx.limit} />
                </button>
              )}
              <button className="icon-btn" onClick={() => setSheet('pulls')} aria-label={t('code.pr.title')} title={t('code.pr.title')}>
                <GitPullRequest size={18} />
              </button>
              <Popover
                align="end"
                trigger={({ toggle, open }) => (
                  <button className={clsx('icon-btn', open && 'is-active')} onClick={toggle} aria-label={t('code.session.menu')} aria-haspopup="menu">
                    <Ellipsis size={18} />
                  </button>
                )}
              >
                {(close) => (
                  <button
                    className="menu-item danger"
                    onClick={() => {
                      close();
                      void remove();
                    }}
                  >
                    <Trash2 size={16} /> {t('code.session.delete')}
                  </button>
                )}
              </Popover>
            </>
          )
        }
      />
      <div className="code-scroll" ref={scroller} onScroll={onScroll}>
        <div className="code-thread">
          {!session && !missing && <div className="skeleton" style={{ width: '60%', height: 20 }} />}
          {missing && (
            <div className="code-empty">
              <strong>{t('error.generic')}</strong>
            </div>
          )}
          {empty && (
            <div className="session-soon">
              <CodeMascot size={84} />
              <h2>{t('code.session.ready')}</h2>
              <p>{t('code.session.readyHint')}</p>
            </div>
          )}
          {path.map((m) => {
            const streaming = generating?.assistantId === m.id || m.status === 'streaming';
            return <CodeMessage key={m.id} msg={m} streaming={streaming} live={streaming ? live : undefined} />;
          })}
        </div>
        {showJump && (
          <button className="jump-btn" onClick={() => scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' })} aria-label="Scroll to bottom">
            <ArrowDown size={16} />
          </button>
        )}
      </div>
      <div className="composer-wrap">
        <div className="composer code-composer">
          <textarea
            ref={area}
            className="composer-input"
            rows={1}
            value={text}
            disabled={!session}
            placeholder={t('code.composer.placeholder')}
            aria-label={t('code.composer.placeholder')}
            onChange={(e) => {
              setText(e.target.value);
              grow();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && (e.metaKey || e.ctrlKey || !('ontouchstart' in window))) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <div className="composer-bar">
            <span className="composer-note">{session ? `${session.repo.split('/')[1]}  ⎇ ${session.workBranch}` : ''}</span>
            <div className="composer-end">
              {changes && (changes.additions > 0 || changes.deletions > 0) && (
                <button className="changes-chip" onClick={() => setSheet('changes')} aria-label={t('code.changes')} title={t('code.changes')}>
                  <Delta add={changes.additions} del={changes.deletions} />
                </button>
              )}
              {generating ? (
                <button className="send-btn stop" onClick={() => chatId && useChats.getState().stop(chatId)} aria-label={t('composer.stop')} title={t('composer.stop')}>
                  <Square size={14} fill="currentColor" />
                </button>
              ) : (
                <button className="send-btn" onClick={submit} disabled={!text.trim() || !session} aria-label={t('composer.send')} title={t('composer.send')}>
                  <ArrowUp size={18} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
      {sheet === 'usage' && ctx && <UsageSheet tokens={ctx.tokens} limit={ctx.limit} onClose={() => setSheet(null)} />}
      {sheet === 'pulls' && chatId && <PullsSheet chatId={chatId} onClose={() => setSheet(null)} onCreatePr={() => setSheet('pr')} />}
      {sheet === 'changes' && chatId && (
        <ChangesSheet chatId={chatId} running={Boolean(generating)} onClose={() => setSheet(null)} onDiff={(path) => setDiffPath({ path })} onCreatePr={() => setSheet('pr')} />
      )}
      {sheet === 'pr' && chatId && <CreatePrSheet chatId={chatId} onClose={() => setSheet(null)} onDone={loadSession} />}
      {diffPath && chatId && <DiffSheet chatId={chatId} path={diffPath.path} onClose={() => setDiffPath(null)} />}
    </div>
  );
}
