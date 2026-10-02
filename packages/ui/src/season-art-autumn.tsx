import type { ReactNode } from 'react';
import { ArtSvg, art, n, sceneView, type ArtProps, type SceneProps } from './season-art-kit';
import { Hang, RailCord, RailRow, Sparkle, Star, place, type RailCell } from './season-art-shapes';
import { Cymbals, LionDance, OngDia } from './season-art-lion';
import { starPoints } from './season-ornaments';

// Mid-Autumn kit (docs/UXUI_REDESIGN_S6_PLAN.md section 4.1): the lion dance, star lanterns, carp lanterns, spinning
// (keo quan) lanterns, the full moon, Chi Hang and Chu Cuoi under the banyan, the jade rabbit and mooncakes. Yellow is
// allowed in this kit (Q-S1). Colors are `--ls-art-*` tokens of the `mid-autumn` preset. Decoration only.

// ------------------------------------------------------------------------------------------ lanterns

/** A star lantern (den ong sao): a five-point star with a glowing heart and a tassel, about 52 wide, centred on (0, 0). */
function StarLantern({
  x = 0,
  y = 0,
  s = 1,
  c = 'red',
  c2 = 'red2',
}: {
  x?: number;
  y?: number;
  s?: number;
  c?: string;
  c2?: string;
}) {
  return (
    <g transform={place(x, y, s)} data-motif="star-lantern">
      <rect x="-3.4" y="-35" width="6.8" height="7" rx="1.6" fill={art('yellow2')} />
      <polygon points={starPoints(0, 0, 27, 11.5)} fill={art(c)} />
      <polygon points={starPoints(0, 0, 18.5, 8)} fill={art(c2)} />
      <polygon points={starPoints(0, 0, 11, 5)} fill={art('yellow3')} />
      <circle r="3.6" fill={art('white')} opacity=".85" />
      <path
        d="M0 14L0 36M-4 14L-7 33M4 14L7 33"
        stroke={art('yellow2')}
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <circle cy="37" r="2.6" fill={art('yellow')} />
    </g>
  );
}

/** A carp lantern (den ca chep), side view, about 76 wide, centred on (0, 0); `c` is the body color. */
function CarpLantern({
  x = 0,
  y = 0,
  s = 1,
  r = 0,
  c = 'orange',
  c2 = 'orange2',
}: {
  x?: number;
  y?: number;
  s?: number;
  r?: number;
  c?: string;
  c2?: string;
}) {
  return (
    <g transform={place(x, y, s, r)} data-motif="carp-lantern">
      <path
        d="M-30 0C-24 -16 -4 -21 14 -12C20 -9 25 -5 29 -2L42 -16C44 -8 43 -2 41 0C43 3 44 9 42 16L29 2C25 5 20 9 14 12C-4 21 -24 16 -30 0Z"
        fill={art(c)}
      />
      <path d="M-8 -16C0 -26 12 -26 16 -12Z" fill={art('red')} />
      <path
        d="M29 -2L42 -16C44 -8 43 -2 41 0C43 3 44 9 42 16L29 2Z"
        fill={art('red')}
        opacity=".85"
      />
      {[
        [-10, -6],
        [-10, 6],
        [2, 0],
        [2, -10],
        [2, 10],
        [14, -4],
        [14, 6],
      ].map(([px, py]) => (
        <path
          key={`${px}-${py}`}
          d={`M${px! - 5} ${py! - 5}C${px! + 1} ${py! - 3} ${px! + 1} ${py! + 3} ${px! - 5} ${py! + 5}`}
          stroke={art(c2)}
          strokeWidth="1.8"
          fill="none"
          strokeLinecap="round"
        />
      ))}
      <path d="M-20 -9C-18 -3 -18 4 -20 10" stroke={art('red3')} strokeWidth="1.6" fill="none" />
      <circle cx="-22" cy="-4" r="4.4" fill={art('white')} />
      <circle cx="-23" cy="-4" r="2.2" fill={art('ink')} />
      <path
        d="M-30 2C-28 5 -25 6 -22 5"
        stroke={art('red3')}
        strokeWidth="1.6"
        fill="none"
        strokeLinecap="round"
      />
      <path d="M-8 -20L-8 -30M8 -20L8 -30" stroke={art('string')} strokeWidth="1.2" />
    </g>
  );
}

