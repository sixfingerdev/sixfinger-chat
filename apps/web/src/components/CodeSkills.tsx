import { useEffect, useState } from 'react';
import { Copy, Link2, Plus, Trash2 } from 'lucide-react';
import { serializeSkillMd, type SkillDetailDTO } from '@sixfinger/shared';
import { ApiError, api } from '../lib/api.ts';
import { reportError } from '../lib/errors.ts';
import { useT } from '../lib/i18n/index.ts';
import { useUi } from '../store/ui.ts';
import { Modal } from './Modal.tsx';

const TEMPLATE = (hint: string) =>
  serializeSkillMd({
    name: 'yeni-skill',
    description: `Ne yaptığı ve ne zaman kullanılacağı. ${hint}`,
    triggers: ['anahtar', 'keyword'],
    body: '# Başlık\n\n1. Birinci adım.\n2. İkinci adım.\n3. Doğrula: testleri çalıştır.\n\nYapma:\n- …',
  });

type FileRow = { path: string; content: string };
const toRows = (f: Record<string, string>): FileRow[] => Object.entries(f).map(([path, content]) => ({ path, content }));
const fromRows = (r: FileRow[]): Record<string, string> => Object.fromEntries(r.filter((x) => x.path.trim()).map((x) => [x.path.trim(), x.content]));

/** Skill görüntüle / düzenle. `name` boşsa yeni skill; yerleşikler salt okunur ("kopyala ve düzenle"). */
export function SkillEditor({ name, source, onClose, onChanged }: { name: string | null; source: 'builtin' | 'user'; onClose: () => void; onChanged: () => void }) {
  const t = useT();
  const [detail, setDetail] = useState<SkillDetailDTO | null>(null);
  const [markdown, setMarkdown] = useState(name ? '' : TEMPLATE(t('code.skills.template')));
  const [files, setFiles] = useState<FileRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const readonly = source === 'builtin';

  useEffect(() => {
    if (!name) return;
    let off = false;
    api
      .codeSkill(name, source === 'builtin' ? 'builtin' : undefined)
      .then((d) => {
        if (off) return;
        setDetail(d);
        setMarkdown(d.markdown);
        setFiles(toRows(d.files));
      })
      .catch((err) => {
        reportError(err);
        onClose();
      });
    return () => {
      off = true;
    };
  }, [name, source]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (asName: string | null) => {
    setBusy(true);
    setError('');
    try {
      await api.codeSaveSkill(asName, { markdown, files: fromRows(files) });
      useUi.getState().toast({ kind: 'success', text: t('code.skills.saved') });
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!name || !window.confirm(t('code.skills.deleteConfirm'))) return;
    setBusy(true);
    try {
      await api.codeDeleteSkill(name);
      onChanged();
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(false);
    }
  };

  const toggleShare = async () => {
    if (!name || !detail) return;
    try {
      const r = await api.codeShareSkill(name, !detail.shareToken);
      setDetail({ ...detail, shareToken: r.shareToken });
    } catch (err) {
      reportError(err);
    }
  };
  const link = detail?.shareToken ? `${window.location.origin}/code/skills?import=${detail.shareToken}` : '';
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      useUi.getState().toast({ kind: 'success', text: t('code.skills.linkCopied') });
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* panoya erişilemedi: bağlantı yine de görünür */
    }
  };

  return (
    <Modal
      title={name ? (readonly ? `${t('code.skills.view')}: ${name}` : t('code.skills.edit')) : t('code.skills.new')}
      onClose={onClose}
      wide
      footer={
        <>
          {name && !readonly && (
            <button className="btn btn-ghost btn-danger-text" onClick={() => void remove()} disabled={busy}>
              <Trash2 size={14} /> {t('common.delete')}
            </button>
          )}
          <span className="spacer" />
          <button className="btn btn-ghost" onClick={onClose}>
            {readonly ? t('common.close') : t('common.cancel')}
          </button>
          {!readonly && (
            <button className="btn btn-primary" onClick={() => void save(name)} disabled={busy || (Boolean(name) && !detail)}>
              {t('common.save')}
            </button>
          )}
        </>
      }
    >
      <div className="modal-body env-form">
        {readonly && <p className="hint">{t('code.skills.copyHint')}</p>}
        <div className="field">
          <label htmlFor="skill-md">{t('code.skills.markdown')}</label>
          <textarea id="skill-md" className="textarea mono" rows={16} value={markdown} onChange={(e) => setMarkdown(e.target.value)} readOnly={readonly} spellCheck={false} />
          {!readonly && <span className="hint">{t('code.skills.markdownHint')}</span>}
        </div>

        <div className="field">
          <span className="label">{t('code.skills.files')}</span>
          {!readonly && <span className="hint">{t('code.skills.filesHint')}</span>}
          {files.map((f, i) => (
            <div key={i} className="skill-file">
              <div className="skill-file-head">
                <input className="input mono" value={f.path} readOnly={readonly} placeholder={t('code.skills.filePath')} onChange={(e) => setFiles((cur) => cur.map((x, j) => (j === i ? { ...x, path: e.target.value } : x)))} />
                {!readonly && (
                  <button className="icon-btn sm" aria-label={t('common.delete')} onClick={() => setFiles((cur) => cur.filter((_, j) => j !== i))}>
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
              <textarea className="textarea mono" rows={5} value={f.content} readOnly={readonly} onChange={(e) => setFiles((cur) => cur.map((x, j) => (j === i ? { ...x, content: e.target.value } : x)))} spellCheck={false} />
            </div>
          ))}
          {!readonly && (
            <button className="btn btn-ghost btn-sm" onClick={() => setFiles((cur) => [...cur, { path: '', content: '' }])}>
              <Plus size={14} /> {t('code.skills.addFile')}
            </button>
          )}
        </div>

        {name && !readonly && detail && (
          <div className="field">
            <div className="switch-row">
              <span className="switch-text">
                <strong>{t('code.skills.share')}</strong>
                {detail.shareToken && <span className="hint">{t('code.skills.shareOn')}</span>}
              </span>
              <button className="switch" role="switch" aria-checked={Boolean(detail.shareToken)} aria-label={t('code.skills.share')} onClick={() => void toggleShare()} />
            </div>
            {link && (
              <div className="skill-link">
                <Link2 size={14} />
                <code>{link}</code>
                <button className="btn btn-ghost btn-sm" onClick={() => void copyLink()}>
                  <Copy size={13} /> {copied ? '✓' : t('code.skills.copyLink')}
                </button>
              </div>
            )}
          </div>
        )}
        {error && <p className="form-error">{error}</p>}
      </div>
    </Modal>
  );
}

/** GitHub adresinden içe aktar (çakışmada onayla ve üzerine yaz). */
export function ImportSkillDialog({ onClose, onDone }: { onClose: () => void; onDone: (n: number) => void }) {
  const t = useT();
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const run = async (overwrite: boolean) => {
    setBusy(true);
    setError('');
    try {
      const r = await api.codeImportSkill(url.trim(), overwrite);
      onDone(r.imported.length);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && !overwrite && window.confirm(t('code.skills.importConflict'))) return void run(true);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={t('code.skills.importTitle')}
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button className="btn btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn btn-primary" onClick={() => void run(false)} disabled={busy || url.trim().length < 3}>
            {t('code.skills.import')}
          </button>
        </>
      }
    >
      <div className="modal-body env-form">
        <div className="field">
          <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/sahip/depo/tree/main/skills/ad" autoFocus spellCheck={false} onKeyDown={(e) => e.key === 'Enter' && url.trim().length >= 3 && void run(false)} />
          <span className="hint">{t('code.skills.importHint')}</span>
        </div>
        {error && <p className="form-error">{error}</p>}
      </div>
    </Modal>
  );
}

