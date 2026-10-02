import { ArtSvg, art, type ArtProps } from './season-art-kit';
import {
  Bow,
  Heart,
  Hang,
  Leaf,
  RailCord,
  RailRow,
  Rose,
  place,
  type RailCell,
} from './season-art-shapes';

// Valentine kit (docs/UXUI_REDESIGN_S6_PLAN.md section 4.1): roses, chocolates, love letters and a cupid, in the
// rose and blush of the `valentine` preset. No yellow anywhere. Decoration only: aria-hidden, nothing focusable.

const HEART_COLORS = ['rose', 'pink', 'rose2'] as const;

/** A love letter: a cream envelope with a flap and a heart seal, `w` x `h` about its origin at the centre. */
function Envelope({
  x = 0,
  y = 0,
  r = 0,
  w = 44,
  seal = 'rose',
}: {
  x?: number;
  y?: number;
  r?: number;
  w?: number;
  seal?: string;
}) {
  const h = w * 0.68;
  return (
    <g transform={place(x, y, 1, r)}>
      <rect x={-w / 2} y={-h / 2} width={w} height={h} rx="3" fill={art('paper')} />
      <path
        d={`M${-w / 2} ${-h / 2}L0 ${h * 0.08}L${w / 2} ${-h / 2}`}
        stroke={art('pink')}
        strokeWidth="2"
        fill="none"
        strokeLinejoin="round"
      />
      <path
        d={`M${-w / 2} ${h / 2}L${-w * 0.14} ${h * 0.02}M${w / 2} ${h / 2}L${w * 0.14} ${h * 0.02}`}
        stroke={art('pink')}
        strokeWidth="1.4"
        fill="none"
      />
      <Heart fill={seal} y={h * 0.04} s={0.42} />
    </g>
  );
}

// ------------------------------------------------------------------------------------------ header rail

/** Hearts, roses and love letters hanging on strings from a cord across the row. */
export function ValentineRail() {
  const hearts = (index: number, drop: number) => (
    <Hang width={48} height={64} stringTo={drop} stringColor="string">
      <Heart fill={HEART_COLORS[index % HEART_COLORS.length]!} x={24} y={drop + 15} s={1.1} />
    </Hang>
  );
  const letter = (drop: number, seal: string) => (
    <Hang width={48} height={64} stringTo={drop} stringColor="string">
      <Envelope x={24} y={drop + 15} r={swing(drop)} w={36} seal={seal} />
    </Hang>
  );
  const rose = (drop: number) => (
    <Hang width={48} height={64} stringTo={drop} stringColor="string">
      <Leaf fill="leaf" x={22} y={drop + 18} r={150} s={0.7} />
      <Leaf fill="leaf2" x={26} y={drop + 18} r={30} s={0.7} />
      <Rose x={24} y={drop + 14} s={0.95} />
    </Hang>
  );
  const cells: RailCell[] = [
    { node: hearts(0, 22) },
    { node: letter(16, 'rose'), hide: 'narrow' },
    { node: hearts(1, 30), hide: 'medium' },
    { node: rose(20) },
    { node: hearts(2, 14), hide: 'medium' },
    { node: letter(26, 'rose2'), hide: 'narrow' },
    { node: hearts(0, 26), hide: 'medium' },
    { node: rose(14), hide: 'narrow' },
    { node: hearts(1, 20) },
  ];
  return (
    <>
      <RailCord color="string" />
      <RailRow cells={cells} height={0.8} />
    </>
  );
}

/** Tilt for a hanging letter: a small fixed swing, so server and client agree. */
function swing(drop: number): number {
  return drop % 2 === 0 ? -6 : 7;
}

// ------------------------------------------------------------------------------------------ corner

