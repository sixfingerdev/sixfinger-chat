import { useEffect } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes, useNavigate } from 'react-router-dom';
import { AuthDialog } from './components/AuthDialog.tsx';
import { CommandPalette } from './components/CommandPalette.tsx';
import { LogoMark } from './components/Logo.tsx';
import { SettingsDialog } from './components/SettingsDialog.tsx';
import { Sidebar } from './components/Sidebar.tsx';
import { Toasts } from './components/Toasts.tsx';
import { useT } from './lib/i18n/index.ts';
import { ChatPage } from './pages/ChatPage.tsx';
import { SharedPage } from './pages/SharedPage.tsx';
import { useAuth } from './store/auth.ts';
import { useChats } from './store/chats.ts';
import { applyTheme, useUi } from './store/ui.ts';
import { clsx } from './lib/format.ts';

function Shell() {
  const t = useT();
  const nav = useNavigate();
  const ready = useAuth((s) => s.ready);
  const bootError = useAuth((s) => s.bootError);
  const user = useAuth((s) => s.user);
  const collapsed = useUi((s) => s.sidebarCollapsed);

  // Kısayollar
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        useUi.getState().setPalette(!useUi.getState().paletteOpen);
      } else if (mod && e.shiftKey && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        useChats.getState().newChat();
        nav('/');
      } else if (mod && e.key === '/') {
        e.preventDefault();
        useUi.getState().toggleSidebar();
      } else if (e.key === 'Escape' && useChats.getState().generating) {
        useChats.getState().stop();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nav]);

  if (!ready) {
    return (
      <div className="splash">
        <LogoMark size={46} animate />
      </div>
    );
  }
  if (bootError || !user) {
    return (
      <div className="splash">
        <LogoMark size={46} />
        <p>{bootError ?? t('error.generic')}</p>
        <button className="btn btn-primary" onClick={() => void useAuth.getState().boot()}>
          {t('common.retry')}
        </button>
      </div>
    );
  }

  return (
    <div className={clsx('app', collapsed && 'sidebar-collapsed')}>
      <Sidebar />
      <main className="main">
        <Outlet />
      </main>
      <CommandPalette />
      <SettingsDialog />
      <AuthDialog />
    </div>
  );
}

export function App() {
  useEffect(() => {
    void useAuth.getState().boot();
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const onScheme = () => useUi.getState().theme === 'system' && applyTheme('system');
    const on = () => useUi.setState({ online: true });
    const off = () => useUi.setState({ online: false });
    mq.addEventListener('change', onScheme);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      mq.removeEventListener('change', onScheme);
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/s/:slug" element={<SharedPage />} />
        <Route element={<Shell />}>
          <Route index element={<ChatPage />} />
          <Route path="c/:chatId" element={<ChatPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Toasts />
    </BrowserRouter>
  );
}
