import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { Archive, ArchiveRestore, ArrowDown, Download, Ellipsis, FolderOpen, GitPullRequest, Pencil, Pin, PinOff, Trash2 } from 'lucide-react';
import { codeTranscriptMarkdown, type CodePullDTO, type CodeSessionDTO } from '@sixfinger/shared';
import { api } from '../lib/api.ts';
import { reportError } from '../lib/errors.ts';
import { clsx, downloadFile, slugify } from '../lib/format.ts';
import { useT } from '../lib/i18n/index.ts';
import { activePath, indexMessages } from '../lib/tree.ts';
import { selectPath, useChats } from '../store/chats.ts';
import { useCode } from '../store/code.ts';
import { useUi } from '../store/ui.ts';
import { ChangesSheet, ContextRing, Delta, PullsSheet, UsageSheet } from '../components/CodeSheets.tsx';
import { DiffSheet, FilesSheet } from '../components/CodeGitSheets.tsx';
import { CodeComposer } from '../components/CodeComposer.tsx';
import { CodeRunStatus } from '../components/CodeRunStatus.tsx';
import { CodeMascot } from '../components/CodeMascot.tsx';
import { CodeMessage, type MessageActions } from '../components/CodeMessage.tsx';
import { CodeTopBar } from '../components/CodeTopBar.tsx';
import { Popover } from '../components/Popover.tsx';

type Sheet = 'usage' | 'pulls' | 'changes' | null;

