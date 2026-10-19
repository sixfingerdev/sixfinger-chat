import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { BookOpen, ChevronRight, Download, Plus, Search } from 'lucide-react';
import type { SkillListItemDTO } from '@sixfinger/shared';
import { api } from '../lib/api.ts';
import { reportError } from '../lib/errors.ts';
import { useT } from '../lib/i18n/index.ts';
import { useUi } from '../store/ui.ts';
import { CodeTopBar } from '../components/CodeTopBar.tsx';
import { ImportSkillDialog, SharedSkillDialog, SkillEditor } from '../components/CodeSkills.tsx';

/** Skill'ler: yerleşik kütüphane + kendi skill'lerin; oluştur, düzenle, GitHub'dan al, bağlantıyla paylaş. */
export function CodeSkillsPage() {
  const t = useT();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [items, setItems] = useState<SkillListItemDTO[] | null>(null);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<{ name: string | null; source: 'builtin' | 'user' } | null>(null);
  const [importing, setImporting] = useState(false);
  const shared = params.get('import');

  const load = () =>
    api
      .codeSkills()
      .then((r) => setItems(r.skills))
      .catch((err) => {
        setItems([]);
        reportError(err);
      });
  useEffect(() => {
    void load();
  }, []);

  const shown = useMemo(() => {
    const k = q.trim().toLowerCase();
    return (items ?? []).filter((s) => !k || `${s.name} ${s.description} ${s.triggers.join(' ')}`.toLowerCase().includes(k));
  }, [items, q]);
  const mine = shown.filter((s) => s.source === 'user');
  const builtin = shown.filter((s) => s.source === 'builtin');

  const row = (s: SkillListItemDTO) => (
    <li key={`${s.source}:${s.name}`}>
      <button className="skill-row" onClick={() => setEditing({ name: s.name, source: s.source })}>
        <span className="skill-icon">
          <BookOpen size={16} />
        </span>
        <span className="skill-main">
          <strong>
            {s.name}
            {s.importedFrom && <em className="skill-tag">{t('code.skills.imported')}</em>}
            {s.shareToken && <em className="skill-tag">{t('code.skills.share')}</em>}
          </strong>
          <span>{s.description}</span>
        </span>
        <ChevronRight size={15} className="code-row-go" />
      </button>
    </li>
  );

  return (
    <div className="code-page">
      <CodeTopBar
        title={t('code.skills.title')}
        right={
          <>
            <button className="btn btn-ghost btn-sm" onClick={() => setImporting(true)}>
              <Download size={15} /> {t('code.skills.import')}
            </button>
            <button className="btn btn-primary btn-sm" onClick={() => setEditing({ name: null, source: 'user' })}>
              <Plus size={15} /> {t('code.skills.new')}
            </button>
          </>
        }
      />
      <div className="code-scroll">
        <div className="code-inner">
          <p className="muted">{t('code.skills.intro')}</p>
          <label className="code-search">
            <Search size={15} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('code.skills.search')} aria-label={t('code.skills.search')} />
          </label>
          {items === null && <div className="skeleton" style={{ height: 120, borderRadius: 16 }} />}
          {items && (
            <>
              <section className="code-section">
                <h3>{t('code.skills.mine')}</h3>
                {mine.length ? <ul className="skill-list">{mine.map(row)}</ul> : <p className="muted">{t('code.skills.empty')}</p>}
              </section>
              <section className="code-section">
                <h3>{t('code.skills.builtin')}</h3>
                <ul className="skill-list">{builtin.map(row)}</ul>
              </section>
            </>
          )}
        </div>
      </div>
      {editing && (
        <SkillEditor
          name={editing.name}
          source={editing.source}
          onClose={() => setEditing(null)}
          onChanged={() => {
            setEditing(null);
            void load();
          }}
        />
      )}
      {importing && (
        <ImportSkillDialog
          onClose={() => setImporting(false)}
          onDone={(n) => {
            setImporting(false);
            useUi.getState().toast({ kind: 'success', text: t('code.skills.importDone', { n }) });
            void load();
          }}
        />
      )}
      {shared && (
        <SharedSkillDialog
          token={shared}
          onClose={() => {
            setParams({}, { replace: true });
            nav('/code/skills', { replace: true });
          }}
          onDone={() => {
            setParams({}, { replace: true });
            void load();
          }}
        />
      )}
    </div>
  );
}
