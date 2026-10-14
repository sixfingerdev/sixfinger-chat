import { CheckCircle2, CircleAlert, Info } from 'lucide-react';
import { useUi } from '../store/ui.ts';

export function Toasts() {
  const { toasts, dismissToast } = useUi();
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} role="status">
          {t.kind === 'error' ? <CircleAlert size={18} /> : t.kind === 'success' ? <CheckCircle2 size={18} /> : <Info size={18} />}
          <span>{t.text}</span>
          {t.action && (
            <button
              className="toast-action"
              onClick={() => {
                t.action!.run();
                dismissToast(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