/** A spinning lantern (den keo quan): a lit drum with a ring of silhouettes, about 36 wide and 66 high, centred. */
function SpinningLantern({ x = 0, y = 0, s = 1 }: { x?: number; y?: number; s?: number }) {
  return (
    <g transform={place(x, y, s)} data-motif="spinning-lantern">
      <path d="M-20 -22L20 -22L12 -33L-12 -33Z" fill={art('red')} />
      <circle cy="-35" r="3" fill={art('yellow2')} />
      <rect x="-18" y="-22" width="36" height="44" rx="3" fill={art('yellow3')} />
      <path d="M-6 -22L-6 22M6 -22L6 22" stroke={art('red')} strokeWidth="2" />
      <path d="M-18 -22L-18 22M18 -22L18 22" stroke={art('red')} strokeWidth="3" />
      <g fill={art('red3')} opacity=".85">
        <path d="M-15 8C-12 -2 -8 -4 -3 -2L-3 6L-5 6L-5 12L-7 12L-7 6L-11 6L-11 12L-13 12L-13 6Z" />
        <circle cx="5" cy="-8" r="2.6" />
        <path d="M2 -4L8 -4L9 8L7 8L6 14L4 14L4 8L3 8Z" />
        <path d="M11 -2C13 -8 17 -8 17 -2L16 6L12 6Z" />
      </g>
      <path d="M-20 22L20 22L14 31L-14 31Z" fill={art('red')} />
      <path
        d="M-8 31L-8 44M0 31L0 48M8 31L8 44"
        stroke={art('yellow2')}
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </g>
  );
}

// ------------------------------------------------------------------------------------------ moon, rabbit, mooncakes

function MoonDisc({ x = 0, y = 0, r }: { x?: number; y?: number; r: number }) {
  return (
    <g transform={place(x, y)} data-motif="full-moon">
      <circle r={n(r * 1.42)} fill={art('moon')} opacity=".22" />
      <circle r={n(r * 1.18)} fill={art('moon')} opacity=".4" />
      <circle r={n(r)} fill={art('moon')} stroke={art('moon2')} strokeWidth="2.4" />
      <circle cx={n(-r * 0.42)} cy={n(r * 0.28)} r={n(r * 0.2)} fill={art('moon2')} opacity=".35" />
      <circle cx={n(r * 0.5)} cy={n(r * 0.46)} r={n(r * 0.14)} fill={art('moon2')} opacity=".3" />
      <circle cx={n(r * 0.46)} cy={n(-r * 0.52)} r={n(r * 0.1)} fill={art('moon2')} opacity=".3" />
    </g>
  );
}

/** A soft cloud, about 90 wide and 34 high, centred on (0, 0). */
function Cloud({ x = 0, y = 0, s = 1 }: { x?: number; y?: number; s?: number }) {
  return (
    <g transform={place(x, y, s)}>
      <path
        d="M-44 14C-52 14 -52 0 -42 -1C-42 -12 -26 -14 -22 -6C-18 -20 4 -20 6 -6C12 -14 28 -10 28 2C40 0 46 12 36 14Z"
        fill={art('cloud2')}
      />
      <path
        d="M-34 8C-30 2 -24 2 -20 8M-6 6C-2 0 6 0 10 6"
        stroke={art('cloud')}
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
      />
    </g>
  );
}

