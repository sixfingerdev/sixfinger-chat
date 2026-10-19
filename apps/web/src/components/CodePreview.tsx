import { useEffect, useState } from 'react';
import { ChevronRight, CircleAlert, Download, ExternalLink, FileDown, Loader, Monitor, RefreshCw } from 'lucide-react';
import type { CodePreviewDTO, MessagePartDTO } from '@sixfinger/shared';
import { api, getApiBase } from '../lib/api.ts';
import { reportError } from '../lib/errors.ts';
import { clsx, downloadBlob, formatBytes } from '../lib/format.ts';
import { useT } from '../lib/i18n/index.ts';
import { Modal } from './Modal.tsx';

type ToolPart = Extract<MessagePartDTO, { type: 'tool' }>;
export interface PreviewSpec {
  path?: string;
  port?: number;
  root?: string;
  title?: string;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/**
 * Önizleme penceresi: kısa ömürlü token'lı adres iframe'de açılır. Çerçeve `sandbox` ile (allow-same-origin YOK) yalıtılır:
 * sayfa SixFinger'ın kaynağına, oturum belirtecine ve API'ye erişemez; sunucu da aynı kısıtı CSP ile ayrıca uygular.
 */
export function PreviewSheet({ chatId, spec, onClose }: { chatId: string; spec: PreviewSpec; onClose: () => void }) {
  const t = useT();
  const [link, setLink] = useState<CodePreviewDTO | null>(null);
  const [error, setError] = useState('');
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let off = false;
    api
      .codePreview(chatId, { path: spec.path, port: spec.port, root: spec.root })
      .then((r) => !off && setLink(r))
      .catch((err) => {
        if (off) return;
        setError(err instanceof Error ? err.message : String(err));
        reportError(err);
      });
    return () => {
      off = true;
    };
  }, [chatId, spec.path, spec.port, spec.root]);

  const src = link ? `${getApiBase()}${link.url}` : '';
  const label = spec.title || (spec.port ? t('code.preview.server', { port: spec.port }) : spec.path) || t('code.preview.title');

  return (
    <Modal title={label} onClose={onClose} wide className="sheet preview-modal">
      <div className="modal-body sheet-body">
        <div className="preview-bar">
          <span className="preview-hint">{spec.port ? t('code.preview.hintPort') : t('code.preview.hintFile')}</span>
          <button className="icon-btn sm" disabled={!link} onClick={() => setNonce((n) => n + 1)} aria-label={t('code.preview.reload')} title={t('code.preview.reload')}>
            <RefreshCw size={15} />
          </button>
          {link && (
            <a className="icon-btn sm" href={src} target="_blank" rel="noopener noreferrer" aria-label={t('code.preview.external')} title={t('code.preview.external')}>
              <ExternalLink size={15} />
            </a>
          )}
        </div>
        {!link && !error && (
          <div className="preview-state">
            <Loader size={16} className="spin" /> {t('code.preview.loading')}
          </div>
        )}
        {error && (
          <div className="preview-state error">
            <CircleAlert size={16} /> <span>{t('code.preview.failed')}: {error}</span>
          </div>
        )}
        {link && (
          <iframe
            key={nonce}
            className="preview-frame"
            src={src}
            title={label}
            sandbox="allow-scripts allow-forms allow-popups allow-modals allow-downloads allow-pointer-lock"
            referrerPolicy="no-referrer"
            allow="fullscreen"
          />
        )}
      </div>
    </Modal>
  );
}

/** Mesajdaki "önizleme" satırı: dokununca penceresi açılır (bağlantı her açılışta yeniden alınır). */
export function PreviewRow({ part, chatId }: { part: ToolPart; chatId: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const spec: PreviewSpec = {
    path: str(part.meta?.path) || undefined,
    port: typeof part.meta?.port === 'number' ? part.meta.port : undefined,
    root: typeof part.meta?.root === 'string' ? part.meta.root : undefined,
    title: str(part.meta?.title) || undefined,
  };
  const failed = part.status === 'error';
  return (
    <>
      <button className={clsx('code-row preview', failed && 'failed')} disabled={failed || part.status === 'running'} onClick={() => setOpen(true)}>
        <span className="code-row-icon">{part.status === 'running' ? <Loader size={15} className="spin" /> : failed ? <CircleAlert size={15} /> : <Monitor size={15} />}</span>
        <span className="code-row-label">
          <strong>{t('code.preview.title')}</strong> <span className="muted">{failed ? part.summary : spec.title || spec.path || t('code.preview.server', { port: spec.port ?? 0 })}</span>
        </span>
        {!failed && <span className="code-row-act">{t('code.preview.open')}</span>}
        {!failed && <ChevronRight size={14} className="code-row-go" />}
      </button>
      {open && <PreviewSheet chatId={chatId} spec={spec} onClose={() => setOpen(false)} />}
    </>
  );
}

/** Ajanın `share_file` ile verdiği dosya: ad, boyut ve İndir düğmesi. */
export function ShareFileRow({ part, chatId }: { part: ToolPart; chatId: string }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const path = str(part.meta?.path);
  const name = str(part.meta?.name) || path.split('/').pop() || '';
  const size = typeof part.meta?.size === 'number' ? part.meta.size : 0;
  const failed = part.status === 'error';
  const download = async () => {
    setBusy(true);
    try {
      const { blob, filename } = await api.codeDownload(chatId, path);
      downloadBlob(filename, blob);
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <button className={clsx('code-row share', failed && 'failed')} disabled={failed || busy || part.status === 'running'} onClick={() => void download()}>
      <span className="code-row-icon">{failed ? <CircleAlert size={15} /> : <FileDown size={15} />}</span>
      <span className="code-row-label">
        {failed ? (
          <span className="muted">{part.summary}</span>
        ) : (
          <>
            <strong>{name}</strong> <span className="muted">{size ? formatBytes(size) : ''}{str(part.meta?.description) ? ` · ${str(part.meta?.description)}` : ''}</span>
          </>
        )}
      </span>
      {!failed && (
        <span className="code-row-act">
          {busy ? <Loader size={13} className="spin" /> : <Download size={13} />} {t('code.share.download')}
        </span>
      )}
    </button>
  );
}
