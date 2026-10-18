import type { ReactNode } from 'react';
import { Menu, PanelLeftOpen } from 'lucide-react';
import { useT } from '../lib/i18n/index.ts';
import { useUi } from '../store/ui.ts';

/** Code sayfalarının ortak üst barı: kenar çubuğu düğmeleri + başlık + sağ taraf. */
export function CodeTopBar({ title, subtitle, right }: { title?: ReactNode; subtitle?: ReactNode; right?: ReactNode }) {
  const t = useT();
  const collapsed = useUi((s) => s.sidebarCollapsed);
  const toggleSidebar = useUi((s) => s.toggleSidebar);
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
      </div>
      <div className="topbar-title code-top-title">
        {title && <strong>{title}</strong>}
        {subtitle && <span>{subtitle}</span>}
      </div>
      <div className="topbar-right">{right}</div>
    </header>
  );
}
