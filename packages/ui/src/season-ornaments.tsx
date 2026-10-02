import type { SeasonOrnamentId } from '@lucy-spa/contracts';
import type { ReactElement } from 'react';
import { cx } from './cx';

// Seasonal ornaments (docs/UXUI_REDESIGN_DESIGN.md 20.2): one small flat motif per preset, drawn inline in a 64 x 64
// box. Decorative only: `aria-hidden`, no focusable child, no image, no request. Colors come from the classes
// `ls-o1..3` (fill) and `ls-ol1..3` (line), which read `--ls-season-ornament-1..3` in season-decor.css, so a motif never
// carries a color of its own. Yellow exists only in the Tet, Mid-Autumn, 30/4-1/5 and 2/9 token values (Q-S1).

const n = (value: number): string => value.toFixed(2).replace(/\.?0+$/, '');

/** Points of a five-point star centred on (cx, cy): outer radius `outer`, inner radius `inner`, one point up. */
export function starPoints(cx: number, cy: number, outer: number, inner: number): string {
  return Array.from({ length: 10 }, (_, index) => {
    const angle = (Math.PI * index) / 5 - Math.PI / 2;
    const radius = index % 2 === 0 ? outer : inner;
    return `${n(cx + radius * Math.cos(angle))},${n(cy + radius * Math.sin(angle))}`;
  }).join(' ');
}

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

/** A static firework burst: rays around a centre, a bead at the end of every other ray. */
function Burst({ x, y, reach = 10 }: { x: number; y: number; reach?: number }) {
  const rays = 8;
  return (
    <g transform={`translate(${x} ${y})`}>
      {Array.from({ length: rays }, (_, index) => {
        const angle = (Math.PI * 2 * index) / rays;
        const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
        return (
          <g key={index}>
            <path
              d={`M${n(cos * reach * 0.4)} ${n(sin * reach * 0.4)}L${n(cos * reach)} ${n(sin * reach)}`}
              className="ls-ol2 ls-mid"
            />
            {index % 2 === 0 ? (
              <circle
                cx={n(cos * (reach + 2.6))}
                cy={n(sin * (reach + 2.6))}
                r="1.6"
                className="ls-o3"
              />
            ) : null}
          </g>
        );
      })}
      <circle r="2" className="ls-o1" />
    </g>
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

// A pine tree with a star and baubles, and a bell beside it.
const ChristmasOrnaments = () => (
  <>
    <polygon points="30,10 20,24 40,24" className="ls-o1" />
    <polygon points="30,18 15,38 45,38" className="ls-o1" />
    <polygon points="30,30 11,52 49,52" className="ls-o1" />
    <rect x="26" y="52" width="8" height="7" rx="1" className="ls-o2" />
    <polygon points={starPoints(30, 7, 6.5, 2.7)} className="ls-o2" />
    <circle cx="26" cy="36" r="3.2" className="ls-o3" />
    <circle cx="35" cy="28" r="2.8" className="ls-o3" />
    <circle cx="22" cy="47" r="3.2" className="ls-o3" />
    <circle cx="38" cy="45" r="3.2" className="ls-o2" />
    <path d="M50 47C50 39 52 34 56 34C60 34 62 39 62 47Z" className="ls-o2" />
    <rect x="48" y="47" width="16" height="3.4" rx="1.7" className="ls-o2" />
    <circle cx="56" cy="54" r="2.6" className="ls-o3" />
    <circle cx="56" cy="31.5" r="2" className="ls-o3" />
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

// A five-point star lantern (đèn ông sao) with a tassel, and a crescent moon.
const StarLanternMoon = () => (
  <>
    <polygon points={starPoints(22, 34, 20, 8.6)} className="ls-o1" />
    <polygon points={starPoints(22, 34, 10, 4.4)} className="ls-o2" />
    <path d="M22 46V57" className="ls-ol2" />
    <circle cx="22" cy="59" r="2.4" className="ls-o2" />
    <path d="M60 2A13 13 0 1 0 60 28A30 30 0 0 1 60 2Z" className="ls-o3" />
  </>
);

// 30/4 - 1/5: a solid five-point star and static firework bursts.
const StarFireworks = () => (
  <>
    <Burst x={13} y={13} reach={8} />
    <Burst x={53} y={11} reach={7} />
    <Burst x={52} y={52} reach={8} />
    <polygon points={starPoints(30, 36, 22, 9)} className="ls-o1" />
  </>
);

// 2/9: a solid five-point star over a lotus outline, with firework bursts.
const StarLotus = () => (
  <>
    <Burst x={12} y={12} reach={8} />
    <Burst x={54} y={12} reach={8} />
    <polygon points={starPoints(32, 26, 18, 7.4)} className="ls-o1" />
    <path d="M32 58C25 54 25 48 32 43C39 48 39 54 32 58Z" className="ls-ol2 ls-mid" />
    <path d="M32 58C22 58 16 52 15 46C23 46 29 51 32 58Z" className="ls-ol2 ls-mid" />
    <path d="M32 58C42 58 48 52 49 46C41 46 35 51 32 58Z" className="ls-ol2 ls-mid" />
  </>
);

/** Two balloons with strings, a bow and a few confetti pieces (Celebration). */
const BalloonsConfetti = () => (
  <>
    <ellipse cx="22" cy="22" rx="12" ry="15" className="ls-o1" />
    <ellipse cx="42" cy="26" rx="11" ry="14" className="ls-o2" />
    <path d="M22 37C26 46 30 50 32 54M42 40C38 48 34 50 32 54" className="ls-ol3 ls-thin" />
    <path d="M32 54C26 48 24 56 30 58ZM32 54C38 48 40 56 34 58Z" className="ls-o3" />
    <rect
      x="8"
      y="46"
      width="6"
      height="3"
      rx="1"
      className="ls-o3"
      transform="rotate(30 11 47.5)"
    />
    <circle cx="54" cy="10" r="2.4" className="ls-o3" />
    <rect
      x="50"
      y="46"
      width="6"
      height="3"
      rx="1"
      className="ls-o1"
      transform="rotate(-25 53 47.5)"
    />
    <circle cx="10" cy="8" r="2.2" className="ls-o2" />
  </>
);

const MOTIFS: Record<SeasonOrnamentId, () => ReactElement> = {
  'balloons-confetti': BalloonsConfetti,
  'mai-blossom': MaiBlossom,
  'christmas-ornaments': ChristmasOrnaments,
  hearts: Hearts,
  orchid: Orchid,
  'pink-lotus': PinkLotus,
  'star-lantern-moon': StarLanternMoon,
  'star-fireworks': StarFireworks,
  'star-lotus': StarLotus,
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
