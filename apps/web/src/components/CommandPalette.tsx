import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { MessageSquare, PanelLeft, Search, Settings, SquarePen, SunMoon } from 'lucide-react';
import type { ChatDTO } from '@sixfinger/shared';
import { api } from '../lib/api.ts';
import { clsx } from '../lib/format.ts';
import { useT } from '../lib/i18n/index.ts';
import { useChats } from '../store/chats.ts';
import { useUi } from '../store/ui.ts';

interface Item {
  id: string;
  kind: 'action' | 'chat';
  label: string;
  hint?: string;
  icon: React.ReactNode;
  run: () => void;
}

export function CommandPalette() {
  const t = useT();
  const nav = useNavigate();
  const open = useUi((s) => s.paletteOpen);
  const setOpen = useUi((s) => s.setPalette);
  const chats = useChats((s) => s.chats);
  const canSearch = useUi((s) => s.config?.limits.features.search);
  const [q, setQ] = useState('');
  const [remote, setRemote] = useState<ChatDTO[] | null>(null);
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQ('');
      setRemote(null);
      setSel(0);
      setTimeout(() => input.current?.focus(), 0);
    }
  }, [open]);

  // Üyeler için sunucu tarafı (mesaj içeriğinde) arama.
  useEffect(() => {
    if (!open || !canSearch || q.trim().length < 2) {
      setRemote(null);
      return;
    }
    const id = setTimeout(async () => {
      try {
        setRemote((await api.chats({ q: q.trim() })).chats);
      } catch {
        setRemote(null);
      }
    }, 250);
    return () => clearTimeout(id);
  }, [q, open, canSearch]);

  const close = () => setOpen(false);

  const items = useMemo<Item[]>(() => {
    const needle = q.trim().toLocaleLowerCase();
    const ui = useUi.getState();
    const actions = ([
      { id: 'new', kind: 'action', label: t('palette.newChat'), icon: <SquarePen size={16} />, run: () => { useChats.getState().newChat(); nav('/'); } },
      { id: 'settings', kind: 'action', label: t('palette.settings'), icon: <Settings size={16} />, run: () => ui.openSettings() },
      { id: 'theme', kind: 'action', label: t('palette.toggleTheme'), icon: <SunMoon size={16} />, run: () => ui.setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark') },
      { id: 'sidebar', kind: 'action', label: t('palette.toggleSidebar'), icon: <PanelLeft size={16} />, run: () => ui.toggleSidebar() },
    ] as Item[]).filter((a) => !needle || a.label.toLocaleLowerCase().includes(needle));

    const source = remote ?? chats.filter((c) => !needle || c.title.toLocaleLowerCase().includes(needle));
    const chatItems: Item[] = source.slice(0, 30).map((c) => ({
      id: c.id,
      kind: 'chat',
      label: c.title,
      hint: c.snippet,
      icon: <MessageSquare size={16} />,
      run: () => nav(`/c/${c.id}`),
    }));
    return [...actions, ...chatItems];
  }, [q, chats, remote, nav, t]);

  useEffect(() => setSel(0), [q]);
  useEffect(() => {
    document.querySelector<HTMLElement>('.palette-item.sel')?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  if (!open) return null;

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSel((s) => Math.min(items.length - 1, s + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSel((s) => Math.max(0, s - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const it = items[sel];
      if (it) {
        close();
        it.run();
      }
    } else if (e.key === 'Escape') {
      close();
    }
  };

  const firstChat = items.findIndex((i) => i.kind === 'chat');

  return createPortal(
    <div
      className="overlay top"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="palette" role="dialog" aria-modal="true" aria-label={t('palette.placeholder')} onKeyDown={onKey}>
        <div className="palette-input">
          <Search size={18} />
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('palette.placeholder')} aria-label={t('palette.placeholder')} />
          <span className="kbd">Esc</span>
        </div>
        <div className="palette-list">
          {items.length === 0 && <div className="palette-empty">{t('palette.empty')}</div>}
          {items.map((it, i) => (
            <div key={`${it.kind}-${it.id}`}>
              {i === 0 && it.kind === 'action' && <div className="menu-label">{t('palette.actions')}</div>}
              {i === firstChat && <div className="menu-label">{t('palette.chats')}</div>}
              <button
                className={clsx('palette-item', i === sel && 'sel')}
                onMouseMove={() => setSel(i)}
                onClick={() => {
                  close();
                  it.run();
                }}
              >
                {it.icon}
                <span className="palette-label">
                  {it.label}
                  {it.hint && <small>{it.hint}</small>}
                </span>
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
