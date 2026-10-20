import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowUp, ChevronRight, Laptop, Square, Trash2 } from 'lucide-react';
import { api } from '../lib/api.ts';
import { reportError } from '../lib/errors.ts';
import { clsx, timeAgo } from '../lib/format.ts';
import { useLocale, useT } from '../lib/i18n/index.ts';
import { useAuth } from '../store/auth.ts';
import { CodeTopBar } from '../components/CodeTopBar.tsx';

export interface LinkDevice {
  id: string;
  name: string;
  platform: string;
  version: string;
  capabilities?: string[];
  online: boolean;
  sessions: number;
}
export interface LinkSession {
  deviceId: string;
  deviceName: string;
  id: string;
  title: string;
  directory: string;
  status: 'idle' | 'busy' | 'waiting';
  updatedAt: string;
  online: boolean;
}
interface LinkPart {
  type: string;
  text?: string;
  tool?: string;
  status?: string;
  title?: string;
  input?: string;
  output?: string;
  files?: string[];
  filename?: string;
}
interface LinkMessage {
  id: string;
  role: 'user' | 'assistant';
  parts: LinkPart[];
}
interface LinkCommand {
  id: string;
  kind: string;
  status: 'pending' | 'sent' | 'done' | 'failed' | 'expired';
  error: string | null;
}
interface LinkPending {
  kind: 'permission' | 'question';
  requestId: string;
  permission?: string;
  patterns?: string[];
  questions?: string;
}

