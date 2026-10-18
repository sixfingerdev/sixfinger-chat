import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Archive,
  ArrowDown,
  Download,
  Ellipsis,
  FileJson,
  Lock,
  Menu,
  PanelLeftOpen,
  Pin,
  PinOff,
  Share2,
  Trash2,
} from 'lucide-react';
import { PERSONAS, getPersona, pickGreeting } from '@sixfinger/shared';
import { api } from '../lib/api.ts';
import { reportError } from '../lib/errors.ts';
import { exportJson, exportMarkdown } from '../lib/export.ts';
import { clsx } from '../lib/format.ts';
import { useLocale, useT } from '../lib/i18n/index.ts';
import { activePath, indexMessages, versionsOf } from '../lib/tree.ts';
import { useAuth } from '../store/auth.ts';
import { useChats } from '../store/chats.ts';
import { useUi } from '../store/ui.ts';
import { Banners } from '../components/Banners.tsx';
import { Composer } from '../components/Composer.tsx';
import { LogoMark } from '../components/Logo.tsx';
import { MessageItem } from '../components/MessageItem.tsx';
import { PersonaIcon } from '../components/PersonaIcon.tsx';
import { Popover } from '../components/Popover.tsx';
import { ShareDialog } from '../components/ShareDialog.tsx';

