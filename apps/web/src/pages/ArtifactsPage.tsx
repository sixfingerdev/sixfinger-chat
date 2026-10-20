import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Code2, FileText, Globe, Image, Search, Shapes } from 'lucide-react';
import type { ArtifactListItemDTO } from '@sixfinger/shared';
import { api } from '../lib/api.ts';
import { reportError } from '../lib/errors.ts';
import { timeAgo } from '../lib/format.ts';
import { useLocale, useT } from '../lib/i18n/index.ts';
import { useUi } from '../store/ui.ts';
import { CodeTopBar } from '../components/CodeTopBar.tsx';

const ICON = { html: Globe, svg: Image, markdown: FileText, mermaid: Code2 } as const;

/** Artifacts: sohbetlerde üretilmiş tüm artifact'lar (en yeni sürümle). Birine tıklayınca sohbet açılır ve artifact paneli gelir. */
export function ArtifactsPage() {
  const t = useT();
  const locale = useLocale();
  const nav = useNavigate();
  const [items, setItems] = useState<ArtifactListItemDTO[] | null>(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    api.artifacts().then((r) => setItems(r.artifacts)).catch((err) => {
      setItems([]);
      reportError(err);
    });
  }, []);

  const k = q.trim().toLowerCase();
  const shown = (items ?? []).filter((a) => !k || `${a.title} ${a.chatTitle}`.toLowerCase().includes(k));

  const open = (a: ArtifactListItemDTO) => {
    nav(`/c/${a.chatId}`);
    useUi.getState().openArtifact(a.artifactId);
  };

  return (
    <div className="code-page">
      <CodeTopBar title={<><Shapes size={15} /> {t('art.title')}</>} />
      <div className="code-scroll">
        <div className="code-inner">
          <p className="muted">{t('art.subtitle')}</p>
          {items && items.length > 0 && (
            <label className="code-search">
              <Search size={15} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('art.search')} aria-label={t('art.search')} />
            </label>
          )}
          {items === null ? (
            <div className="skeleton" style={{ height: 72, borderRadius: 16 }} />
          ) : items.length === 0 ? (
            <p className="muted">{t('art.empty')}</p>
          ) : shown.length === 0 ? (
            <p className="muted">{t('art.noResults')}</p>
          ) : (
            <ul className="skill-list">
              {shown.map((a) => {
                const Icon = ICON[a.kind];
                return (
                  <li key={`${a.chatId}:${a.artifactId}`}>
                    <button className="skill-row" onClick={() => open(a)}>
                      <span className="skill-icon">
                        <Icon size={16} />
                      </span>
                      <span className="skill-main">
                        <strong>{a.title}</strong>
                        <span>
                          {t(`art.kind.${a.kind}` as 'art.kind.html')} · {timeAgo(a.updatedAt, locale)}
                          {a.versions > 1 ? ` · ${t('art.versions', { n: a.versions })}` : ''} · {t('art.from', { title: a.chatTitle })}
                        </span>
                      </span>
                      <ChevronRight size={15} className="code-row-go" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
