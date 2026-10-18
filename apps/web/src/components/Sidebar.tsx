import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  Code2,
  Ellipsis,
  LogIn,
  MessageSquare,
  Pencil,
  Pin,
  PinOff,
  Search,
  Settings,
  SquarePen,
  Trash2,
  PanelLeftClose,
} from 'lucide-react';
import type { ChatDTO } from '@sixfinger/shared';
import { clsx, groupChats, initials } from '../lib/format.ts';
import { useT } from '../lib/i18n/index.ts';
import { useAuth } from '../store/auth.ts';
import { useChats } from '../store/chats.ts';
import { useCode } from '../store/code.ts';
import { useUi } from '../store/ui.ts';
import { Brand } from './Logo.tsx';
import { CodeCredits } from './CodeCredits.tsx';
import { Popover } from './Popover.tsx';

function ChatRow({ chat, active }: { chat: ChatDTO; active: boolean }) {
  const t = useT();
  const nav = useNavigate();
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(chat.title);
  const input = useRef<HTMLInputElement>(null);
  const features = useUi((s) => s.config?.limits.features);
  const setMobile = useUi((s) => s.setMobileSidebar);

  useEffect(() => {
    if (renaming) input.current?.select();
  }, [renaming]);

  const commit = () => {
    setRenaming(false);
    const v = title.trim();
    if (v && v !== chat.title) void useChats.getState().renameChat(chat.id, v);
    else setTitle(chat.title);
  };

  if (renaming) {
    return (
      <div className="chat-row renaming">
        <input
          ref={input}
          className="rename-input"
          value={title}
          maxLength={120}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') {
              setTitle(chat.title);
              setRenaming(false);
            }
          }}
        />
      </div>
    );
  }

  return (
    <div className={clsx('chat-row', active && 'active')}>
      <NavLink to={`/c/${chat.id}`} className="chat-link" title={chat.title} onClick={() => setMobile(false)}>
        {chat.pinned && <Pin size={12} className="pin-ico" />}
        <span className="chat-title">{chat.title}</span>
      </NavLink>
      <Popover
        align="end"
        className="chat-menu"
        trigger={({ toggle, open }) => (
          <button className={clsx('icon-btn sm row-menu', open && 'is-active')} onClick={toggle} aria-label="Menu" aria-haspopup="menu">
            <Ellipsis size={16} />
          </button>
        )}
      >
        {(close) => (
          <>
            <button
              className="menu-item"
              onClick={() => {
                close();
                setRenaming(true);
              }}
            >
              <Pencil size={16} /> {t('common.rename')}
            </button>
            <button
              className="menu-item"
              onClick={() => {
                close();
                void useChats.getState().pinChat(chat.id, !chat.pinned);
              }}
              disabled={!features?.pin}
            >
              {chat.pinned ? <PinOff size={16} /> : <Pin size={16} />} {chat.pinned ? t('chat.unpin') : t('chat.pin')}
            </button>
            <button
              className="menu-item"
              onClick={() => {
                close();
                void useChats.getState().archiveChat(chat.id, !chat.archived);
              }}
            >
              {chat.archived ? <ArchiveRestore size={16} /> : <Archive size={16} />}{' '}
              {chat.archived ? t('chat.unarchive') : t('chat.archive')}
            </button>
            <div className="menu-sep" />
            <button
              className="menu-item danger"
              onClick={async () => {
                close();
                if (!window.confirm(t('chat.deleteConfirm'))) return;
                if (await useChats.getState().deleteChat(chat.id)) {
                  useUi.getState().toast({ kind: 'success', text: t('chat.deleted') });
                  if (active) nav('/');
                }
              }}
            >
              <Trash2 size={16} /> {t('common.delete')}
            </button>
          </>
        )}
      </Popover>
    </div>
  );
}