function TopBar({ chatId }: { chatId: string | undefined }) {
  const t = useT();
  const locale = useLocale();
  const nav = useNavigate();
  const detail = useChats((s) => (chatId ? s.detail[chatId] : undefined));
  const draftPersona = useChats((s) => s.draftPersona);
  const user = useAuth((s) => s.user);
  const features = useUi((s) => s.config?.limits.features);
  const collapsed = useUi((s) => s.sidebarCollapsed);
  const toggleSidebar = useUi((s) => s.toggleSidebar);
  const [shareUrl, setShareUrl] = useState<string | null>(null);

  const chat = detail?.chat;
  const personaId = chat?.personaId ?? draftPersona ?? 'default';
  const persona = getPersona(personaId);
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState('');
  const hasMessages = Boolean(detail && detail.messages.length);

  useEffect(() => setRenaming(false), [chatId]);

  const pathMessages = () => (detail ? activePath(indexMessages(detail.messages), detail.chat.leafId) : []);

  const choosePersona = (id: string) => {
    if (id !== 'default' && !features?.personas) {
      useUi.getState().toast({
        kind: 'info',
        text: t('limits.title'),
        action: { label: t('limits.upgrade'), run: () => useUi.getState().openAuth('register') },
      });
      return;
    }
    if (chat) void useChats.getState().setPersona(chat.id, id);
    else useChats.getState().setDraftPersona(id);
  };

  const share = async () => {
    if (!chat) return;
    if (!features?.share) {
      useUi.getState().toast({
        kind: 'info',
        text: user?.isGuest ? t('limits.title') : t('composer.attachLocked'),
        action: user?.isGuest
          ? { label: t('limits.upgrade'), run: () => useUi.getState().openAuth('register') }
          : { label: t('limits.verify'), run: () => useUi.getState().openAuth('verify') },
      });
      return;
    }
    try {
      const { slug, url } = await api.share(chat.id);
      useChats.setState({
        detail: { ...useChats.getState().detail, [chat.id]: { ...detail!, chat: { ...chat, shareSlug: slug } } },
      });
      setShareUrl(url);
    } catch (err) {
      reportError(err);
    }
  };

  return (
    <header className="topbar">
      <div className="topbar-left">
        <button className="icon-btn mobile-only" onClick={toggleSidebar} aria-label={t('sidebar.toggle')}>
          <Menu size={20} />
        </button>
        {collapsed && (
          <button className="icon-btn desktop-only" onClick={toggleSidebar} aria-label={t('sidebar.toggle')} title={t('sidebar.toggle')}>
            <PanelLeftOpen size={18} />
          </button>
        )}
        <Popover
          trigger={({ toggle, open }) => (
            <button className={clsx('persona-btn', open && 'is-active')} onClick={toggle} aria-haspopup="menu" aria-expanded={open}>
              <PersonaIcon name={persona.icon} size={15} />
              <span>{persona.name[locale]}</span>
            </button>
          )}
        >
          {(close) => (
            <>
              <div className="menu-label">{t('chat.persona')}</div>
              {PERSONAS.map((p) => {
                const locked = p.id !== 'default' && !features?.personas;
                return (
                  <button
                    key={p.id}
                    className="menu-item"
                    data-active={p.id === personaId}
                    onClick={() => {
                      close();
                      choosePersona(p.id);
                    }}
                  >
                    <PersonaIcon name={p.icon} size={16} />
                    <span className="grow">
                      {p.name[locale]}
                      <small>{p.description[locale]}</small>
                    </span>
                    {locked && <Lock size={14} />}
                  </button>
                );
              })}
            </>
          )}
        </Popover>
      </div>

      <div className="topbar-title">
        {chat && hasMessages &&
          (renaming ? (
            <input
              className="title-input"
              autoFocus
              value={title}
              maxLength={120}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => {
                setRenaming(false);
                const v = title.trim();
                if (v && v !== chat.title) void useChats.getState().renameChat(chat.id, v);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') setRenaming(false);
              }}
            />
          ) : (
            <button
              className="title-btn"
              title={t('common.rename')}
              onClick={() => {
                setTitle(chat.title);
                setRenaming(true);
              }}
            >
              {chat.title}
            </button>
          ))}
      </div>

      <div className="topbar-right">
        {chat && hasMessages && (
          <>
            <button className="btn btn-ghost btn-sm share-btn" onClick={share}>
              <Share2 size={15} /> <span>{t('chat.share')}</span>
            </button>
            <Popover
              align="end"
              trigger={({ toggle, open }) => (
                <button className={clsx('icon-btn', open && 'is-active')} onClick={toggle} aria-label="Menu" aria-haspopup="menu">
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
                      exportMarkdown(chat.title, pathMessages(), { you: t('common.you'), ai: 'SixFinger' });
                    }}
                  >
                    <Download size={16} /> {t('chat.exportMd')}
                  </button>
                  <button
                    className="menu-item"
                    onClick={() => {
                      close();
                      exportJson(chat.title, pathMessages());
                    }}
                  >
                    <FileJson size={16} /> {t('chat.exportJson')}
                  </button>
                  <div className="menu-sep" />
                  <button
                    className="menu-item"
                    disabled={!features?.pin}
                    onClick={() => {
                      close();
                      void useChats.getState().pinChat(chat.id, !chat.pinned);
                    }}
                  >
                    {chat.pinned ? <PinOff size={16} /> : <Pin size={16} />} {chat.pinned ? t('chat.unpin') : t('chat.pin')}
                  </button>
                  <button
                    className="menu-item"
                    onClick={async () => {
                      close();
                      await useChats.getState().archiveChat(chat.id, !chat.archived);
                      if (!chat.archived) nav('/');
                    }}
                  >
                    <Archive size={16} /> {chat.archived ? t('chat.unarchive') : t('chat.archive')}
                  </button>
                  <div className="menu-sep" />
                  <button
                    className="menu-item danger"
                    onClick={async () => {
                      close();
                      if (!window.confirm(t('chat.deleteConfirm'))) return;
                      if (await useChats.getState().deleteChat(chat.id)) {
                        useUi.getState().toast({ kind: 'success', text: t('chat.deleted') });
                        nav('/');
                      }
                    }}
                  >
                    <Trash2 size={16} /> {t('common.delete')}
                  </button>
                </>
              )}
            </Popover>
          </>
        )}
      </div>
      {chat && shareUrl && <ShareDialog chatId={chat.id} url={shareUrl} onClose={() => setShareUrl(null)} />}
    </header>
  );
}

