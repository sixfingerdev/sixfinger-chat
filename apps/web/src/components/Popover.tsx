import { useEffect, useRef, useState, type ReactNode } from 'react';
import { clsx } from '../lib/format.ts';

/** Küçük bir açılır menü: dışarı tıklama ve Esc ile kapanır. */
export function Popover({
  trigger,
  children,
  align = 'start',
  direction = 'down',
  className,
  menuClassName,
}: {
  trigger: (p: { open: boolean; toggle: () => void }) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: 'start' | 'end';
  direction?: 'up' | 'down';
  className?: string;
  menuClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className={clsx('popover', className)} style={{ position: 'relative', display: 'inline-block' }}>
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open && (
        <div
          className={clsx('menu', menuClassName)}
          style={{
            [direction === 'up' ? 'bottom' : 'top']: 'calc(100% + 6px)',
            [align === 'end' ? 'right' : 'left']: 0,
          }}
          role="menu"
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
