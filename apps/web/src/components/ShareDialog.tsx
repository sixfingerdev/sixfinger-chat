import { useState } from 'react';
import { Check, Copy, Link2Off } from 'lucide-react';
import { api } from '../lib/api.ts';
import { reportError } from '../lib/errors.ts';
import { copyText } from '../lib/format.ts';
import { useT } from '../lib/i18n/index.ts';
import { useChats } from '../store/chats.ts';
import { useUi } from '../store/ui.ts';
import { Modal } from './Modal.tsx';

export function ShareDialog({ chatId, url, onClose }: { chatId: string; url: string; onClose: () => void }) {
  const t = useT();
  const [copied, setCopied] = useState(false);

  return (
    <Modal title={t('chat.shareLink')} onClose={onClose}>
      <div className="modal-body">
        <p className="hint" style={{ margin: 0 }}>
          {t('chat.shareHint')}
        </p>
        <div className="share-row">
          <input className="input" readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label={t('chat.shareLink')} />
          <button
            className="btn btn-primary"
            onClick={async () => {
              if (await copyText(url)) {
                setCopied(true);
                setTimeout(() => setCopied(false), 1_600);
              }
            }}
          >
            {copied ? <Check size={16} /> : <Copy size={16} />}
            {copied ? t('common.copied') : t('common.copy')}
          </button>
        </div>
        <button
          className="btn btn-danger"
          style={{ justifySelf: 'start' }}
          onClick={async () => {
            try {
              await api.unshare(chatId);
              const d = useChats.getState().detail[chatId];
              if (d) useChats.setState({ detail: { ...useChats.getState().detail, [chatId]: { ...d, chat: { ...d.chat, shareSlug: null } } } });
              useUi.getState().toast({ kind: 'success', text: t('chat.shareStopped') });
              onClose();
            } catch (err) {
              reportError(err);
            }
          }}
        >
          <Link2Off size={16} /> {t('chat.shareStop')}
        </button>
      </div>
    </Modal>
  );
}
