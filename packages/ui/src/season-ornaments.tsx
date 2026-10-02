import type { SeasonOrnamentId } from '@lucy-spa/contracts';
import type { ReactElement } from 'react';
import { cx } from './cx';

// Seasonal ornaments (docs/UXUI_REDESIGN_DESIGN.md 20.2): one small flat motif per preset, drawn inline in a 64 x 64
// box. Decorative only: `aria-hidden`, no focusable child, no image, no request. Colors come from the classes
// `ls-o1..3` (fill) and `ls-ol1..3` (line), which read `--ls-season-ornament-1..3` in season-decor.css, so a motif never
// carries a color of its own. Yellow exists only in the Tet and Mid-Autumn token values (Q-S1).

const n = (value: number): string => value.toFixed(2).replace(/\.?0+$/, '');

function Flower({
  x,
  y,
  r,
  petal,
  centre,
  petals = 5,
}: {
  x: number;
  y: number;
  r: number;
  petal: string;
  centre: string;
  petals?: number;
}) {
  return (
    <g transform={`translate(${x} ${y})`}>
      {Array.from({ length: petals }, (_, index) => (
        <ellipse
          key={index}
          cx="0"
          cy={n(-r * 0.9)}
          rx={n(r * 0.62)}
          ry={n(r * 0.9)}
          transform={`rotate(${n((index * 360) / petals)})`}
          className={petal}
        />
      ))}
      <circle r={n(r * 0.4)} className={centre} />
    </g>
  );
}

function Heart({ x, y, s, tone }: { x: number; y: number; s: number; tone: string }) {
  const d =
    `M0 ${n(s * 0.35)} C${n(-s)} ${n(-s * 0.3)} ${n(-s * 0.5)} ${n(-s)} 0 ${n(-s * 0.4)} ` +
    `C${n(s * 0.5)} ${n(-s)} ${n(s)} ${n(-s * 0.3)} 0 ${n(s * 0.35)}Z`;
  return <path transform={`translate(${x} ${y})`} d={d} className={tone} />;
}

function Leaf({ x, y, angle, tone }: { x: number; y: number; angle: number; tone: string }) {
  return (
    <ellipse
      cx="0"
      cy="-7"
      rx="2.8"
      ry="8"
      transform={`translate(${x} ${y}) rotate(${angle})`}
      className={tone}
    />
  );
}

const MaiBlossom = () => (
  <>
    <path d="M6 58C18 46 26 38 34 30S48 16 58 8" className="ls-ol3" />
    <path d="M26 38C28 30 24 24 20 20" className="ls-ol3" />
    <Flower x={34} y={30} r={9} petal="ls-o1" centre="ls-o3" />
    <Flower x={52} y={13} r={7} petal="ls-o1" centre="ls-o3" />
    <Flower x={18} y={20} r={6} petal="ls-o1" centre="ls-o3" />
    <circle cx="14" cy="50" r="3.5" className="ls-o2" />
    <circle cx="44" cy="22" r="3" className="ls-o2" />
  </>
);

const PineBranch = () => (
  <>
    <path d="M8 56L56 8" className="ls-ol1" />
    {[0, 1, 2, 3, 4].map((step) => (
      <g key={step}>
        <Leaf x={14 + step * 9} y={50 - step * 9} angle={100} tone={step % 2 ? 'ls-o2' : 'ls-o1'} />
        <Leaf x={14 + step * 9} y={50 - step * 9} angle={-10} tone={step % 2 ? 'ls-o1' : 'ls-o2'} />
      </g>
    ))}
    <circle cx="24" cy="46" r="3.2" className="ls-o3" />
    <circle cx="40" cy="30" r="3.2" className="ls-o3" />
    <circle cx="50" cy="20" r="3.2" className="ls-o3" />
  </>
);

const Hearts = () => (
  <>
    <Heart x={26} y={40} s={15} tone="ls-o1" />
    <Heart x={46} y={24} s={10} tone="ls-o2" />
    <Heart x={16} y={16} s={7} tone="ls-o3" />
  </>
);

