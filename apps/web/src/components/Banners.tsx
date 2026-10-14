import { MailWarning, UserRound, X } from 'lucide-react';
import { useState } from 'react';
import { useT } from '../lib/i18n/index.ts';
import { useAuth } from '../store/auth.ts';
import { useUi } from '../store/ui.ts';

/** Misafir / doğrulanmamış hesap için ince bilgilendirme şeridi. */
export function Banners() {
  const t = useT();
  const user = useAuth((s) => s.user);
  const openAuth = useUi((s) => s.openAuth);
  const [dismissed, setDismissed] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem('sf.banner');
    } catch {
      return null;
    }
  });
  if (!user || (!user.isGuest && user.emailVerified)) return null;
  const kind = user.isGuest ? 'guest' : 'verify';
  if (dismissed === kind) return null;

  return (
    <div className="banner" role="note">
      {kind === 'guest' ? <UserRound size={16} /> : <MailWarning size={16} />}
      <span>{kind === 'guest' ? t('banner.guest') : t('banner.verify')}</span>
      <button className="banner-action" onClick={() => openAuth(kind === 'guest' ? 'register' : 'verify')}>
        {kind === 'guest' ? t('banner.guestAction') : t('banner.verifyAction')}
      </button>
      <button
        className="icon-btn sm"
        aria-label={t('common.close')}
        onClick={() => {
          setDismissed(kind);
          try {
            sessionStorage.setItem('sf.banner', kind);
          } catch {
            /* yoksay */
          }
        }}
      >
        <X size={14} />
      </button>
    </div>
  );
}
