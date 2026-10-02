import { ArtSvg, art, n } from './season-art-kit';

// Christmas kit (docs/UXUI_REDESIGN_S6_PLAN.md section 4): string lights, pine garlands with a bow, a santa hat, a
// decorated tree, gifts, snowy hills and snow. Colors are `--ls-art-*` tokens of the `christmas` preset; no yellow
// anywhere (the Q-S1 exception belongs to four other kits). Decoration only: aria-hidden, nothing focusable.

function Bauble({ x, y, r, color }: { x: number; y: number; r: number; color: string }) {
  return (
    <g>
      <path d={`M${n(x)} ${n(y - r)}V${n(y - r - 3)}`} stroke={art('wire')} strokeWidth="1" />
      <rect x={n(x - 2.2)} y={n(y - r - 4.4)} width="4.4" height="2.8" rx="1" fill={art('snow2')} />
      <circle cx={n(x)} cy={n(y)} r={n(r)} fill={art(color)} />
      <ellipse
        cx={n(x - r * 0.35)}
        cy={n(y - r * 0.35)}
        rx={n(r * 0.28)}
        ry={n(r * 0.18)}
        transform={`rotate(-35 ${n(x - r * 0.35)} ${n(y - r * 0.35)})`}
        fill={art('white')}
        opacity=".7"
      />
    </g>
  );
}

// ------------------------------------------------------------------------------- string lights

const BULB_COLORS = ['bulb1', 'bulb2', 'bulb3', 'bulb4'] as const;

/** Point of a quadratic swag at t (x in percent of the width, y in pixels of the row). */
function swagPoint(x1: number, x2: number, y: number, control: number, t: number) {
  const mid = (x1 + x2) / 2;
  return {
    x: (1 - t) ** 2 * x1 + 2 * (1 - t) * t * mid + t * t * x2,
    y: (1 - t) ** 2 * y + 2 * (1 - t) * t * control + t * t * y,
  };
}

const LIGHT_SHAPE = {
  wide: { anchors: [0, 100 / 3, 200 / 3, 100], sag: 28, perSwag: 8 },
  narrow: { anchors: [0, 50, 100], sag: 18, perSwag: 4 },
} as const;
const LIGHT_TOP = 3;

/** Where each bulb of a variant hangs (percent across, pixels down), with its color token. */
export function lightPositions(
  variant: 'wide' | 'narrow',
): Array<{ x: number; y: number; color: string }> {
  const { anchors, sag, perSwag } = LIGHT_SHAPE[variant];
  const bulbs: Array<{ x: number; y: number; color: string }> = [];
  anchors.slice(0, -1).forEach((x1, index) => {
    for (let step = 1; step < perSwag; step++) {
      const point = swagPoint(
        x1,
        anchors[index + 1]!,
        LIGHT_TOP,
        LIGHT_TOP + sag * 2,
        step / perSwag,
      );
      bulbs.push({ ...point, color: BULB_COLORS[bulbs.length % 4]! });
    }
  });
  return bulbs;
}

/**
 * The string of lights: a wire in swags stretched across the row (percent x, so it follows any width) with the bulbs
 * placed on it by percent, so they keep their shape. `wide` has three swags, `narrow` (phones) two with fewer bulbs.
 */
