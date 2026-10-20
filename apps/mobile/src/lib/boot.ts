import { useAuth } from '../store/auth.ts';
import { hydrateUi } from '../store/ui.ts';
import { initLocale } from './i18n/index.ts';
import { kv, secureSession } from './storage.ts';

let storage: Promise<void> | null = null;
let booted: Promise<void> | null = null;

/** Depoları belleğe yükler (kv, oturum), arayüz tercihlerini ve dili hazırlar. Ana uygulama ile asistan penceresi aynı örneği paylaşır: bir kez çalışır. */
export function initStorage(): Promise<void> {
  storage ??= (async () => {
    await Promise.all([kv.init(), secureSession.init()]);
    hydrateUi();
    initLocale();
  })();
  return storage;
}

/** Depolar + oturum açılışı (kullanıcıyı yükler, gerekirse misafir oturumu açar). Bir kez çalışır. */
export function bootApp(): Promise<void> {
  booted ??= (async () => {
    await initStorage();
    await useAuth.getState().boot();
  })();
  return booted;
}

/** Oturum açılışını yeniden denemek için (ağ hatası sonrası). */
export function retryBoot(): Promise<void> {
  booted = null;
  return bootApp();
}
