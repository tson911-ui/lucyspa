import { ArtSvg, art, sceneView, type ArtProps, type SceneProps } from './season-art-kit';
import {
  Leaf,
  Lotus,
  LotusLeaf,
  RailRow,
  Rose,
  Sparkle,
  place,
  type RailCell,
} from './season-art-shapes';

// Vu Lan kit (docs/UXUI_REDESIGN_S6_PLAN.md section 4.1, Owner decision 6): calm and respectful, no yellow, no
// fireworks or balloons. Floating lotus lanterns (hoa dang) on water, a rose pinned on a shirt (hoa hong cai ao) and
// lotus. Colors are `--ls-art-*` tokens of the `vu-lan` preset. Decoration only: aria-hidden, nothing focusable.

/** A lotus bud on a stem, 18 wide and 40 high, resting on (0, 0). */
function Bud({ x = 0, y = 0, s = 1 }: { x?: number; y?: number; s?: number }) {
  return (
    <g transform={place(x, y, s)}>
      <path d="M0 0C-10 -6 -11 -22 0 -40C11 -22 10 -6 0 0Z" fill={art('lotus')} />
      <path d="M0 0C-4 -8 -4 -22 0 -40C4 -22 4 -8 0 0Z" fill={art('lotus2')} opacity=".7" />
    </g>
  );
}

/**
 * A floating lotus lantern (hoa dang): a lotus bloom on a small leaf with a warm light at its heart, glowing softly on
 * the water, about 70 wide; its base rests on (0, 0).
 */
function HoaDang({
  x = 0,
  y = 0,
  s = 1,
  white = false,
}: {
  x?: number;
  y?: number;
  s?: number;
  white?: boolean;
}) {
  return (
    <g transform={place(x, y, s)} data-motif="hoa-dang lotus">
      <ellipse cy="6" rx="34" ry="7" fill={art('water3')} opacity=".7" />
      <ellipse cy="6" rx="24" ry="5" fill={art('water2')} opacity=".6" />
      <circle cy="-14" r="30" fill={art('glow')} opacity=".16" />
      <circle cy="-14" r="19" fill={art('glow2')} opacity=".3" />
      <ellipse cy="4" rx="22" ry="6" fill={art('leaf')} />
      <Lotus
        c={white ? 'white' : 'lotus'}
        c2={white ? 'lotus2' : 'lotus3'}
        tip={white ? 'lotus2' : 'lotus2'}
        y={2}
        s={0.82}
      />
      <path d="M0 -10C4 -6 4 -1 0 1C-4 -1 -4 -6 0 -10Z" fill={art('glow')} />
      <path d="M0 -6C2 -4 2 -1.4 0 -0.4C-2 -1.4 -2 -4 0 -6Z" fill={art('glow2')} />
    </g>
  );
}

/** A shirt front with a red rose pinned on the chest (hoa hong cai ao), about 66 wide and 62 high, centred on (0, 0). */
function RoseShirt({ x = 0, y = 0, s = 1 }: { x?: number; y?: number; s?: number }) {
  return (
    <g transform={place(x, y, s)} data-motif="rose-on-shirt">
      <path
        d="M-28 -26L-12 -31L0 -20L12 -31L28 -26L34 -3L25 -1L25 31L-25 31L-25 -1L-34 -3Z"
        fill={art('shirt')}
        stroke={art('shirt2')}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M-12 -31L-1 -15L-14 -12L-23 -24Z"
        fill={art('white')}
        stroke={art('shirt2')}
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M12 -31L1 -15L14 -12L23 -24Z"
        fill={art('white')}
        stroke={art('shirt2')}
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M0 -15L0 31" stroke={art('shirt2')} strokeWidth="1.6" />
      {[-4, 9, 22].map((py) => (
        <circle key={py} cx="4" cy={py} r="1.6" fill={art('shirt2')} />
      ))}
      <rect
        x="10"
        y="2"
        width="12"
        height="14"
        rx="2"
        fill="none"
        stroke={art('shirt2')}
        strokeWidth="1.4"
      />
      <Leaf fill="leaf" x={-20} y={-5} r={160} s={0.6} />
      <Leaf fill="leaf2" x={-14} y={-4} r={30} s={0.55} />
      <Rose x={-16} y={-7} s={0.78} c="rose" c2="rose2" c3="rose3" />
    </g>
  );
}