/** The jade rabbit (tho ngoc) sitting, facing right, about 64 wide and 70 high, its feet on (0, 0). */
function JadeRabbit({ x = 0, y = 0, s = 1 }: { x?: number; y?: number; s?: number }) {
  const body = { fill: art('jade'), stroke: art('jade2'), strokeWidth: 1.8 } as const;
  return (
    <g transform={place(x, y, s)} data-motif="jade-rabbit">
      <circle cx="-24" cy="-14" r="8" {...body} />
      <ellipse cx="-4" cy="-18" rx="24" ry="19" {...body} />
      <ellipse cx="-12" cy="-10" rx="13" ry="10" fill={art('jade2')} opacity=".45" />
      <ellipse cx="13" cy="-46" rx="5" ry="17" transform="rotate(-10 13 -46)" {...body} />
      <ellipse
        cx="13"
        cy="-46"
        rx="2.2"
        ry="12"
        transform="rotate(-10 13 -46)"
        fill={art('blush')}
      />
      <ellipse cx="25" cy="-44" rx="5" ry="16" transform="rotate(12 25 -44)" {...body} />
      <ellipse
        cx="25"
        cy="-44"
        rx="2.2"
        ry="11"
        transform="rotate(12 25 -44)"
        fill={art('blush')}
      />
      <ellipse cx="18" cy="-28" rx="14" ry="12.5" {...body} />
      <circle cx="24" cy="-30" r="2.3" fill={art('ink')} />
      <circle cx="31" cy="-25" r="2" fill={art('blush')} />
      <path d="M32 -22C30 -20 27 -20 26 -21" stroke={art('jade2')} strokeWidth="1.4" fill="none" />
      <path d="M8 -12C14 -8 20 -4 22 0L10 0Z" {...body} />
      <ellipse
        cx="-6"
        cy="-1"
        rx="14"
        ry="3.6"
        fill={art('jade')}
        stroke={art('jade2')}
        strokeWidth="1.6"
      />
    </g>
  );
}

/** A round mooncake seen from above (`cut` shows a half with its filling and yolk), about 44 wide. */
function Mooncake({
  x = 0,
  y = 0,
  s = 1,
  cut = false,
}: {
  x?: number;
  y?: number;
  s?: number;
  cut?: boolean;
}) {
  return (
    <g transform={place(x, y, s)} data-motif="mooncakes">
      <ellipse cy="6" rx="22" ry="6" fill={art('ink')} opacity=".1" />
      {cut ? (
        <>
          <ellipse rx="22" ry="15" fill={art('crust')} />
          <ellipse rx="17" ry="10.5" fill={art('filling')} />
          <circle r="6.4" fill={art('yellow2')} />
          <circle cx="-2" cy="-2" r="2.2" fill={art('yellow3')} />
        </>
      ) : (
        <>
          <ellipse rx="22" ry="15" fill={art('crust')} />
          <ellipse rx="17" ry="10.5" fill={art('crust2')} />
          {[0, 1, 2, 3].map((index) => (
            <ellipse
              key={index}
              cx={n(Math.cos((index * Math.PI) / 2) * 8)}
              cy={n(Math.sin((index * Math.PI) / 2) * 5)}
              rx="4.6"
              ry="3"
              fill={art('crust')}
            />
          ))}
          <circle r="2.8" fill={art('crust')} />
          <path
            d="M-17 0C-12 -9 12 -9 17 0"
            stroke={art('crust')}
            strokeWidth="1.2"
            fill="none"
            opacity=".7"
          />
        </>
      )}
    </g>
  );
}

/** A banyan tree (cay da) with hanging roots, about 100 wide and 120 high, its foot on (0, 0). */
function Banyan({ x = 0, y = 0, s = 1 }: { x?: number; y?: number; s?: number }) {
  return (
    <g transform={place(x, y, s)}>
      <path d="M-7 0C-7 -18 -12 -32 -17 -50L17 -50C12 -32 7 -18 7 0Z" fill={art('trunk')} />
      <circle cy="-70" r="32" fill={art('banyan')} />
      <circle cx="-30" cy="-58" r="22" fill={art('banyan2')} />
      <circle cx="30" cy="-60" r="22" fill={art('banyan2')} />
      <circle cx="-12" cy="-90" r="19" fill={art('banyan2')} />
      <circle cx="16" cy="-92" r="17" fill={art('banyan')} />
      <path
        d="M-38 -44L-40 -14M-24 -40L-24 -8M24 -42L26 -10M38 -44L40 -16"
        stroke={art('trunk')}
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
      />
    </g>
  );
}

