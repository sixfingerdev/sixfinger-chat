import { clsx } from '../lib/format.ts';

/** SixFinger işareti: diyagonal bir kesikle dörde bölünmüş altıgen blok. */
export function LogoMark({ size = 24, className, animate }: { size?: number; className?: string; animate?: boolean }) {
  return (
    <svg
      className={clsx('logo-mark', animate && 'is-animated', className)}
      width={size}
      height={(size * 116) / 63}
      viewBox="44 18 63 116"
      fill="currentColor"
      role="img"
      aria-label="SixFinger"
    >
      <polygon className="p-tl" points="48.8,30.4 74,22.7 74,62.6 48.8,92.2" />
      <polygon className="p-tr" points="77,22.7 102.2,30.4 102.5,52.5 58.5,87 59.2,85 77,62.6" />
      <polygon className="p-bl" points="74.0,128.5 48.8,120.8 48.5,98.7 92.5,64.2 91.8,66.2 74.0,88.6" />
      <polygon className="p-br" points="102.2,120.8 77.0,128.5 77.0,88.6 102.2,59.0" />
    </svg>
  );
}

export function Wordmark({ size = 15 }: { size?: number }) {
  return (
    <span className="wordmark" style={{ fontSize: size }}>
      SIXFINGER
    </span>
  );
}

export function Brand({ size = 20 }: { size?: number }) {
  return (
    <span className="brand">
      <LogoMark size={size} />
      <Wordmark />
    </span>
  );
}