/** A lotus plant: a leaf pad, a bloom on a stem and a bud, about 130 wide, the water line on y = 0. */
function LotusPlant({ s = 1, white = false }: { s?: number; white?: boolean }) {
  return (
    <g transform={`scale(${s})`} data-motif="lotus">
      <LotusLeaf fill="leaf" rib="leaf2" rx={50} x={-30} y={-4} />
      <LotusLeaf fill="leaf2" rib="leaf" rx={40} x={44} y={-2} />
      <path d="M-4 -4L-4 -22M30 -4L30 -34" stroke={art('leaf2')} strokeWidth="2.6" />
      <Lotus
        c={white ? 'white' : 'lotus'}
        c2={white ? 'lotus2' : 'lotus3'}
        tip="lotus2"
        x={-4}
        y={-20}
        s={1}
      />
      <Bud x={30} y={-32} s={0.8} />
      <path d="M62 -2L62 -24" stroke={art('leaf2')} strokeWidth="2.2" />
      <Bud x={62} y={-22} s={0.6} />
    </g>
  );
}

// ------------------------------------------------------------------------------------------ header rail

/** Water across the bottom of the row with lotus lanterns floating on it (the lanterns stand on the row's bottom edge). */
export function VuLanRail() {
  const lantern = (s: number, white = false) => (
    <ArtSvg viewBox="-40 -52 80 66">
      <HoaDang s={s} white={white} />
    </ArtSvg>
  );
  const cells: RailCell[] = [
    { node: lantern(1) },
    { node: lantern(0.8, true), hide: 'narrow' },
    { node: lantern(0.92), hide: 'medium' },
    { node: lantern(1, true) },
    { node: lantern(0.84), hide: 'medium' },
    { node: lantern(0.96), hide: 'narrow' },
    { node: lantern(0.8, true), hide: 'medium' },
    { node: lantern(0.9), hide: 'narrow' },
    { node: lantern(1) },
  ];
  return (
    <>
      <ArtSvg viewBox="0 0 100 10" preserveAspectRatio="none" className="ls-art-water">
        <path
          d="M0 4Q6.25 0 12.5 4T25 4T37.5 4T50 4T62.5 4T75 4T87.5 4T100 4"
          stroke={art('water2')}
          strokeWidth="2"
          fill="none"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d="M0 8Q6.25 4 12.5 8T25 8T37.5 8T50 8T62.5 8T75 8T87.5 8T100 8"
          stroke={art('water')}
          strokeWidth="2"
          fill="none"
          vectorEffect="non-scaling-stroke"
        />
      </ArtSvg>
      <RailRow cells={cells} align="bottom" height={0.78} />
    </>
  );
}

// ------------------------------------------------------------------------------------------ corner

/** Lotus on curving stems with leaves, a bud and a floating lantern in the top-left corner (232 x 112). */
export function VuLanCorner({ className }: ArtProps) {
  return (
    <ArtSvg viewBox="0 0 232 112" className={className} motif="lotus hoa-dang">
      <path
        d="M-4 8C40 14 76 28 104 52C130 72 168 76 214 68"
        stroke={art('leaf2')}
        strokeWidth="3.2"
        fill="none"
        strokeLinecap="round"
      />
      <LotusLeaf fill="leaf" rib="leaf2" rx={34} x={64} y={40} r={14} />
      <LotusLeaf fill="leaf2" rib="leaf" rx={28} x={150} y={80} r={-8} />
      <Lotus c="lotus" c2="lotus3" tip="lotus2" x={34} y={30} s={1.1} r={118} />
      <Lotus c="white" c2="lotus2" tip="lotus" x={100} y={52} s={0.84} r={124} />
      <Bud x={134} y={70} s={0.7} />
      <g transform="translate(192 74) scale(.62)">
        <HoaDang />
      </g>
      <Sparkle fill="lotus2" x={14} y={52} r={5} />
      <Sparkle fill="lotus2" x={170} y={30} r={5} />
    </ArtSvg>
  );
}

// ------------------------------------------------------------------------------------------ logo and divider