/** Chu Cuoi sitting by the banyan (about 30 high, feet on (0, 0)). */
function ChuCuoi({ x = 0, y = 0, s = 1 }: { x?: number; y?: number; s?: number }) {
  return (
    <g transform={place(x, y, s)} data-motif="chi-hang-chu-cuoi">
      <path d="M-9 0C-9 -12 -6 -18 0 -18C6 -18 9 -12 9 0Z" fill={art('orange')} />
      <circle cy="-23" r="5.4" fill={art('skin')} />
      <path d="M-9 -26L0 -36L9 -26C4 -28 -4 -28 -9 -26Z" fill={art('hat')} />
    </g>
  );
}

/** Chi Hang floating up beside the moon in long flowing robes (about 54 high). */
function ChiHang({ x = 0, y = 0, s = 1 }: { x?: number; y?: number; s?: number }) {
  return (
    <g transform={place(x, y, s)} data-motif="chi-hang-chu-cuoi">
      <path d="M-16 20C-8 14 8 14 16 20C10 24 -10 24 -16 20Z" fill={art('pink')} opacity=".9" />
      <path d="M-8 -6C-14 6 -12 20 -6 28C0 22 2 10 8 -6Z" fill={art('lilac')} />
      <path
        d="M-8 -6C-24 -2 -30 8 -34 14M8 -6C24 -4 32 6 38 10"
        stroke={art('pink')}
        strokeWidth="3.4"
        fill="none"
        strokeLinecap="round"
      />
      <circle cy="-14" r="6" fill={art('skin')} />
      <circle cx="-3" cy="-21" r="4" fill={art('ink')} />
      <path d="M-6 -14C-6 -22 6 -22 6 -14C3 -17 -3 -17 -6 -14Z" fill={art('ink')} />
    </g>
  );
}

// ------------------------------------------------------------------------------------------ lion dance drum

/** A lion-dance drum (trong): a red barrel with studs and two sticks, about 70 wide. */
function Drum({ x = 0, y = 0, s = 1 }: { x?: number; y?: number; s?: number }) {
  return (
    <g transform={place(x, y, s)}>
      <path d="M-30 -44C-34 -20 -34 0 -30 22L30 22C34 0 34 -20 30 -44Z" fill={art('red')} />
      <ellipse cy="-44" rx="30" ry="9" fill={art('filling')} stroke={art('red3')} strokeWidth="3" />
      {[-24, -12, 0, 12, 24].map((px) => (
        <circle key={px} cx={px} cy="-30" r="2.2" fill={art('yellow')} />
      ))}
      <path d="M-30 -4L30 -4" stroke={art('yellow2')} strokeWidth="3" />
      <path
        d="M-16 -66L-4 -48M16 -66L4 -48"
        stroke={art('trunk')}
        strokeWidth="3.4"
        strokeLinecap="round"
      />
      <path
        d="M-26 22L-34 40M26 22L34 40"
        stroke={art('red3')}
        strokeWidth="4"
        strokeLinecap="round"
      />
    </g>
  );
}

// ------------------------------------------------------------------------------------------ header rail

