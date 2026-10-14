import { useState, type FormEvent } from 'react';
import { CircleAlert } from 'lucide-react';
import { getApiBase, setApiBase } from '../lib/api.ts';
import { useT } from '../lib/i18n/index.ts';

/** Android uygulamasında sunucu adresini girmek için küçük form. */
export function ServerForm({ onDone, autoFocus }: { onDone: () => void; autoFocus?: boolean }) {
  const t = useT();
  const [url, setUrl] = useState(getApiBase());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const clean = url.trim().replace(/\/+$/, '');
    if (!/^https:\/\/[^\s/]+(\/.*)?$/i.test(clean)) return setError(t('server.invalid'));
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${clean}/api/health`, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(String(res.status));
      setApiBase(clean);
      onDone();
    } catch {
      setError(t('server.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="server-form" onSubmit={submit}>
      <div className="field">
        <label htmlFor="server-url">{t('server.url')}</label>
        <input
          id="server-url"
          className="input"
          type="url"
          inputMode="url"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          autoFocus={autoFocus}
          placeholder="https://chat.example.com"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      </div>
      {error && (
        <div className="form-error" role="alert">
          <CircleAlert size={16} style={{ flex: 'none', marginTop: 2 }} /> {error}
        </div>
      )}
      <button className="btn btn-accent btn-lg btn-block" disabled={busy || !url.trim()}>
        {busy ? <span className="spinner" /> : null} {t('server.connect')}
      </button>
    </form>
  );
}