/** The rose pinned on a shirt, beside the wordmark (56 x 48). */
export function VuLanLogo({ className }: ArtProps) {
  return (
    <ArtSvg viewBox="0 0 56 48" className={className} motif="rose-on-shirt">
      <RoseShirt x={28} y={25} s={0.7} />
    </ArtSvg>
  );
}

/** Divider centrepiece: a lotus on the water between two lanterns (200 x 32). */
export function VuLanDividerArt({ className }: ArtProps) {
  return (
    <ArtSvg viewBox="0 0 200 32" className={className} motif="lotus hoa-dang">
      <path
        d="M14 28Q27 24 40 28T66 28T92 28M108 28Q121 24 134 28T160 28T186 28"
        stroke={art('water2')}
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
      />
      <HoaDang x={44} y={26} s={0.34} />
      <HoaDang x={156} y={26} s={0.34} white />
      <LotusLeaf fill="leaf" rib="leaf2" rx={20} x={100} y={29} />
      <Lotus c="lotus" c2="lotus3" tip="lotus2" x={100} y={28} s={0.6} />
    </ArtSvg>
  );
}

// ------------------------------------------------------------------------------------------ footer scene

const GLOWS: ReadonlyArray<readonly [number, number, number, boolean]> = [
  [560, 214, 0.78, false],
  [884, 210, 0.82, true],
  [440, 238, 0.62, true],
  [1010, 236, 0.66, false],
  [330, 206, 0.56, false],
  [1120, 204, 0.6, true],
];

/**
 * The footer scene (1440 x 300): a still pond with lotus in the middle (a white and a pink bloom among leaves), lotus
 * lanterns floating around them, the rose pinned on a shirt on a round badge on each side and lotus plants in the
 * corners. The middle 400 units (the lotus and three lanterns) are complete for a phone.
 */
export function VuLanScene({ className, part, split }: SceneProps) {
  return (
    <ArtSvg {...sceneView(part, split)} className={className} motif="rose-on-shirt hoa-dang lotus">
      <path
        d="M0 214C140 200 260 208 400 220C540 232 660 206 800 210C940 214 1060 234 1200 220C1300 210 1380 206 1440 212V300H0Z"
        fill={art('cream2')}
      />
      <path
        d="M0 248C150 234 270 244 410 254C550 264 670 240 810 244C950 248 1070 264 1210 252C1310 244 1390 240 1440 246V300H0Z"
        fill={art('cream')}
      />
      <path
        d="M120 228Q150 222 180 228T240 228M1200 232Q1230 226 1260 232T1320 232M520 250Q560 244 600 250T680 250M780 252Q820 246 860 252T940 252"
        stroke={art('water2')}
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
      />
      <g transform="translate(300 128)">
        <circle r="52" fill={art('cream')} />
        <circle r="52" fill="none" stroke={art('water2')} strokeWidth="2" />
        <RoseShirt s={1.15} />
      </g>
      <g transform="translate(1140 128)">
        <circle r="52" fill={art('cream')} />
        <circle r="52" fill="none" stroke={art('water2')} strokeWidth="2" />
        <RoseShirt s={1.15} />
      </g>
      <g transform="translate(140 270)">
        <LotusPlant s={1.2} />
      </g>
      <g transform="translate(1290 270)">
        <LotusPlant s={1.2} white />
      </g>
      {GLOWS.map(([x, y, s, white]) => (
        <HoaDang key={`${x}-${y}`} x={x} y={y} s={s} white={white} />
      ))}
      <g transform="translate(720 196)">
        <LotusPlant s={1.1} />
      </g>
      <g transform="translate(700 190) scale(1.2)">
        <Lotus c="white" c2="lotus2" tip="lotus" x={30} y={0} s={0.9} />
      </g>
      <Sparkle fill="lotus2" x={420} y={60} r={6} />
      <Sparkle fill="lotus2" x={1000} y={64} r={7} />
      <Sparkle fill="lotus2" x={720} y={40} r={5} />
    </ArtSvg>
  );
}

/** A floating lantern for the optional slow drift (about 34 wide): the lotus lantern of the kit. */
export function VuLanLanternPiece({ index }: { index: number }) {
  return (
    <svg className="ls-fx-site-glyph" viewBox="-40 -52 80 66" aria-hidden="true" focusable="false">
      <HoaDang white={index % 3 === 1} />
    </svg>
  );
}
