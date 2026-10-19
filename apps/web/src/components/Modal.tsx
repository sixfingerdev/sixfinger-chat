import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { clsx } from '../lib/format.ts';
import { useT } from '../lib/i18n/index.ts';

/** Açık pencereler (üstteki en sonda): Esc ve Tab yalnızca en üsttekini etkiler. */
const openModals: symbol[] = [];

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
  hideHead,
  className,
}: {
  title?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  hideHead?: boolean;
  className?: string;
}) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const me = Symbol('modal');
    openModals.push(me);
    const onKey = (e: KeyboardEvent) => {
      if (openModals[openModals.length - 1] !== me) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
      if (e.key === 'Tab' && ref.current) {
        const f = ref.current.querySelectorAll<HTMLElement>(
          'button:not(:disabled), [href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
        );
        if (!f.length) return;
        const first = f[0]!;
        const last = f[f.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey, true);
    // ilk odak: ilk girdi ya da kapsayıcı
    queueMicrotask(() => {
      const first = ref.current?.querySelector<HTMLElement>('input:not(:disabled), textarea:not(:disabled)');
      (first ?? ref.current)?.focus();
    });
    return () => {
      document.removeEventListener('keydown', onKey, true);
      openModals.splice(openModals.indexOf(me), 1);
      prev?.focus?.();
    };
  }, [onClose]);

  return createPortal(
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div ref={ref} className={clsx('modal', wide && 'wide', className)} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
        {!hideHead && (
          <div className="modal-head">
            <h2 className="modal-title">{title}</h2>
            <button className="icon-btn" onClick={onClose} aria-label={t('common.close')}>
              <X size={18} />
            </button>
          </div>
        )}
        {children}
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