function EmptyState() {
  const locale = useLocale();
  const user = useAuth((s) => s.user);
  const name = user && !user.isGuest ? user.settings.customName || user.displayName.split(' ')[0] : undefined;
  const greeting = useMemo(() => pickGreeting({ locale, name, hour: new Date().getHours() }), [locale, name]);
  return (
    <div className="empty">
      <div className="empty-hero">
        <LogoMark size={44} animate className="empty-mark" />
        <h1>{greeting}</h1>
      </div>
    </div>
  );
}

export function ChatPage() {
  const t = useT();
  const nav = useNavigate();
  const { chatId } = useParams();
  const detail = useChats((s) => (chatId ? s.detail[chatId] : undefined));
  const loadError = useChats((s) => s.loadError);
  const loadingId = useChats((s) => s.loadingId);
  const generating = useChats((s) => (chatId ? s.generating[chatId] : undefined));

  useEffect(() => {
    if (chatId) void useChats.getState().openChat(chatId);
    else useChats.getState().newChat();
  }, [chatId]);

  const idx = useMemo(() => (detail ? indexMessages(detail.messages) : null), [detail?.messages]); // eslint-disable-line react-hooks/exhaustive-deps
  const path = useMemo(() => (idx && detail ? activePath(idx, detail.chat.leafId) : []), [idx, detail?.chat.leafId]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Otomatik kaydırma ---
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [showJump, setShowJump] = useState(false);
  const last = path[path.length - 1];

  const lastTop = useRef(0);
  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    // Alta yakınsa akışı takip et; uzaktaysa ve kullanıcı yukarı çektiyse bırak.
    // (İçerik büyümesi ve kendi kaydırmamız scrollTop'u yalnızca artırır, takibi bozmaz.)
    if (dist <= 24) stick.current = true;
    else if (el.scrollTop < lastTop.current - 1) stick.current = false;
    lastTop.current = el.scrollTop;
    setShowJump(dist > 360);
  };

  const hasMessages = Boolean(detail && detail.messages.length);
  useLayoutEffect(() => {
    stick.current = true;
    const el = scroller.current;
    if (el) el.scrollTop = hasMessages ? el.scrollHeight : 0;
  }, [chatId, hasMessages]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [path.length, last?.content.length, last?.reasoning.length]);

  useEffect(() => {
    if (generating) stick.current = true;
  }, [generating?.assistantId]); // eslint-disable-line react-hooks/exhaustive-deps

  const jump = () => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  };

  const showEmpty = !chatId || (detail && detail.messages.length === 0 && !generating);
  const loading = Boolean(chatId && !detail && loadingId === chatId && !loadError);

  return (
    <div className="chat-page">
      <TopBar chatId={chatId} />
      <Banners />
      <div className="thread" ref={scroller} onScroll={onScroll}>
        <div className="thread-inner">
          {loading && (
            <div className="thread-loading">
              {[60, 90, 45].map((w, i) => (
                <div key={i} className="skeleton" style={{ width: `${w}%`, height: 16 }} />
              ))}
            </div>
          )}
          {chatId && loadError && !detail && (
            <div className="thread-error">
              <h2>{loadError === 'notfound' ? t('chat.notFound') : t('chat.loadError')}</h2>
              <p>{loadError === 'notfound' ? t('chat.notFoundHint') : ''}</p>
              <button className="btn btn-primary" onClick={() => nav('/')}>
                {t('sidebar.newChat')}
              </button>
            </div>
          )}
          {showEmpty && !loading && !(chatId && loadError && !detail) && (
            <EmptyState />
          )}
          {path.map((m, i) => (
            <MessageItem
              key={m.id}
              msg={m}
              versions={versionsOf(idx!, m)}
              isLast={i === path.length - 1}
              live={generating?.assistantId === m.id}
              busy={Boolean(generating)}
            />
          ))}
        </div>
        {showJump && (
          <button className="jump-btn" onClick={jump} aria-label="Scroll to bottom">
            <ArrowDown size={16} />
          </button>
        )}
      </div>
      <Composer
        chatId={chatId ?? null}
        seed={null}
        onChatCreated={(id) => nav(`/c/${id}`, { replace: false })}
      />
    </div>
  );
}
