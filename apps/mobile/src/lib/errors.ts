import { router } from 'expo-router';
import { ApiError } from './api.ts';
import { translate } from './i18n/index.ts';
import { useUi } from '../store/ui.ts';

const openRegister = () => router.push({ pathname: '/auth', params: { mode: 'register' } });

/** API hatasını kullanıcıya uygun toast'a çevirir. */
export function reportError(err: unknown, fallbackKey: 'error.generic' | 'chat.loadError' = 'error.generic'): void {
  const ui = useUi.getState();
  if ((err as Error)?.name === 'AbortError') return;
  if (!(err instanceof ApiError)) {
    ui.toast({ kind: 'error', text: translate(fallbackKey) });
    return;
  }
  switch (err.code) {
    case 'network':
      ui.toast({ kind: 'error', text: translate('common.networkError') });
      return;
    case 'tier_restricted':
      ui.toast({ kind: 'info', text: err.message, action: { label: translate('limits.upgrade'), run: openRegister } });
      return;
    case 'quota_exceeded': {
      const tier = (err.details as { tier?: string } | undefined)?.tier;
      ui.toast({
        kind: 'error',
        text: tier === 'guest' ? translate('limits.quotaGuest') : translate('limits.quota'),
        action: tier === 'guest' ? { label: translate('limits.upgrade'), run: openRegister } : undefined,
      });
      return;
    }
    case 'upstream_busy':
      ui.toast({ kind: 'error', text: translate('error.busy') });
      return;
    default:
      ui.toast({ kind: 'error', text: err.message || translate(fallbackKey) });
  }
}
