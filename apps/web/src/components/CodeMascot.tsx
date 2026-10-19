import { CODE_MASCOT } from '@sixfinger/shared';
import { clsx } from '../lib/format.ts';

/** Üç "z": [x, y, ölçek] (ızgara birimi, gövde dahil koordinat). */
const Z_POS: Array<[number, number, number]> = [
  [18.2, 5.8, 0.5],
  [19.7, 3, 0.75],
  [21.3, 0, 1],
];

/** SixFinger Code'un maskotu: altı parmaklı, uyuyan piksel bir el. Tek renk (currentColor); gözler ve ağız zemin renginde. */
export function CodeMascot({ size = 120, className, sleeping = true }: { size?: number; className?: string; sleeping?: boolean }) {
  const { grid, width, height, z } = CODE_MASCOT;
  const padTop = 4;
  const padRight = 7;
  const W = width + padRight;
  const H = height + padTop;
  const cells: Array<{ x: number; y: number }> = [];
  grid.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] === '#') cells.push({ x, y: y + padTop });
  });
  return (
    <svg
      className={clsx('code-mascot', sleeping && 'is-sleeping', className)}
      width={(size * W) / H}
      height={size}
      viewBox={`0 0 ${W} ${H}`}
      shapeRendering="crispEdges"
      fill="currentColor"
      role="img"
      aria-label="SixFinger Code"
    >
      <g className="mascot-body">
        {cells.map((c) => (
          <rect key={`${c.x}-${c.y}`} x={c.x} y={c.y} width={1.03} height={1.03} />
        ))}
      </g>
      {Z_POS.map(([x, y, s], i) => (
        <g key={i} className={`mascot-z mascot-z${i}`} transform={`translate(${x} ${y}) scale(${s})`}>
          {z.flatMap((row, zy) => [...row].map((ch, zx) => (ch === '#' ? <rect key={`${zx}-${zy}`} x={zx} y={zy} width={1.03} height={1.03} /> : null)))}
        </g>
      ))}
    </svg>
  );
}