/** A rose branch with buds, leaves, a small bow and floating hearts, in the top-left corner (232 x 112). */
export function ValentineCorner({ className }: ArtProps) {
  return (
    <ArtSvg viewBox="0 0 232 112" className={className} motif="roses">
      <path
        d="M-4 14C40 22 70 30 104 52C132 70 166 74 214 66"
        stroke={art('leaf2')}
        strokeWidth="3.4"
        fill="none"
        strokeLinecap="round"
      />
      {(
        [
          [34, 30, 20, 'leaf'],
          [64, 48, 60, 'leaf2'],
          [92, 52, 20, 'leaf'],
          [126, 70, 70, 'leaf2'],
          [156, 74, 10, 'leaf'],
          [186, 72, 60, 'leaf'],
        ] as const
      ).map(([x, y, r, c]) => (
        <Leaf key={x} fill={c} x={x} y={y} r={r} s={0.9} />
      ))}
      <Rose x={30} y={30} s={1.4} />
      <Rose x={80} y={48} s={1.1} c="rose2" c2="pink" c3="rose" />
      <Rose x={132} y={64} s={0.95} />
      <g transform={place(172, 78, 1, -20)}>
        <ellipse rx="6" ry="10" fill={art('rose')} />
        <path d="M-5 5C-6 12 6 12 5 5Z" fill={art('leaf2')} />
      </g>
      <Heart fill="pink" x={196} y={28} s={0.62} r={14} />
      <Heart fill="rose2" x={216} y={52} s={0.4} r={-10} />
      <Heart fill="rose" x={150} y={22} s={0.34} r={-14} />
      <Bow c="ribbon" c2="rose3" x={8} y={58} s={0.8} r={-20} />
    </ArtSvg>
  );
}

// ------------------------------------------------------------------------------------------ logo and divider

/** A heart tied with a bow, beside the wordmark (56 x 48). */
export function ValentineLogoHeart({ className }: ArtProps) {
  return (
    <ArtSvg viewBox="0 0 56 48" className={className} motif="roses">
      <Heart fill="rose" x={28} y={24} s={1.1} />
      <Bow c="ribbon" c2="rose3" x={28} y={9} s={0.5} />
    </ArtSvg>
  );
}

/** Divider centrepiece: a heart pierced by an arrow between two rosebuds (200 x 32). */
export function ValentineDividerArt({ className }: ArtProps) {
  return (
    <ArtSvg viewBox="0 0 200 32" className={className} motif="roses cupid">
      {[52, 148].map((x) => (
        <g key={x}>
          <Leaf fill="leaf" x={x - 2} y={20} r={160} s={0.55} />
          <Leaf fill="leaf2" x={x + 2} y={20} r={20} s={0.55} />
          <Rose x={x} y={15} s={0.62} />
        </g>
      ))}
      <Heart fill="rose" x={100} y={16} s={0.78} />
      <path d="M78 26L124 6" stroke={art('choc')} strokeWidth="2" strokeLinecap="round" />
      <path d="M124 6L117 6.4L121 12Z" fill={art('choc')} />
      <path
        d="M78 26L74 22M78 26L74 30M82 24L78 20M82 24L78 28"
        stroke={art('rose3')}
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <Heart fill="pink" x={20} y={14} s={0.3} />
      <Heart fill="pink" x={180} y={14} s={0.3} />
    </ArtSvg>
  );
}

// ------------------------------------------------------------------------------------------ footer scene

/** A chubby cupid in flight with a bow, a drawn arrow and a trail of hearts (180 x 150). */
export function ValentineCupid({ className }: ArtProps) {
  return (
    <g className={className} transform="translate(0 0)" data-motif="cupid">
      <path d="M-4 -34C-34 -78 -78 -66 -70 -34C-64 -14 -30 -14 -4 -26Z" fill={art('wing')} />
      <path d="M-4 -30C-28 -58 -58 -52 -58 -32C-58 -20 -36 -18 -4 -24Z" fill={art('pink2')} />
      <path d="M4 -34C34 -78 78 -66 70 -34C64 -14 30 -14 4 -26Z" fill={art('wing')} />
      <path d="M4 -30C28 -58 58 -52 58 -32C58 -20 36 -18 4 -24Z" fill={art('pink2')} />
      <path
        d="M-62 -40C-48 -34 -34 -34 -20 -30M62 -40C48 -34 34 -34 20 -30"
        stroke={art('pink')}
        strokeWidth="1.6"
        fill="none"
      />
      <path
        d="M-12 14C-26 20 -34 34 -26 42M10 16C26 18 38 28 34 40"
        stroke={art('skin')}
        strokeWidth="9"
        strokeLinecap="round"
        fill="none"
      />
      <ellipse cx="0" cy="0" rx="19" ry="24" fill={art('skin')} />
      <path d="M-18 8C-8 20 8 20 18 8L18 14C8 28 -8 28 -18 14Z" fill={art('rose')} />
      <path
        d="M17 -8C32 -12 44 -4 50 -14"
        stroke={art('skin')}
        strokeWidth="8"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M-17 -6C-30 -4 -40 -14 -44 -26"
        stroke={art('skin')}
        strokeWidth="8"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="0" cy="-34" r="19" fill={art('skin')} />
      {[-14, -6, 4, 12].map((x, i) => (
        <circle key={x} cx={x} cy={-49 + (i % 2) * 2} r="7" fill={art('choc')} />
      ))}
      <circle cx="-7" cy="-33" r="2.2" fill={art('ink')} />
      <circle cx="7" cy="-33" r="2.2" fill={art('ink')} />
      <circle cx="-12" cy="-26" r="3.4" fill={art('pink')} opacity=".7" />
      <circle cx="12" cy="-26" r="3.4" fill={art('pink')} opacity=".7" />
      <path
        d="M-4 -24C-1 -21 1 -21 4 -24"
        stroke={art('rose3')}
        strokeWidth="1.6"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M58 -34C86 -34 86 6 58 6"
        stroke={art('choc')}
        strokeWidth="3.4"
        fill="none"
        strokeLinecap="round"
      />
      <path d="M58 -34L58 6" stroke={art('string')} strokeWidth="1" />
      <path d="M44 -14L98 -14" stroke={art('choc2')} strokeWidth="2.2" strokeLinecap="round" />
      <path d="M98 -14L90 -18L90 -10Z" fill={art('rose3')} />
      <path
        d="M44 -14L38 -18M44 -14L38 -10"
        stroke={art('rose')}
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </g>
  );
}