/** Code modunda kenar çubuğu gövdesi: yeni oturum + oturum listesi. */
function CodeSidebarBody({ activeId }: { activeId: string | undefined }) {
  const t = useT();
  const nav = useNavigate();
  const sessions = useCode((s) => s.sessions);
  const setMobile = useUi((s) => s.setMobileSidebar);
  useEffect(() => {
    if (!useCode.getState().sessions) void useCode.getState().refresh();
  }, []);
  const go = (to: string) => {
    setMobile(false);
    nav(to);
  };
  return (
    <>
      <div className="sidebar-actions">
        <button className="new-chat" onClick={() => go('/code/new')}>
          <SquarePen size={17} />
          <span>{t('code.newSession')}</span>
        </button>
      </div>
      <nav className="chat-list">
        <section className="chat-group">
          <h3>{t('code.sessions')}</h3>
          {sessions === null && [78, 64, 88].map((w, i) => <div key={i} className="skeleton" style={{ width: `${w}%`, height: 14, margin: '10px 12px' }} />)}
          {sessions?.length === 0 && (
            <div className="sidebar-empty">
              <strong>{t('code.empty')}</strong>
            </div>
          )}
          {sessions?.map((s) => (
            <div key={s.chatId} className={clsx('chat-row', s.chatId === activeId && 'active')}>
              <NavLink to={`/code/s/${s.chatId}`} className="chat-link" title={`${s.title} · ${s.repo}`} onClick={() => setMobile(false)}>
                <i className={clsx('status-dot', s.status)} />
                <span className="chat-title">{s.title === 'Yeni oturum' ? t('code.session.untitled') : s.title}</span>
              </NavLink>
            </div>
          ))}
        </section>
      </nav>
    </>
  );
}

function UserCard({ code }: { code?: boolean }) {
  const t = useT();
  const user = useAuth((s) => s.user);
  const config = useUi((s) => s.config);
  const openSettings = useUi((s) => s.openSettings);
  const openAuth = useUi((s) => s.openAuth);
  if (!user) return null;
  const used = config?.usage.used ?? 0;
  const limit = config?.usage.limit ?? 1;
  const pct = Math.min(100, Math.round((used / limit) * 100));

  return (
    <div className="user-card">
      {user.isGuest && (
        <button className="btn btn-primary btn-block" onClick={() => openAuth('login')}>
          <LogIn size={16} /> {t('auth.signIn')}
        </button>
      )}
      <div className="user-row">
        <button className="user-main" onClick={() => openSettings(user.isGuest ? 'general' : 'account')}>
          <span className="avatar">{initials(user.displayName)}</span>
          <span className="user-meta">
            <span className="user-name">{user.displayName}</span>
            <span className="user-tier">{t(`tier.${user.tier}` as 'tier.guest')}</span>
          </span>
        </button>
        <button className="icon-btn" onClick={() => openSettings('general')} aria-label={t('settings.title')} title={t('settings.title')}>
          <Settings size={18} />
        </button>
      </div>
      {code && <CodeCredits />}
      {!code && config && (
        <div className="usage" title={`${used}/${limit}`}>
          <div className="usage-bar">
            <div className={clsx('usage-fill', pct >= 90 && 'hot')} style={{ width: `${pct}%` }} />
          </div>
          <span className="usage-text">
            {used}/{limit}
          </span>
        </div>
      )}
    </div>
  );
}

