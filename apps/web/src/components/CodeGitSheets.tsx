import { useEffect, useState } from 'react';
import { ChevronLeft, CircleAlert, Download, File, Folder, Loader } from 'lucide-react';
import { listDir, parentDirs, type CodeDiffDTO } from '@sixfinger/shared';
import { api } from '../lib/api.ts';
import { reportError } from '../lib/errors.ts';
import { downloadBlob } from '../lib/format.ts';
import { useT } from '../lib/i18n/index.ts';
import { DiffView } from './DiffView.tsx';
import { Modal } from './Modal.tsx';

/** Tüm farkı ya da tek dosyanın farkını gösteren geniş pencere. */
export function DiffSheet({ chatId, path, onClose }: { chatId: string; path?: string; onClose: () => void }) {
  const t = useT();
  const [data, setData] = useState<CodeDiffDTO | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let off = false;
    api
      .codeDiff(chatId, path)
      .then((r) => !off && setData(r))
      .catch((err) => {
        if (off) return;
        setFailed(true);
        reportError(err);
      });
    return () => {
      off = true;
    };
  }, [chatId, path]);

  return (
    <Modal title={path ?? t('code.diff.title')} onClose={onClose} wide className="sheet diff-modal">
      <div className="modal-body sheet-body">
        {!data && !failed && <div className="skeleton" style={{ height: 80 }} />}
        {failed && (
          <div className="sheet-empty">
            <CircleAlert size={20} />
            <strong>{t('error.generic')}</strong>
          </div>
        )}
        {data?.stale && <p className="muted">{t('code.diff.stale')}</p>}
        {data && !data.stale && <DiffView diff={data.diff} truncated={data.truncated} />}
      </div>
    </Modal>
  );
}

/** Dosya gezgini: klasör klasör gezinir, dosyayı gösterir, çalışma alanını arşiv olarak indirir. */
export function FilesSheet({ chatId, onClose }: { chatId: string; onClose: () => void }) {
  const t = useT();
  const [paths, setPaths] = useState<string[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [dir, setDir] = useState('');
  const [open, setOpen] = useState<{ path: string; content: string; truncated: boolean } | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let off = false;
    api
      .codeFiles(chatId)
      .then((r) => {
        if (off) return;
        setPaths(r.files);
        setTruncated(r.truncated);
      })
      .catch((err) => {
        if (!off) setPaths([]);
        reportError(err);
      });
    return () => {
      off = true;
    };
  }, [chatId]);

  const show = async (path: string) => {
    setLoading(true);
    try {
      setOpen(await api.codeFile(chatId, path));
    } catch (err) {
      reportError(err);
    } finally {
      setLoading(false);
    }
  };

  const download = async () => {
    setBusy(true);
    try {
      const { blob, filename } = await api.codeArchive(chatId);
      downloadBlob(filename, blob);
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(false);
    }
  };

  const view = paths ? listDir(paths, dir) : { dirs: [], files: [] };
  const crumbs = parentDirs(open ? open.path : `${dir}/x`);
  const name = (p: string) => p.slice(p.lastIndexOf('/') + 1);

  return (
    <Modal title={t('code.files.title')} onClose={onClose} wide className="sheet diff-modal">
      <div className="modal-body sheet-body">
        <div className="files-bar">
          <nav className="files-crumbs" aria-label="path">
            {crumbs.map((c, i) => (
              <button key={c || 'root'} className="crumb" onClick={() => { setOpen(null); setDir(c); }}>
                {i > 0 && <span aria-hidden>/</span>}
                {c ? name(c) : t('code.files.root')}
              </button>
            ))}
            {open && <span className="crumb current">/ {name(open.path)}</span>}
          </nav>
          <button className="btn btn-ghost btn-sm" onClick={() => void download()} disabled={busy}>
            {busy ? <Loader size={14} className="spin" /> : <Download size={14} />} {t('code.files.download')}
          </button>
        </div>
        {!paths && <div className="skeleton" style={{ height: 80 }} />}
        {paths && !open && (
          <ul className="file-list">
            {dir && (
              <li>
                <button className="file-row" onClick={() => setDir(crumbs[crumbs.length - 2] ?? '')}>
                  <ChevronLeft size={15} /> ..
                </button>
              </li>
            )}
            {view.dirs.map((d) => (
              <li key={`d${d}`}>
                <button className="file-row" onClick={() => setDir(dir ? `${dir}/${d}` : d)}>
                  <Folder size={15} /> {d}
                </button>
              </li>
            ))}
            {view.files.map((f) => (
              <li key={f}>
                <button className="file-row" disabled={loading} onClick={() => void show(dir ? `${dir}/${f}` : f)}>
                  <File size={15} /> {f}
                </button>
              </li>
            ))}
            {!view.dirs.length && !view.files.length && <li className="muted">{t('code.files.empty')}</li>}
          </ul>
        )}
        {truncated && !open && <p className="muted">{t('code.files.listTruncated')}</p>}
        {open && (
          <>
            <pre className="file-view">
              {open.content.split('\n').map((l, i) => (
                <span key={i} className="file-line">
                  <span className="diff-no">{i + 1}</span>
                  {l || ' '}
                </span>
              ))}
            </pre>
            {open.truncated && <p className="muted">{t('code.files.truncated')}</p>}
          </>
        )}
      </div>
    </Modal>
  );
}
