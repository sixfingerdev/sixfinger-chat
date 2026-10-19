import { useEffect } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes, useNavigate } from 'react-router-dom';
import { AuthDialog } from './components/AuthDialog.tsx';
import { CommandPalette } from './components/CommandPalette.tsx';
import { LogoMark } from './components/Logo.tsx';
import { SettingsDialog } from './components/SettingsDialog.tsx';
import { ArtifactPanel } from './components/ArtifactPanel.tsx';
import { Sidebar } from './components/Sidebar.tsx';
import { Toasts } from './components/Toasts.tsx';
import { useT } from './lib/i18n/index.ts';
import { getApiBase } from './lib/api.ts';
import { exitApp, hideSplash, isNative, onBackButton, setStatusBar } from './lib/native.ts';
import { ServerForm } from './components/ServerForm.tsx';
import { ChatPage } from './pages/ChatPage.tsx';
import { CodeNewPage } from './pages/CodeNewPage.tsx';
import { CodePage } from './pages/CodePage.tsx';
import { CodeSessionPage } from './pages/CodeSessionPage.tsx';
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
      } else if (e.key === 'Escape' && activeGenerating()) {
        useChats.getState().stop(useChats.getState().activeId!);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nav]);

  // Android geri tuşu
  useEffect(() => {
    if (!isNative) return;
    let off = () => {};
    void onBackButton(({ canGoBack }) => {
      const ui = useUi.getState();
      if (ui.paletteOpen) ui.setPalette(false);
      else if (ui.authMode) ui.closeAuth();
      else if (ui.settingsTab) ui.closeSettings();
      else if (ui.mobileSidebarOpen) ui.setMobileSidebar(false);
      else if (activeGenerating()) useChats.getState().stop(useChats.getState().activeId!);
      else if (window.location.pathname !== '/' && canGoBack) nav(-1);
      else if (window.location.pathname !== '/') nav('/');
      else void exitApp();
    }).then((fn) => (off = fn));
    return () => off();
  }, [nav]);

  useEffect(() => {
    if (ready) void hideSplash();
  }, [ready]);

  if (isNative && !getApiBase()) {
    return (
      <div className="splash connect">
        <LogoMark size={46} />
        <h2>{t('server.title')}</h2>
        <p>{t('server.sub')}</p>
        <ServerForm autoFocus onDone={() => window.location.reload()} />
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="splash">
        <LogoMark size={46} animate />
      </div>
    );
  }
  if (bootError || !user) {
    return (
      <div className="splash connect">
        <LogoMark size={46} />
        <p>{bootError ?? t('error.generic')}</p>
        <button className="btn btn-primary" onClick={() => void useAuth.getState().boot()}>
          {t('common.retry')}
        </button>
        {isNative && <ServerForm onDone={() => window.location.reload()} />}
      </div>
    );
  }

  return (
    <div className={clsx('app', collapsed && 'sidebar-collapsed')}>
      <Sidebar />
      <main className="main">
        <Outlet />
      </main>
      <ArtifactPanel />
      <CommandPalette />
      <SettingsDialog />
      <AuthDialog />
    </div>
  );
}

/** Açık sohbette süren bir üretim var mı? */
const activeGenerating = () => {
  const s = useChats.getState();
  return Boolean(s.activeId && s.generating[s.activeId]);
};

export function App() {
  // Sekme uzun süre arka plandaysa ya da ağ geri geldiyse süren üretimi yeniden bağla (üretim sunucuda sürer).
  useEffect(() => {
    let hiddenAt = 0;
    const onVisible = () => {
      if (document.visibilityState === 'hidden') hiddenAt = Date.now();
      else if (hiddenAt && Date.now() - hiddenAt > 15_000) useChats.getState().refreshActive();
    };
    const onOnline = () => useChats.getState().refreshActive();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
    };
  }, []);

  useEffect(() => {
    if (!isNative || getApiBase()) void useAuth.getState().boot();
    void setStatusBar(document.documentElement.dataset.theme !== 'light');
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
          <Route path="code" element={<CodePage />} />
          <Route path="code/new" element={<CodeNewPage />} />
          <Route path="code/s/:chatId" element={<CodeSessionPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Toasts />
    </BrowserRouter>
  );
}