export function CodeSessionPage() {
  const t = useT();
  const nav = useNavigate();
  const location = useLocation();
  const { chatId } = useParams();
  const [session, setSession] = useState<CodeSessionDTO | null>(null);
  const [missing, setMissing] = useState(false);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [diffPath, setDiffPath] = useState<{ path?: string } | null>(null);
  const [filesOpen, setFilesOpen] = useState(false);
  const [focusSignal, setFocusSignal] = useState(0);
  const [pr, setPr] = useState<CodePullDTO | null>(null);

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

  const update = async (patch: { title?: string; pinned?: boolean; archived?: boolean }) => {
    if (!session || !(await useCode.getState().updateSession(session.chatId, patch))) return;
    setSession({ ...session, ...patch });
    if (patch.archived) nav('/code', { replace: true });
  };
  const rename = () => {
    const next = window.prompt(t('code.session.renamePrompt'), title)?.trim();
    if (next && next !== title) void update({ title: next.slice(0, 120) });
  };
  const exportMd = () => {
    if (!session) return;
    const md = codeTranscriptMarkdown({ title, repo: session.repo, branch: session.workBranch, base: session.baseBranch, prUrl: session.prUrl }, path, { you: t('common.you'), ai: 'SixFinger' });
    downloadFile(`${slugify(title) || 'session'}.md`, md, 'text/markdown');
  };



  // Çalışma süresi sayacı ve çalışan alt ajan sayısı (durum çubuğu).
  const [startedAt, setStartedAt] = useState(0);
  useEffect(() => setStartedAt(generating ? Date.now() : 0), [Boolean(generating)]); // eslint-disable-line react-hooks/exhaustive-deps
  const runningTasks = useMemo(() => {
    const m = path.find((x) => x.id === generating?.assistantId);
    return m ? m.parts.filter((p) => p.type === 'tool' && p.name === 'task' && p.status === 'running').length : 0;
  }, [path, generating?.assistantId]);

  // Alttaki PR çipi: oturumun PR'ının güncel durumu (açık/birleştirildi/kapatıldı).
  useEffect(() => {
    if (!chatId || !session?.prNumber || generating) return;
    let off = false;
    api
      .codePulls(chatId)
      .then((r) => !off && setPr(r.pulls.find((p) => p.number === session.prNumber) ?? r.pulls[0] ?? null))
      .catch(() => {});
    return () => {
      off = true;
    };
  }, [chatId, session?.prNumber, session?.headSha, generating]);

  // Soru/plan kartlarının düğmeleri (yalnızca son mesajda ve ajan çalışmıyorken).
  const actions = useMemo<MessageActions | undefined>(() => {
    if (!chatId) return undefined;
    return {
      answerable: !generating,
      onAnswer: (answer) => void useChats.getState().send({ content: answer, chatId, planMode: useCode.getState().plan[chatId] || undefined }),
      onApprove: () => {
        useCode.getState().setPlan(chatId, false);
        void useChats.getState().send({ content: t('code.plan.approveText'), chatId });
      },
      onRevise: () => setFocusSignal((n) => n + 1),
    };
  }, [chatId, generating, t]);

  const rewind = useCallback(
    async (messageId: string) => {
      if (!chatId) return;
      try {
        const r = await api.codeRewind(chatId, messageId);
        setSession(r.session);
        await useChats.getState().openChat(chatId, true);
        useUi.getState().toast({ kind: 'success', text: t('code.rewind.done') });
      } catch (err) {
        reportError(err);
      }
    },
    [chatId, t],
  );

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
                  <>
                  <button
                    className="menu-item"
                    onClick={() => {
                      close();
                      setFilesOpen(true);
                    }}
                  >
                    <FolderOpen size={16} /> {t('code.menu.files')}
                  </button>
                  <button className="menu-item" onClick={() => { close(); rename(); }}>
                    <Pencil size={16} /> {t('code.session.rename')}
                  </button>
                  <button className="menu-item" onClick={() => { close(); void update({ pinned: !session.pinned }); }}>
                    {session.pinned ? <PinOff size={16} /> : <Pin size={16} />} {session.pinned ? t('code.session.unpin') : t('code.session.pin')}
                  </button>
                  <button className="menu-item" onClick={() => { close(); exportMd(); }}>
                    <Download size={16} /> {t('code.session.export')}
                  </button>
                  <button className="menu-item" onClick={() => { close(); void update({ archived: !session.archived }); }}>
                    {session.archived ? <ArchiveRestore size={16} /> : <Archive size={16} />} {session.archived ? t('code.session.unarchive') : t('code.session.archive')}
                  </button>
                  <button
                    className="menu-item danger"
                    onClick={() => {
                      close();
                      void remove();
                    }}
                  >
                    <Trash2 size={16} /> {t('code.session.delete')}
                  </button>
                  </>
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
            return <CodeMessage key={m.id} msg={m} streaming={streaming} actions={m.id === last?.id ? actions : undefined} onRewind={generating ? undefined : rewind} />;
          })}
        </div>
        {showJump && (
          <button className="jump-btn" onClick={() => scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' })} aria-label="Scroll to bottom">
            <ArrowDown size={16} />
          </button>
        )}
      </div>
      <div className="code-bottom">
        {generating && <CodeRunStatus live={live} startedAt={startedAt} runningTasks={runningTasks} />}
        {session && ((changes && (changes.additions > 0 || changes.deletions > 0)) || pr) && (
          <div className="chip-row">
            {changes && (changes.additions > 0 || changes.deletions > 0) && (
              <button className="chip diff-chip" onClick={() => setSheet('changes')} aria-label={t('code.changes')}>
                <strong>{t('code.chip.diff')}</strong>
                <Delta add={changes.additions} del={changes.deletions} />
                {session.headSha && session.headSha !== session.pushedSha && <span className="unpushed-dot" title={t('code.pr.unpushed')} aria-label={t('code.pr.unpushed')} />}
              </button>
            )}
            {pr && (
              <a className={clsx('chip pr-chip', pr.state)} href={pr.url} target="_blank" rel="noreferrer">
                <GitPullRequest size={14} />
                <span>
                  #{pr.number} · {session.repo.split('/')[1]}
                </span>
                <strong>{pr.draft && pr.state === 'open' ? t('code.pr.draft') : t(`code.pr.${pr.state}`)}</strong>
              </a>
            )}
          </div>
        )}
        <CodeComposer session={session} generating={Boolean(generating)} focusSignal={focusSignal} />
      </div>
      {sheet === 'usage' && ctx && <UsageSheet tokens={ctx.tokens} limit={ctx.limit} onClose={() => setSheet(null)} />}
      {sheet === 'pulls' && chatId && <PullsSheet chatId={chatId} onClose={() => setSheet(null)} onChanged={() => { loadSession(); void useChats.getState().openChat(chatId, true); }} />}
      {sheet === 'changes' && chatId && (
        <ChangesSheet chatId={chatId} running={Boolean(generating)} onClose={() => setSheet(null)} onDiff={(path) => setDiffPath({ path })} />
      )}
      {filesOpen && chatId && <FilesSheet chatId={chatId} onClose={() => setFilesOpen(false)} />}
      {diffPath && chatId && <DiffSheet chatId={chatId} path={diffPath.path} onClose={() => setDiffPath(null)} />}
    </div>
  );
}
