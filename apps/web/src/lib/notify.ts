/** Sekme arka plandayken bildirim gösterir (Notification API; izin yoksa sessizce atlanır). */
export function notifySupported(): boolean {
  return typeof Notification !== 'undefined';
}

/** Kullanıcı jestinden çağrılmalı (ör. mesaj gönderirken); izin daha önce sorulmadıysa sorar. */
export function ensureNotifyPermission(): void {
  try {
    if (notifySupported() && Notification.permission === 'default') void Notification.requestPermission();
  } catch {
    /* yoksay */
  }
}

export function notifyIfHidden(title: string, body: string, tag: string): void {
  try {
    if (!notifySupported() || Notification.permission !== 'granted' || !document.hidden) return;
    const n = new Notification(title, { body, tag, icon: '/icons/icon-192.png' });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    /* yoksay */
  }
}