/** A heart-shaped box of chocolates with a bow (130 x 120 about its centre). */
function ChocolateBox() {
  return (
    <g data-motif="chocolates">
      <path
        d="M0 56C-66 18 -56 -44 -26 -44C-10 -44 -2 -32 0 -24C2 -32 10 -44 26 -44C56 -44 66 18 0 56Z"
        fill={art('rose3')}
      />
      <path
        d="M0 46C-54 14 -46 -34 -22 -34C-9 -34 -2 -24 0 -17C2 -24 9 -34 22 -34C46 -34 54 14 0 46Z"
        fill={art('cream')}
      />
      {(
        [
          [-24, -14, 10, 'choc'],
          [-2, -6, 9, 'choc2'],
          [22, -14, 10, 'choc'],
          [-12, 14, 9, 'rose2'],
          [12, 12, 10, 'choc2'],
          [0, 30, 8, 'choc'],
        ] as const
      ).map(([x, y, r, c]) => (
        <g key={`${x}-${y}`}>
          <circle cx={x} cy={y} r={r} fill={art(c)} />
          <path
            d={`M${x - r * 0.5} ${y - r * 0.3}C${x - r * 0.1} ${y - r * 0.9} ${x + r * 0.5} ${y - r * 0.2} ${x + r * 0.2} ${y + r * 0.3}`}
            stroke={art('white')}
            strokeWidth="1.3"
            fill="none"
            opacity=".5"
          />
        </g>
      ))}
      <Bow c="ribbon" c2="rose3" x={0} y={-44} s={0.9} />
    </g>
  );
}

/** A little stack of love letters tied with a ribbon (120 x 90 about its centre). */
function LoveLetters() {
  return (
    <g data-motif="love-letters">
      <Envelope x={-6} y={14} r={-8} w={92} seal="rose3" />
      <Envelope x={6} y={0} r={5} w={92} seal="rose" />
      <g transform={place(-2, -28, 1, -4)}>
        <rect x="-34" y="-20" width="68" height="46" rx="3" fill={art('paper')} />
        <path
          d="M-24 -10L24 -10M-24 -2L16 -2M-24 6L20 6"
          stroke={art('pink')}
          strokeWidth="2"
          strokeLinecap="round"
        />
        <Heart fill="rose" x={22} y={14} s={0.5} />
      </g>
      <path d="M-46 12L46 4" stroke={art('ribbon')} strokeWidth="5" strokeLinecap="round" />
      <Bow c="ribbon" c2="rose3" x={0} y={8} s={0.7} />
    </g>
  );
}