/** Paylaşım bağlantısıyla gelen skill: önizle ve hesabına al. */
export function SharedSkillDialog({ token, onClose, onDone }: { token: string; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const [d, setD] = useState<SkillDetailDTO | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.codeSharedSkill(token).then(setD).catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [token]);

  const take = async (overwrite = false): Promise<void> => {
    setBusy(true);
    try {
      await api.codeImportShared(token, overwrite);
      useUi.getState().toast({ kind: 'success', text: t('code.skills.saved') });
      onDone();
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && !overwrite && window.confirm(t('code.skills.importConflict'))) return take(true);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={t('code.skills.sharedTitle')}
      onClose={onClose}
      wide
      footer={
        <>
          <span className="spacer" />
          <button className="btn btn-ghost" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn btn-primary" onClick={() => void take()} disabled={busy || !d}>
            {t('code.skills.sharedImport')}
          </button>
        </>
      }
    >
      <div className="modal-body env-form">
        {error && <p className="form-error">{error}</p>}
        {d && (
          <>
            <p>
              <strong>{d.name}</strong> · {d.description}
            </p>
            <textarea className="textarea mono" rows={14} readOnly value={d.markdown} />
            {Object.keys(d.files).length > 0 && <p className="hint">{Object.keys(d.files).join(', ')}</p>}
          </>
        )}
      </div>
    </Modal>
  );
}