/** Star, carp and spinning lanterns hanging on a cord (a few small stars between them). */
export function AutumnRail() {
  const hang = (drop: number, node: ReactNode) => (
    <Hang width={64} height={92} stringTo={drop} stringColor="cord">
      {node}
    </Hang>
  );
  const cells: RailCell[] = [
    { node: hang(26, <StarLantern x={32} y={52} s={0.9} />) },
    {
      node: hang(18, <CarpLantern x={32} y={36} s={0.78} r={-8} c="orange" c2="orange2" />),
      hide: 'narrow',
    },
    { node: hang(22, <SpinningLantern x={32} y={44} s={0.82} />), hide: 'medium' },
    { node: hang(28, <StarLantern x={32} y={54} s={0.88} c="green" c2="green2" />) },
    {
      node: hang(14, <CarpLantern x={32} y={32} s={0.78} r={7} c="red2" c2="orange2" />),
      hide: 'medium',
    },
    { node: hang(22, <SpinningLantern x={32} y={44} s={0.82} />), hide: 'narrow' },
    {
      node: hang(24, <StarLantern x={32} y={52} s={0.9} c="orange" c2="orange2" />),
      hide: 'medium',
    },
    {
      node: hang(16, <CarpLantern x={32} y={34} s={0.78} r={-6} c="red" c2="red2" />),
      hide: 'narrow',
    },
    { node: hang(28, <StarLantern x={32} y={54} s={0.9} />) },
  ];
  return (
    <>
      <RailCord color="cord" sag={5} />
      <RailRow cells={cells} height={0.92} />
    </>
  );
}

// ------------------------------------------------------------------------------------------ corner

/** Clouds, a jade rabbit, mooncakes and a star lantern in the top-left corner (232 x 112). */
export function AutumnCorner({ className }: ArtProps) {
  return (
    <ArtSvg viewBox="0 0 232 112" className={className} motif="jade-rabbit mooncakes star-lantern">
      <Cloud x={52} y={64} s={1.5} />
      <Cloud x={150} y={78} s={1} />
      <JadeRabbit x={56} y={62} s={0.95} />
      <Mooncake x={112} y={58} s={0.8} />
      <Mooncake x={140} y={66} s={0.72} cut />
      <g transform="translate(190 0)">
        <path d="M0 0L0 28" stroke={art('cord')} strokeWidth="1.4" />
        <StarLantern x={0} y={52} s={0.78} />
      </g>
      <Sparkle fill="yellow" x={20} y={22} r={6} />
      <Sparkle fill="yellow" x={96} y={20} r={5} />
      <Sparkle fill="yellow3" x={160} y={24} r={4} />
    </ArtSvg>
  );
}

// ------------------------------------------------------------------------------------------ logo and divider

/** The full moon with a cloud and a star beside the wordmark (56 x 48). */
export function AutumnLogo({ className }: ArtProps) {
  return (
    <ArtSvg viewBox="0 0 56 48" className={className} motif="full-moon">
      <MoonDisc x={26} y={22} r={16} />
      <Cloud x={34} y={36} s={0.62} />
      <Star fill="yellow" x={48} y={8} r={5} />
    </ArtSvg>
  );
}

/** Divider centrepiece: the moon between two star lanterns (200 x 32). */
export function AutumnDividerArt({ className }: ArtProps) {
  return (
    <ArtSvg viewBox="0 0 200 32" className={className} motif="full-moon star-lantern">
      <g transform="translate(100 16)">
        <circle r="13" fill={art('moon')} stroke={art('moon2')} strokeWidth="1.6" />
        <circle cx="-4" cy="3" r="3" fill={art('moon2')} opacity=".35" />
        <circle cx="4" cy="-3" r="1.8" fill={art('moon2')} opacity=".3" />
      </g>
      <StarLantern x={62} y={14} s={0.34} />
      <StarLantern x={138} y={14} s={0.34} c="orange" c2="orange2" />
      <Sparkle fill="yellow" x={24} y={14} r={5} />
      <Sparkle fill="yellow" x={176} y={14} r={5} />
      <Sparkle fill="yellow3" x={40} y={22} r={3} />
      <Sparkle fill="yellow3" x={160} y={8} r={3} />
    </ArtSvg>
  );
}

// ------------------------------------------------------------------------------------------ footer scene

/** A star lantern on a stick with a little cart base, standing on the ground (about 70 wide and 150 high). */
function StandLantern({ c, c2, kind }: { c: string; c2: string; kind: 'star' | 'carp' }) {
  return (
    <g>
      <path d="M0 40L0 130" stroke={art('trunk')} strokeWidth="3.6" strokeLinecap="round" />
      {kind === 'star' ? (
        <StarLantern y={10} s={1.1} c={c} c2={c2} />
      ) : (
        <CarpLantern y={18} s={1.1} c={c} c2={c2} />
      )}
      <path d="M-16 130L16 130" stroke={art('trunk')} strokeWidth="3.4" strokeLinecap="round" />
      <circle cx="-14" cy="134" r="5" fill={art('red3')} />
      <circle cx="14" cy="134" r="5" fill={art('red3')} />
    </g>
  );
}