/** A wrapped bunch of roses on leafy stems with a bow (110 x 150, its tip at the bottom). */
function RoseBouquet() {
  return (
    <g data-motif="roses">
      {(
        [
          [-26, -62, -18],
          [0, -78, 0],
          [26, -62, 18],
          [-12, -38, -8],
          [14, -36, 8],
        ] as const
      ).map(([x, y, r]) => (
        <path
          key={x + y}
          d={`M${x} ${y}C${x} ${y + 30} ${x / 3} 10 0 40`}
          stroke={art('leaf2')}
          strokeWidth="3"
          fill="none"
          transform={`rotate(${r * 0.1})`}
        />
      ))}
      <Leaf fill="leaf" x={-8} y={-30} r={-150} s={1} />
      <Leaf fill="leaf2" x={8} y={-30} r={-30} s={1} />
      <Rose x={-26} y={-62} s={1.25} />
      <Rose x={0} y={-80} s={1.4} c="rose2" c2="pink" c3="rose" />
      <Rose x={26} y={-62} s={1.25} />
      <Rose x={-12} y={-38} s={1.05} c="rose3" c2="rose" c3="rose3" />
      <Rose x={14} y={-36} s={1.05} c2="pink" />
      <path d="M-44 -20L44 -20L14 54L-14 54Z" fill={art('pink2')} />
      <path
        d="M-44 -20L0 -4L44 -20M-30 18L0 28L30 18"
        stroke={art('pink')}
        strokeWidth="2"
        fill="none"
      />
      <Bow c="ribbon" c2="rose3" x={0} y={-2} s={0.8} />
    </g>
  );
}

/** Three heart balloons on strings gathered under a bow and tied to the ground (90 x 190, string end at the bottom). */
function HeartBalloons() {
  return (
    <g>
      <path
        d="M-18 14C-12 50 -4 70 0 92M20 -8C14 40 6 70 0 92M2 34C2 60 0 76 0 92M0 92L0 168"
        stroke={art('string')}
        strokeWidth="1.3"
        fill="none"
      />
      <Heart fill="rose" x={-18} y={0} s={1.5} r={-10} />
      <Heart fill="pink" x={20} y={-22} s={1.35} r={9} />
      <Heart fill="rose2" x={2} y={22} s={1.25} r={2} />
      <Bow c="ribbon" c2="rose3" x={0} y={92} s={0.7} />
    </g>
  );
}

const SCENE_HEARTS: ReadonlyArray<readonly [number, number, number, string]> = [
  [338, 66, 0.55, 'pink'],
  [372, 120, 0.4, 'rose2'],
  [532, 40, 0.5, 'rose'],
  [616, 24, 0.34, 'pink'],
  [858, 36, 0.4, 'pink'],
  [920, 70, 0.55, 'rose2'],
  [1060, 52, 0.45, 'rose'],
  [1104, 112, 0.36, 'pink'],
];

/**
 * The footer scene (1440 x 300): a soft pink floor, cupid in flight at the centre with a heart-shaped box of
 * chocolates and a bundle of love letters beside him, rose bouquets at the sides and hearts in the air. The middle
 * 465 units are a complete composition: a phone shows only those (the SVG is cropped to the centre), a tablet more.
 */
export function ValentineScene({ className }: ArtProps) {
  return (
    <ArtSvg
      viewBox="0 0 1440 300"
      preserveAspectRatio="xMidYMax slice"
      className={className}
      motif="roses chocolates love-letters cupid"
    >
      <path
        d="M0 214C140 196 260 206 400 222C540 238 660 204 800 208C940 212 1060 236 1200 220C1300 208 1380 204 1440 212V300H0Z"
        fill={art('cream2')}
      />
      <path
        d="M0 248C150 230 270 242 410 254C550 266 670 238 810 242C950 246 1070 266 1210 252C1310 242 1390 238 1440 244V300H0Z"
        fill={art('cream')}
      />
      {SCENE_HEARTS.map(([x, y, s, c]) => (
        <Heart key={`${x}-${y}`} fill={c} x={x} y={y} s={s} r={x % 2 === 0 ? -12 : 12} />
      ))}
      <g transform="translate(396 90)">
        <HeartBalloons />
      </g>
      <g transform="translate(1046 90) scale(-1 1)">
        <HeartBalloons />
      </g>
      <g transform="translate(240 168) scale(1.05)">
        <RoseBouquet />
      </g>
      <g transform="translate(1200 168) scale(-1.05 1.05)">
        <RoseBouquet />
      </g>
      <g transform="translate(596 150)">
        <ChocolateBox />
      </g>
      <g transform="translate(850 160)">
        <LoveLetters />
      </g>
      <g transform="translate(720 96) scale(1.1)">
        <ValentineCupid />
      </g>
    </ArtSvg>
  );
}

/** A falling heart (52 x 40 box): the color follows the index. */
export function ValentineHeartPiece({ index }: { index: number }) {
  return (
    <svg className="ls-fx-site-glyph" viewBox="-26 -20 52 40" aria-hidden="true" focusable="false">
      <Heart fill={HEART_COLORS[index % HEART_COLORS.length]!} />
    </svg>
  );
}