/** Cihazlar ve cihazlardaki oturumlar (SixFinger Code CLI, `sixfinger link`). */
export function DevicesPage() {
  const t = useT();
  const locale = useLocale();
  const nav = useNavigate();
  const guest = Boolean(useAuth((s) => s.user)?.isGuest);
  const [devices, setDevices] = useState<LinkDevice[] | null>(null);
  const [sessions, setSessions] = useState<LinkSession[]>([]);
  const [newFor, setNewFor] = useState<string | null>(null);
  const [newDir, setNewDir] = useState('');
  const [newText, setNewText] = useState('');

  const load = useCallback(async () => {
    try {
      const [d, s] = await Promise.all([api.linkDevices(), api.linkSessions()]);
      setDevices(d.devices);
      setSessions(s.sessions);
    } catch (err) {
      setDevices((cur) => cur ?? []);
      reportError(err);
    }
  }, []);

  useEffect(() => {
    if (guest) return setDevices([]);
    void load();
    const id = setInterval(load, 5_000);
    return () => clearInterval(id);
  }, [guest, load]);

  const remove = async (d: LinkDevice) => {
    try {
      await api.linkDeviceDelete(d.id);
      void load();
    } catch (err) {
      reportError(err);
    }
  };

  return (
    <div className="code-page">
      <CodeTopBar title={<><Laptop size={15} /> {t('link.title')}</>} />
      <div className="code-scroll">
        <div className="code-inner">
          <p className="muted">{t('link.subtitle')}</p>
          {guest ? (
            <p className="muted">{t('link.guest')}</p>
          ) : devices === null ? (
            <div className="skeleton" style={{ height: 72, borderRadius: 16 }} />
          ) : devices.length === 0 ? (
            <div className="sched-empty">
              <Laptop size={28} />
              <p>{t('link.empty')}</p>
              <code>npm i -g sixfinger-code &amp;&amp; sixfinger link</code>
            </div>
          ) : (
            devices.map((d) => (
              <section key={d.id} style={{ display: 'grid', gap: 8, marginBottom: 18 }}>
                <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0, fontSize: 14 }}>
                  <i className={clsx('status-dot', d.online ? 'running' : 'idle')} />
                  {d.name}
                  <span className="muted" style={{ fontWeight: 400 }}>
                    {d.online ? t('link.online') : t('link.offline')} · {d.platform}
                  </span>
                  <button className="btn btn-ghost btn-sm danger" style={{ marginLeft: 'auto' }} onClick={() => remove(d)} aria-label={t('link.remove')} title={t('link.remove')}>
                    <Trash2 size={14} />
                  </button>
                </h3>
                {d.online && d.capabilities?.includes('new_session') && (
                  <div style={{ display: 'grid', gap: 8 }}>
                    {newFor === d.id ? (
                      <>
                        <input className="input" value={newDir} placeholder={t('link.newDir')} onChange={(e) => setNewDir(e.target.value)} />
                        <textarea className="input" rows={2} value={newText} placeholder={t('link.newText')} onChange={(e) => setNewText(e.target.value)} />
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button
                            className="btn btn-primary btn-sm"
                            onClick={async () => {
                              try {
                                await api.linkNewSession(d.id, { directory: newDir.trim() || undefined, text: newText.trim() || undefined });
                                setNewFor(null);
                                setNewDir('');
                                setNewText('');
                                setTimeout(load, 1500);
                              } catch (err) {
                                reportError(err);
                              }
                            }}
                          >
                            {t('link.newStart')}
                          </button>
                          <button className="btn btn-ghost btn-sm" onClick={() => setNewFor(null)}>
                            {t('link.newCancel')}
                          </button>
                        </div>
                      </>
                    ) : (
                      <button className="btn btn-ghost btn-sm" style={{ justifySelf: 'start' }} onClick={() => setNewFor(d.id)}>
                        {t('link.new')}
                      </button>
                    )}
                  </div>
                )}
                <ul className="skill-list">
                  {sessions
                    .filter((s) => s.deviceId === d.id)
                    .map((s) => (
                      <li key={s.id}>
                        <button className="skill-row" onClick={() => nav(`/code/devices/${s.deviceId}/${s.id}`)}>
                          <span className="skill-main">
                            <strong className="mcp-row-title">
                              <i className={clsx('status-dot', s.status === 'busy' ? 'running' : s.status === 'waiting' ? 'waiting' : 'idle')} /> {s.title || t('code.session.untitled')}
                              {s.status === 'waiting' && <span className="mcp-chip error">{t('link.waiting')}</span>}
                            </strong>
                            <span>
                              {s.directory} · {timeAgo(s.updatedAt, locale)}
                            </span>
                          </span>
                          <ChevronRight size={15} className="code-row-go" />
                        </button>
                      </li>
                    ))}
                  {d.sessions === 0 && <li className="muted">{t('link.noSessions')}</li>}
                </ul>
              </section>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function PartView({ p }: { p: LinkPart }) {
  if (p.type === 'text') return <div className="sched-prompt" style={{ maxHeight: 'none' }}>{p.text}</div>;
  if (p.type === 'reasoning') return <div className="muted" style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{p.text}</div>;
  if (p.type === 'tool')
    return (
      <details className="sched-prompt" style={{ maxHeight: 'none' }}>
        <summary>
          <strong>{p.tool}</strong> {p.title} <span className="muted">· {p.status}</span>
        </summary>
        <pre style={{ margin: '8px 0 0', whiteSpace: 'pre-wrap' }}>{p.input}</pre>
        {p.output && <pre style={{ margin: '8px 0 0', whiteSpace: 'pre-wrap', opacity: 0.85 }}>{p.output}</pre>}
      </details>
    );
  if (p.type === 'patch') return <div className="muted">± {(p.files ?? []).join(', ')}</div>;
  if (p.type === 'file') return <div className="muted">📎 {p.filename}</div>;
  // Sunucunun/arayüzün tanımadığı parça türü (CLI'da yeni bir araç olabilir): genel kart.
  return (
    <div className="muted" style={{ fontSize: 13 }}>
      [{p.type}] {p.title || p.text || p.tool || ''}
    </div>
  );
}

/** Cihazdaki bir oturumu izle ve yönet: mesajlar, bekleyen izinler, mesaj gönder, durdur. */
export function DeviceSessionPage() {
  const t = useT();
  const { deviceId = '', id = '' } = useParams();
  const [session, setSession] = useState<LinkSession | null>(null);
  const [messages, setMessages] = useState<LinkMessage[]>([]);
  const [pending, setPending] = useState<LinkPending[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const [commands, setCommands] = useState<LinkCommand[]>([]);

  const apply = useCallback((r: { session: LinkSession; messages: unknown[]; pending: unknown[]; commands?: unknown[] }) => {
    setSession(r.session);
    setMessages(r.messages as LinkMessage[]);
    setPending(r.pending as LinkPending[]);
    setCommands((r.commands ?? []) as LinkCommand[]);
  }, []);

  const load = useCallback(async () => {
    try {
      apply(await api.linkSession(deviceId, id));
    } catch (err) {
      reportError(err);
    }
  }, [deviceId, id, apply]);

  // Canlı akış (SSE); kopunca 2 sn sonra yeniden bağlanır, bağlanamazken tek seferlik okumayla güncel kalır.
  useEffect(() => {
    const ac = new AbortController();
    let stopped = false;
    (async () => {
      while (!stopped) {
        try {
          await api.linkStream(deviceId, id, (d) => apply(d as Parameters<typeof apply>[0]), ac.signal);
        } catch {
          if (stopped) return;
          void load();
        }
        if (!stopped) await new Promise((r) => setTimeout(r, 2_000));
      }
    })();
    return () => {
      stopped = true;
      ac.abort();
    };
  }, [deviceId, id, apply, load]);

  const count = messages.length + (messages[messages.length - 1]?.parts.length ?? 0);
  useEffect(() => endRef.current?.scrollIntoView({ block: 'end' }), [count]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      void load();
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(false);
    }
  };

  const send = () => {
    const v = text.trim();
    if (!v) return;
    setText('');
    void act(() => api.linkPrompt(deviceId, id, v));
  };

  const offline = session ? !session.online : false;

  return (
    <div className="code-page">
      <CodeTopBar title={<><Laptop size={15} /> {session?.title || t('code.session.untitled')}</>} subtitle={session ? `${session.deviceName} · ${session.directory}` : undefined} />
      <div className="code-scroll">
        <div className="code-inner" style={{ display: 'grid', gap: 12 }}>
          {offline && <p className="hint">{t('link.offlineHint')}</p>}
          {messages.map((m) => (
            <div key={m.id} style={{ display: 'grid', gap: 6, justifyItems: m.role === 'user' ? 'end' : 'stretch' }}>
              {m.parts.map((p, i) => (
                <PartView key={i} p={p} />
              ))}
            </div>
          ))}
          {pending.map((q) => (
            <div key={q.requestId} className="sched-prompt" style={{ maxHeight: 'none', display: 'grid', gap: 8 }}>
              {q.kind === 'permission' ? (
                <>
                  <strong>{t('link.permission', { name: q.permission ?? '' })}</strong>
                  <code>{(q.patterns ?? []).join(' ')}</code>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button className="btn btn-primary btn-sm" disabled={busy || offline} onClick={() => act(() => api.linkPermission(deviceId, id, q.requestId, 'once'))}>
                      {t('link.allowOnce')}
                    </button>
                    <button className="btn btn-ghost btn-sm" disabled={busy || offline} onClick={() => act(() => api.linkPermission(deviceId, id, q.requestId, 'reject'))}>
                      {t('link.reject')}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <strong>{t('link.question')}</strong>
                  <span>{q.questions}</span>
                  <span className="muted">{t('link.questionHint')}</span>
                </>
              )}
            </div>
          ))}
          {commands
            .filter((c) => c.status === 'failed' || c.status === 'pending' || c.status === 'sent')
            .slice(0, 3)
            .map((c) => (
              <div key={c.id} className="muted" style={{ fontSize: 13 }}>
                {c.status === 'failed' ? t('link.cmdFailed', { kind: c.kind, error: c.error ?? '' }) : t('link.cmdSending', { kind: c.kind })}
              </div>
            ))}
          <div ref={endRef} />
        </div>
      </div>
      <div className="code-inner" style={{ display: 'flex', gap: 8, padding: '10px 16px 16px' }}>
        <textarea
          className="input"
          rows={2}
          style={{ flex: 1, resize: 'none' }}
          value={text}
          placeholder={t('link.placeholder')}
          disabled={offline}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        {session?.status === 'busy' ? (
          <button className="btn btn-ghost" onClick={() => act(() => api.linkAbort(deviceId, id))} aria-label={t('composer.stop')} title={t('composer.stop')}>
            <Square size={16} />
          </button>
        ) : (
          <button className="btn btn-primary" disabled={!text.trim() || offline || busy} onClick={send} aria-label={t('composer.send')} title={t('composer.send')}>
            <ArrowUp size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
