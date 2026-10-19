import { useEffect, useState } from 'react';
import { CircleAlert } from 'lucide-react';
import type { CodeDiffDTO } from '@sixfinger/shared';
import { api } from '../lib/api.ts';
import { reportError } from '../lib/errors.ts';
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