export function Sidebar() {
  const t = useT();
  const nav = useNavigate();
  const { chatId } = useParams();
  const { pathname } = useLocation();
  const isCode = pathname === '/code' || pathname.startsWith('/code/');
  const codeAllowed = useUi((s) => s.config?.code?.allowed);
  const chats = useChats((s) => s.chats);
  const archived = useChats((s) => s.archived);
  const loaded = useChats((s) => s.chatsLoaded);
  const [showArchived, setShowArchived] = useState(false);
  const [filter, setFilter] = useState('');
  const toggleSidebar = useUi((s) => s.toggleSidebar);
  const setPalette = useUi((s) => s.setPalette);
  const mobileOpen = useUi((s) => s.mobileSidebarOpen);
  const collapsed = useUi((s) => s.sidebarCollapsed);
  const setMobile = useUi((s) => s.setMobileSidebar);

  useEffect(() => {
    if (showArchived && !archived) void useChats.getState().loadArchived();
  }, [showArchived, archived]);

  const list = useMemo(() => {
    const q = filter.trim().toLocaleLowerCase();
    return q ? chats.filter((c) => c.title.toLocaleLowerCase().includes(q)) : chats;
  }, [chats, filter]);
  const groups = useMemo(() => groupChats(list), [list]);

  const newChat = () => {
    useChats.getState().newChat();
    setMobile(false);
    nav('/');
  };

  return (
    <>
      <div className={clsx('scrim', mobileOpen && 'show')} onClick={() => setMobile(false)} />
      <aside className={clsx('sidebar', mobileOpen && 'open', collapsed && 'collapsed')} aria-label="Sidebar">
        <div className="sidebar-head">
          <NavLink to="/" className="brand-link" onClick={newChat} aria-label="SixFinger">
            <Brand size={20} />
          </NavLink>
          <button className="icon-btn" onClick={toggleSidebar} aria-label={t('sidebar.toggle')} title={t('sidebar.toggle')}>
            <PanelLeftClose size={18} />
          </button>
        </div>

        {codeAllowed && (
          <div className="segmented mode-switch" role="group" aria-label="Chat / Code">
            <button aria-pressed={!isCode} onClick={() => !isCode || nav('/')}>
              <MessageSquare size={15} /> Chat
            </button>
            <button aria-pressed={isCode} onClick={() => isCode || nav('/code')}>
              <Code2 size={15} /> {t('code.nav')}
            </button>
          </div>
        )}

        {isCode ? (
          <CodeSidebarBody activeId={chatId} />
        ) : (
          <>
        <div className="sidebar-actions">
          <button className="new-chat" onClick={newChat}>
            <SquarePen size={17} />
            <span>{t('sidebar.newChat')}</span>
          </button>
          <button className="search-btn" onClick={() => setPalette(true)} aria-label={t('palette.hint')} title={t('palette.hint')}>
            <Search size={17} />
          </button>
        </div>

        <div className="sidebar-filter">
          <Search size={14} />
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t('sidebar.search')} aria-label={t('sidebar.search')} />
        </div>

        <nav className="chat-list">
          {!loaded && (
            <div className="chat-skeletons">
              {[78, 64, 88, 52, 70].map((w, i) => (
                <div key={i} className="skeleton" style={{ width: `${w}%`, height: 14 }} />
              ))}
            </div>
          )}
          {loaded && chats.length === 0 && (
            <div className="sidebar-empty">
              <strong>{t('sidebar.empty')}</strong>
              <span>{t('sidebar.emptyHint')}</span>
            </div>
          )}
          {loaded && chats.length > 0 && list.length === 0 && <div className="sidebar-empty">{t('sidebar.noResults')}</div>}
          {groups.map((g) => (
            <section key={g.key} className="chat-group">
              <h3>{t(`sidebar.group.${g.key}` as 'sidebar.group.today')}</h3>
              {g.chats.map((c) => (
                <ChatRow key={c.id} chat={c} active={c.id === chatId} />
              ))}
            </section>
          ))}

          {loaded && (
            <div className="archive-section">
              <button className="archive-toggle" onClick={() => setShowArchived((s) => !s)}>
                <Archive size={14} />
                <span>{t('sidebar.archived')}</span>
                <ChevronDown size={14} className={clsx('chev', showArchived && 'up')} />
              </button>
              {showArchived &&
                (archived ?? []).map((c) => <ChatRow key={c.id} chat={c} active={c.id === chatId} />)}
            </div>
          )}
        </nav>
          </>
        )}

        <UserCard code={isCode} />
      </aside>
    </>
  );
}