const SPARKLES: ReadonlyArray<readonly [number, number, number]> = [
  [300, 46, 7],
  [420, 24, 5],
  [560, 40, 6],
  [880, 28, 5],
  [1010, 50, 7],
  [1150, 30, 5],
  [236, 112, 5],
  [1236, 100, 6],
];

/**
 * The footer scene (1440 x 300): the full moon in the middle with the banyan, Chu Cuoi at its foot and Chi Hang
 * floating beside it, the jade rabbit and a plate of mooncakes next to it, then lanterns on sticks, a spinning lantern
 * and, in the wings, the lion dance with its drum. The middle 400 units (moon, banyan, rabbit, mooncakes) are complete
 * for a phone; the lanterns and the lion show from a tablet up.
 */
export function AutumnScene({ className, part, split }: SceneProps) {
  return (
    <ArtSvg
      {...sceneView(part, split)}
      className={className}
      motif="lion-dance ong-dia drum-cymbals star-lantern carp-lantern spinning-lantern full-moon chi-hang-chu-cuoi jade-rabbit mooncakes"
    >
      <path
        d="M0 218C140 200 260 210 400 226C540 242 660 208 800 212C940 216 1060 240 1200 224C1300 212 1380 208 1440 216V300H0Z"
        fill={art('cream2')}
      />
      <path
        d="M0 250C150 232 270 244 410 256C550 268 670 240 810 244C950 248 1070 268 1210 254C1310 244 1390 240 1440 246V300H0Z"
        fill={art('cream')}
      />
      {SPARKLES.map(([x, y, r]) => (
        <Sparkle key={x} fill={x % 2 === 0 ? 'yellow' : 'yellow3'} x={x} y={y} r={r} />
      ))}
      <MoonDisc x={720} y={102} r={80} />
      <Cloud x={618} y={176} s={1.3} />
      <Cloud x={826} y={170} s={1.1} />
      <Banyan x={714} y={176} s={0.86} />
      <ChuCuoi x={676} y={178} s={1.5} />
      <ChiHang x={792} y={96} s={0.95} />
      <JadeRabbit x={574} y={186} s={1.05} />
      <g transform="translate(868 178)">
        <Mooncake x={0} y={0} s={1} />
        <Mooncake x={34} y={-2} s={0.9} cut />
        <Mooncake x={16} y={-12} s={0.86} />
      </g>
      <g transform="translate(474 126)">
        <StandLantern kind="carp" c="orange" c2="orange2" />
      </g>
      <g transform="translate(966 120)">
        <StandLantern kind="star" c="red" c2="red2" />
      </g>
      <SpinningLantern x={1060} y={170} s={1.5} />
      <g transform="translate(1262 120)">
        <StandLantern kind="star" c="green" c2="green2" />
      </g>
      <LionDance x={64} y={252} s={0.84} />
      <OngDia x={308} y={252} s={0.72} />
      <Drum x={392} y={228} s={0.9} />
      <Cymbals x={398} y={252} s={0.56} />
    </ArtSvg>
  );
}

/** A rising star lantern (about 36 wide): the color follows the index. */
export function AutumnLanternPiece({ index }: { index: number }) {
  const colors = [
    ['red', 'red2'],
    ['orange', 'orange2'],
    ['green', 'green2'],
    ['yellow', 'yellow2'],
  ] as const;
  const [c, c2] = colors[index % colors.length]!;
  return (
    <svg className="ls-fx-site-glyph" viewBox="-30 -38 60 82" aria-hidden="true" focusable="false">
      <StarLantern c={c} c2={c2} />
    </svg>
  );
}