const Orchid = () => (
  <>
    <path d="M12 58C20 44 30 36 44 30" className="ls-ol3" />
    <Flower x={43} y={26} r={12} petal="ls-o1" centre="ls-o3" />
    <Flower x={22} y={44} r={8} petal="ls-o2" centre="ls-o3" />
    <circle cx="54" cy="50" r="3.5" className="ls-o1" />
  </>
);

const PinkLotus = () => (
  <>
    <ellipse cx="32" cy="52" rx="24" ry="6" className="ls-o3" />
    {[-50, -25, 25, 50, 0].map((angle) => (
      <ellipse
        key={angle}
        cx="0"
        cy="-14"
        rx="6.5"
        ry="16"
        transform={`translate(32 50) rotate(${angle})`}
        className={angle === 0 || Math.abs(angle) === 50 ? 'ls-o1' : 'ls-o2'}
      />
    ))}
    <circle cx="32" cy="40" r="3" className="ls-o3" />
  </>
);

const Lantern = () => (
  <>
    <path d="M32 4V12" className="ls-ol3" />
    <rect x="22" y="12" width="20" height="5" rx="2" className="ls-o3" />
    <rect x="14" y="17" width="36" height="28" rx="14" className="ls-o1" />
    <ellipse cx="32" cy="31" rx="9" ry="14" className="ls-ol3 ls-thin" />
    <path d="M32 17V45" className="ls-ol3 ls-thin" />
    <rect x="22" y="45" width="20" height="5" rx="2" className="ls-o3" />
    <path d="M32 50V58" className="ls-ol2" />
    <circle cx="32" cy="59" r="2.5" className="ls-o2" />
  </>
);

const starPoints = Array.from({ length: 10 }, (_, index) => {
  const angle = (Math.PI * index) / 5 - Math.PI / 2;
  const radius = index % 2 === 0 ? 22 : 9;
  return `${n(32 + radius * Math.cos(angle))},${n(32 + radius * Math.sin(angle))}`;
}).join(' ');

const LineStar = () => (
  <>
    <polygon points={starPoints} className="ls-ol1" />
    <circle cx="32" cy="32" r="28" className="ls-ol2 ls-thin" />
    <circle cx="32" cy="32" r="3" className="ls-ol3 ls-thin" />
  </>
);

const Lotus = () => (
  <>
    <path d="M32 10C24 22 24 36 32 46C40 36 40 22 32 10Z" className="ls-ol1" />
    <path d="M32 46C18 44 10 32 10 24C20 26 28 34 32 46Z" className="ls-ol1" />
    <path d="M32 46C46 44 54 32 54 24C44 26 36 34 32 46Z" className="ls-ol1" />
    <path d="M12 54Q22 48 32 54T52 54" className="ls-ol2" />
  </>
);

const MOTIFS: Record<SeasonOrnamentId, () => ReactElement> = {
  'mai-blossom': MaiBlossom,
  'pine-branch': PineBranch,
  hearts: Hearts,
  orchid: Orchid,
  'pink-lotus': PinkLotus,
  lantern: Lantern,
  'line-star': LineStar,
  lotus: Lotus,
};

/** A corner motif, or a row of up to three of them (`count`). The box is fixed, so nothing shifts. */
export function SeasonOrnament({
  id,
  count = 1,
  className,
}: {
  id: SeasonOrnamentId;
  count?: 1 | 2 | 3;
  className?: string | undefined;
}) {
  const Motif = MOTIFS[id];
  return (
    <svg
      className={cx('ls-orn', className)}
      viewBox={`0 0 ${64 * count} 64`}
      aria-hidden="true"
      focusable="false"
    >
      {Array.from({ length: count }, (_, index) => (
        <g key={index} transform={`translate(${index * 64} 0)`}>
          <Motif />
        </g>
      ))}
    </svg>
  );
}