export function ChristmasLights({ variant }: { variant: 'wide' | 'narrow' }) {
  const { anchors, sag } = LIGHT_SHAPE[variant];
  const control = LIGHT_TOP + sag * 2;
  const path = anchors
    .slice(0, -1)
    .map((x1, index) => {
      const x2 = anchors[index + 1]!;
      return `${index === 0 ? `M${n(x1)} ${LIGHT_TOP}` : ''}Q${n((x1 + x2) / 2)} ${control} ${n(x2)} ${LIGHT_TOP}`;
    })
    .join('');
  return (
    <div className={`ls-art-lights ls-art-lights-${variant}`} aria-hidden="true">
      <ArtSvg viewBox="0 0 100 48" preserveAspectRatio="none" className="ls-art-wire">
        <path
          d={path}
          stroke={art('wire')}
          strokeWidth="1.8"
          fill="none"
          vectorEffect="non-scaling-stroke"
        />
      </ArtSvg>
      {lightPositions(variant).map((bulb, index) => (
        <ArtSvg
          key={index}
          viewBox="0 0 28 36"
          className="ls-art-bulb"
          style={{ left: `${n(bulb.x)}%`, top: `calc(var(--ls-art-u) * ${n(bulb.y / 4)})` }}
        >
          <circle cx="14" cy="21" r="12" fill={art(bulb.color)} opacity=".14" />
          <rect x="11.4" y="2" width="5.2" height="4.4" rx="1" fill={art('wire')} />
          <path d="M14 6C8 8 6.5 16 14 20C21.5 16 20 8 14 6Z" fill={art(bulb.color)} />
          <ellipse cx="12" cy="11" rx="1.4" ry="2.4" fill={art('white')} opacity=".55" />
        </ArtSvg>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------------------- garland

const GARLAND_W = 232;
const GARLAND_H = 112;
const GARLAND_POINTS = Array.from({ length: 39 }, (_, index) => {
  const t = index / 38;
  return { x: GARLAND_W * t, y: (GARLAND_H - 22) * (1 - (1 - t) ** 2) * 0.9 + 4 };
});

/** A pine garland with baubles, berries and a red bow, hung from the top-left corner (232 x 112). */
export function ChristmasGarland({ className }: { className?: string }) {
  const point = (t: number) => GARLAND_POINTS[Math.round(t * 38)]!;
  return (
    <ArtSvg viewBox={`0 0 ${GARLAND_W} ${GARLAND_H}`} className={className}>
      {GARLAND_POINTS.map(({ x, y }, index) => {
        const angle = 40 + (index % 2 ? 36 : -30);
        const tone = index % 3 === 0 ? 'pine2' : index % 2 ? 'pine' : 'pine3';
        return (
          <g key={index}>
            <ellipse
              cx={n(x)}
              cy={n(y + 4)}
              rx="15"
              ry="5"
              transform={`rotate(${angle} ${n(x)} ${n(y + 4)})`}
              fill={art(tone)}
            />
            <ellipse
              cx={n(x)}
              cy={n(y)}
              rx="14"
              ry="5"
              transform={`rotate(${90 - angle} ${n(x)} ${n(y)})`}
              fill={art(index % 2 ? 'pine3' : 'pine')}
            />
          </g>
        );
      })}
      {(
        [
          [0.18, 'red'],
          [0.34, 'bulb4'],
          [0.52, 'red'],
          [0.7, 'bulb3'],
          [0.86, 'red'],
        ] as const
      ).map(([t, color], index) => (
        <Bauble
          key={t}
          x={point(t).x + (index % 2 ? 4 : -4)}
          y={point(t).y + 17}
          r={7}
          color={color}
        />
      ))}
      {[0.1, 0.27, 0.45, 0.62, 0.78].map((t) => (
        <g key={t}>
          <circle cx={n(point(t).x)} cy={n(point(t).y - 2)} r="3" fill={art('red')} />
          <circle cx={n(point(t).x + 5)} cy={n(point(t).y + 1)} r="3" fill={art('red2')} />
        </g>
      ))}
      <g transform="translate(22 14)">
        <path d="M0 0C-24 -18 -30 6 -10 10Z" fill={art('red')} />
        <path d="M0 0C24 -18 30 6 10 10Z" fill={art('red')} />
        <path d="M-4 8L-14 34L-4 30L0 36Z" fill={art('red3')} />
        <path d="M4 8L14 34L4 30L0 36Z" fill={art('red3')} />
        <circle cy="5" r="5.5" fill={art('red2')} />
      </g>
    </ArtSvg>
  );
}

/** A santa hat that sits on the top edge of the wordmark (56 x 48). */
export function ChristmasHat({ className }: { className?: string }) {
  return (
    <ArtSvg viewBox="0 0 56 48" className={className}>
      <path
        d="M6 36C6 18 16 6 32 6C40 6 44 12 50 22C52 26 54 28 56 32C46 28 40 30 30 32L6 38Z"
        fill={art('red')}
      />
      <path d="M10 34C10 20 18 10 30 9C22 16 20 26 22 34Z" fill={art('red2')} opacity=".55" />
      <rect y="32" width="46" height="13" rx="6.5" fill={art('white')} />
      <circle cx="53" cy="30" r="6.4" fill={art('white')} />
    </ArtSvg>
  );
}

/** Divider centrepiece: a pine twig with berries around a snowflake (160 x 28). */
export function ChristmasDividerArt({ className }: { className?: string }) {
  return (
    <ArtSvg viewBox="0 0 160 28" className={className}>
      <path d="M14 14H146" stroke={art('pine3')} strokeWidth="3" strokeLinecap="round" />
      {Array.from({ length: 12 }, (_, index) => {
        const x = 20 + index * 11;
        const up = index % 2 === 1;
        return (
          <ellipse
            key={index}
            cx={x}
            cy={up ? 8 : 20}
            rx="8"
            ry="3"
            transform={`rotate(${up ? -35 : 35} ${x} ${up ? 8 : 20})`}
            fill={art(index % 3 ? 'pine' : 'pine2')}
          />
        );
      })}
      {[58, 102].map((x) => (
        <g key={x}>
          <circle cx={x} cy="13" r="3.6" fill={art('red')} />
          <circle cx={x + 6} cy="16" r="3.2" fill={art('red2')} />
        </g>
      ))}
      <g transform="translate(80 14)" stroke={art('ice')} strokeWidth="2.2" strokeLinecap="round">
        {[0, 60, 120].map((angle) => (
          <path key={angle} d="M0 -11V11" transform={`rotate(${angle})`} />
        ))}
        <circle r="3" fill="var(--ls-bg-page)" />
      </g>
    </ArtSvg>
  );
}

// ------------------------------------------------------------------------------- footer scene

/** The snowy hills of the footer: a back drift and a front drift, stretched to the width. */
export function ChristmasHills({ className }: { className?: string }) {
  return (
    <ArtSvg viewBox="0 0 1440 232" preserveAspectRatio="none" className={className}>
      <path
        d="M0 150C120 120 240 130 360 148C500 168 620 120 760 124C900 128 1020 164 1160 140C1260 124 1360 118 1440 132V232H0Z"
        fill={art('snow2')}
      />
      <path
        d="M0 176C140 150 260 164 400 178C540 192 660 160 800 166C940 172 1060 196 1200 178C1300 166 1380 160 1440 168V232H0Z"
        fill={art('snow')}
      />
    </ArtSvg>
  );
}

/** A decorated pine tree with a star, baubles and a string of lights (120 x 170). */
export function ChristmasTree({ className }: { className?: string }) {
  const tiers: Array<[number, number, number]> = [
    [14, 50, 25],
    [32, 82, 35],
    [56, 114, 45],
    [80, 146, 56],
  ];
  return (
    <ArtSvg viewBox="0 0 120 170" className={className}>
      <rect x="52" y="140" width="16" height="26" rx="2" fill={art('wood')} />
      {tiers.map(([top, bottom, half], index) => (
        <g key={top}>
          <polygon
            points={`60,${top} ${60 - half},${bottom} ${60 + half},${bottom}`}
            fill={art(index % 2 ? 'pine' : 'pine3')}
          />
          <polygon
            points={`60,${top} ${60 - half},${bottom} ${n(60 - half * 0.2)},${bottom}`}
            fill={art('pine2')}
            opacity=".5"
          />
          <path
            d={`M${60 - half} ${bottom}Q${n(60 - half * 0.5)} ${bottom - 7} 60 ${bottom}Q${n(60 + half * 0.5)} ${bottom - 7} ${60 + half} ${bottom}`}
            fill={art('snow')}
            opacity=".85"
          />
        </g>
      ))}
      <polygon
        points="60,0 65,9 75,10 67,17 70,27 60,21 50,27 53,17 45,10 55,9"
        fill={art('star')}
      />
      <path
        d="M42 44C52 52 70 50 78 42M30 74C46 88 76 84 90 72M22 104C42 124 80 120 100 100M14 136C40 156 82 154 106 132"
        stroke={art('white')}
        strokeWidth="2.2"
        fill="none"
        opacity=".95"
        strokeDasharray="1 7"
        strokeLinecap="round"
      />
      {(
        [
          [50, 54, 5, 'bulb1'],
          [70, 46, 4.4, 'bulb4'],
          [42, 86, 5.6, 'bulb3'],
          [70, 80, 5, 'bulb1'],
          [88, 110, 5.6, 'bulb4'],
          [34, 112, 5.6, 'bulb1'],
          [62, 108, 5, 'bulb3'],
          [100, 140, 5, 'bulb1'],
          [20, 142, 4.8, 'bulb4'],
          [58, 140, 5, 'bulb3'],
        ] as const
      ).map(([x, y, r, color]) => (
        <Bauble key={`${x}-${y}`} x={x} y={y} r={r} color={color} />
      ))}
    </ArtSvg>
  );
}

function Gift({
  x,
  y,
  w,
  h,
  body,
  ribbon,
  rotation = 0,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  body: string;
  ribbon: string;
  rotation?: number;
}) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rotation})`}>
      <rect width={w} height={h} rx="3" fill={art(body)} />
      <rect x="-3" y="-6" width={w + 6} height="12" rx="3" fill={art(body)} opacity=".92" />
      <rect x="-3" y="-6" width={w + 6} height="5" rx="2.5" fill={art('white')} opacity=".22" />
      <rect x={w / 2 - 4} y="-6" width="8" height={h + 6} fill={art(ribbon)} />
      <path
        d={`M${w / 2} -6C${w / 2 - 16} -22 ${w / 2 - 22} -6 ${w / 2} -6C${w / 2 + 22} -6 ${w / 2 + 16} -22 ${w / 2} -6Z`}
        fill={art(ribbon)}
      />
      <circle cx={w / 2} cy="-6" r="3.6" fill={art(ribbon)} />
    </g>
  );
}

/** Three gifts for the foot of the left tree (128 x 64). */
export function ChristmasGiftsA({ className }: { className?: string }) {
  return (
    <ArtSvg viewBox="0 0 128 64" className={className}>
      <Gift x={4} y={22} w={44} h={38} body="red" ribbon="white" />
      <Gift x={56} y={6} w={34} h={54} body="pine" ribbon="pink" rotation={4} />
      <Gift x={96} y={30} w={30} h={30} body="bulb3" ribbon="red" />
    </ArtSvg>
  );
}

/** Two gifts for the foot of the right tree (92 x 64). */
export function ChristmasGiftsB({ className }: { className?: string }) {
  return (
    <ArtSvg viewBox="0 0 92 64" className={className}>
      <Gift x={4} y={24} w={38} h={36} body="pine" ribbon="red" />
      <Gift x={48} y={8} w={40} h={52} body="pink" ribbon="pine" rotation={-3} />
    </ArtSvg>
  );
}

/** A falling snowflake (16 x 16). */
export function ChristmasFlake() {
  return (
    <svg className="ls-fx-site-glyph" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <g stroke={art('ice')} strokeWidth="1.6" strokeLinecap="round" fill="none">
        <path d="M8 1V15M2 4.5L14 11.5M14 4.5L2 11.5" />
      </g>
      <circle cx="8" cy="8" r="2" fill={art('ice')} />
    </svg>
  );
}
