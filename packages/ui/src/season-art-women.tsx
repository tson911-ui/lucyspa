import type { ReactNode } from 'react';
import { ArtSvg, art, sceneView, type ArtProps, type SceneProps } from './season-art-kit';
import {
  Bow,
  GiftBox,
  Hang,
  Heart,
  Leaf,
  Lotus,
  LotusLeaf,
  RailCord,
  RailRow,
  Rose,
  Sparkle,
  place,
  type RailCell,
} from './season-art-shapes';

// The two women's-day kits (docs/UXUI_REDESIGN_S6_PLAN.md section 4.1): International Women's Day (8/3, orchids and
// tulips in violet) and Vietnamese Women's Day (20/10, lotus in magenta). Both draw flower bouquets, ao dai, the non la
// and gift boxes; the variant picks the flowers. Palette keys are the same in both kits. No yellow anywhere.

export type WomenVariant = 'womens-day' | 'vn-womens-day';

// ------------------------------------------------------------------------------------------ flowers

/** An orchid seen from the front, about 44 wide: petals around a small lip. */
function Orchid({
  x = 0,
  y = 0,
  s = 1,
  r = 0,
}: {
  x?: number;
  y?: number;
  s?: number;
  r?: number;
}) {
  return (
    <g transform={place(x, y, s, r)}>
      <ellipse cy="-13" rx="8" ry="13" fill={art('bloom2')} />
      <ellipse
        cx="-14"
        cy="-3"
        rx="14"
        ry="10.5"
        transform="rotate(-18 -14 -3)"
        fill={art('bloom')}
      />
      <ellipse cx="14" cy="-3" rx="14" ry="10.5" transform="rotate(18 14 -3)" fill={art('bloom')} />
      <ellipse cx="-9" cy="11" rx="6.5" ry="10" transform="rotate(32 -9 11)" fill={art('bloom2')} />
      <ellipse cx="9" cy="11" rx="6.5" ry="10" transform="rotate(-32 9 11)" fill={art('bloom2')} />
      <ellipse cy="5" rx="5.4" ry="7" fill={art('bloom3')} />
      <circle cy="-1" r="2.6" fill={art('pink2')} />
    </g>
  );
}

/** A tulip on a short stem with two leaves, 28 wide and 90 high, its foot at (0, 0). */
function Tulip({
  x = 0,
  y = 0,
  s = 1,
  c = 'rose',
  c2 = 'rose2',
}: {
  x?: number;
  y?: number;
  s?: number;
  c?: string;
  c2?: string;
}) {
  return (
    <g transform={place(x, y, s)}>
      <path d="M0 0C0 -20 0 -40 0 -58" stroke={art('leaf2')} strokeWidth="3.4" fill="none" />
      <path d="M0 -4C-16 -14 -22 -34 -20 -50C-8 -42 0 -26 0 -4Z" fill={art('leaf')} />
      <path d="M0 -4C14 -12 20 -30 18 -44C8 -38 0 -24 0 -4Z" fill={art('leaf2')} />
      <path
        d="M-13 -80C-13 -66 -8 -54 0 -54C8 -54 13 -66 13 -80L6.5 -72L0 -84L-6.5 -72Z"
        fill={art(c)}
      />
      <path d="M-6.5 -72L0 -84L6.5 -72C6 -62 3 -56 0 -56C-3 -56 -6 -62 -6.5 -72Z" fill={art(c2)} />
    </g>
  );
}

/** A lotus bud on a stem, 18 wide, resting on (0, 0) and 40 high. */
function LotusBud({ x = 0, y = 0, s = 1 }: { x?: number; y?: number; s?: number }) {
  return (
    <g transform={place(x, y, s)}>
      <path d="M0 0C-10 -6 -11 -22 0 -40C11 -22 10 -6 0 0Z" fill={art('bloom')} />
      <path d="M0 0C-4 -8 -4 -22 0 -40C4 -22 4 -8 0 0Z" fill={art('bloom2')} opacity=".7" />
      <path d="M-9 -4C-14 -8 -15 -16 -12 -22C-8 -16 -6 -10 -9 -4Z" fill={art('leaf')} />
    </g>
  );
}

/** The non la (conical hat) seen from the front, about 72 wide and 30 high, resting on (0, 0). */
function NonLa({ x = 0, y = 0, s = 1, r = 0 }: { x?: number; y?: number; s?: number; r?: number }) {
  return (
    <g transform={place(x, y, s, r)} data-motif="non-la">
      <path d="M-36 0C-22 -9 -9 -22 0 -30C9 -22 22 -9 36 0C20 7 -20 7 -36 0Z" fill={art('hat')} />
      <path
        d="M-27 -3C-16 -9 -6 -18 0 -24M-17 -1C-9 -6 -3 -13 0 -17M27 -3C16 -9 6 -18 0 -24M17 -1C9 -6 3 -13 0 -17"
        stroke={art('hat2')}
        strokeWidth="1.4"
        fill="none"
      />
      <path d="M-36 0C-20 7 20 7 36 0" stroke={art('hat2')} strokeWidth="2" fill="none" />
      <circle cy="-30" r="2.6" fill={art('hat2')} />
      <path
        d="M-30 1L-24 14M30 1L24 14"
        stroke={art('ribbon')}
        strokeWidth="2.6"
        strokeLinecap="round"
      />
    </g>
  );
}

// ------------------------------------------------------------------------------------------ header rail

/** A flower or a gift hanging from a cord: orchids and gifts for 8/3, lotus lanterns, roses and gifts for 20/10. */
export function WomenRail({ variant }: { variant: WomenVariant }) {
  const hang = (drop: number, children: ReactNode) => (
    <Hang width={56} height={72} stringTo={drop} stringColor="string">
      {children}
    </Hang>
  );
  const bloom = (drop: number) =>
    variant === 'womens-day' ? (
      <Orchid x={28} y={drop + 22} s={0.92} />
    ) : (
      <Lotus c="bloom" c2="bloom2" tip="pink2" x={28} y={drop + 4} s={0.78} r={180} />
    );
  const rose = (drop: number) => (
    <>
      <Leaf fill="leaf" x={26} y={drop + 20} r={150} s={0.7} />
      <Leaf fill="leaf2" x={30} y={drop + 20} r={30} s={0.7} />
      <Rose x={28} y={drop + 16} s={0.9} c="rose" c2="rose2" c3="rose3" />
    </>
  );
  const gift = (drop: number, body: string) => (
    <GiftBox x={14} y={drop + 8} w={28} h={24} body={body} band="white" bow="ribbon" />
  );
  const hat = (drop: number) => <NonLa x={28} y={drop + 22} s={0.7} />;
  const cells: RailCell[] = [
    { node: hang(18, bloom(18)) },
    { node: hang(26, gift(26, 'bloom2')), hide: 'narrow' },
    { node: hang(14, rose(14)), hide: 'medium' },
    { node: hang(22, hat(22)) },
    { node: hang(16, bloom(16)), hide: 'medium' },
    { node: hang(28, gift(28, 'rose2')), hide: 'narrow' },
    { node: hang(12, rose(12)), hide: 'medium' },
    { node: hang(20, hat(20)), hide: 'narrow' },
    { node: hang(18, bloom(18)) },
  ];
  return (
    <>
      <RailCord color="leaf2" sag={5} />
      <RailRow cells={cells} height={0.84} />
    </>
  );
}

// ------------------------------------------------------------------------------------------ corner

/** A spray of flowers with leaves and a bow in the top-left corner (232 x 112). */
export function WomenCorner({ className, variant }: ArtProps & { variant: WomenVariant }) {
  return (
    <ArtSvg viewBox="0 0 232 112" className={className} motif="bouquets">
      <path
        d="M-4 12C40 20 74 30 108 52C136 70 170 72 216 64"
        stroke={art('leaf2')}
        strokeWidth="3.2"
        fill="none"
        strokeLinecap="round"
      />
      {(
        [
          [40, 28, 25, 'leaf'],
          [70, 44, 70, 'leaf2'],
          [100, 50, 20, 'leaf'],
          [134, 68, 70, 'leaf2'],
          [166, 72, 10, 'leaf'],
        ] as const
      ).map(([x, y, r, c]) => (
        <Leaf key={x} fill={c} x={x} y={y} r={r} s={0.95} />
      ))}
      {variant === 'womens-day' ? (
        <>
          <Orchid x={34} y={32} s={1.2} r={-10} />
          <Orchid x={88} y={52} s={0.95} r={8} />
          <Rose x={138} y={66} s={0.9} />
          <Orchid x={186} y={62} s={0.62} r={14} />
        </>
      ) : (
        <>
          <Lotus c="bloom" c2="bloom2" tip="pink2" x={36} y={52} s={1.05} />
          <Lotus c="bloom" c2="bloom2" tip="pink2" x={96} y={66} s={0.72} r={-8} />
          <Rose x={142} y={68} s={0.85} />
          <LotusBud x={186} y={78} s={0.8} />
        </>
      )}
      <Heart fill="pink" x={200} y={28} s={0.45} r={14} />
      <Sparkle fill="pink" x={166} y={24} r={6} />
      <Sparkle fill="bloom2" x={218} y={52} r={5} />
      <Bow c="ribbon" c2="bloom3" x={10} y={58} s={0.8} r={-20} />
    </ArtSvg>
  );
}

// ------------------------------------------------------------------------------------------ logo and divider

/** Beside the wordmark: a small bouquet (8/3) or a lotus bud (20/10) (56 x 48). */
export function WomenLogo({ className, variant }: ArtProps & { variant: WomenVariant }) {
  return (
    <ArtSvg viewBox="0 0 56 48" className={className} motif="bouquets">
      {variant === 'womens-day' ? (
        <>
          <Tulip x={16} y={46} s={0.5} />
          <Tulip x={40} y={46} s={0.5} c="bloom" c2="bloom2" />
          <Orchid x={28} y={16} s={0.62} />
          <Bow c="ribbon" c2="bloom3" x={28} y={42} s={0.42} />
        </>
      ) : (
        <>
          <LotusBud x={14} y={42} s={0.78} />
          <LotusBud x={42} y={44} s={0.64} />
          <Lotus c="bloom" c2="bloom2" tip="pink2" x={28} y={40} s={0.7} />
        </>
      )}
    </ArtSvg>
  );
}

/** Divider centrepiece: flowers around a heart (8/3), or a lotus between two buds and leaves (20/10) (200 x 32). */
export function WomenDividerArt({ className, variant }: ArtProps & { variant: WomenVariant }) {
  return (
    <ArtSvg viewBox="0 0 200 32" className={className} motif="bouquets">
      {variant === 'womens-day' ? (
        <>
          <Tulip x={56} y={32} s={0.36} />
          <Tulip x={144} y={32} s={0.36} c="bloom" c2="bloom2" />
          <Orchid x={78} y={16} s={0.4} />
          <Orchid x={122} y={16} s={0.4} />
          <Heart fill="rose" x={100} y={16} s={0.6} />
        </>
      ) : (
        <>
          <LotusLeaf fill="leaf" rib="leaf2" rx={22} x={64} y={27} />
          <LotusLeaf fill="leaf" rib="leaf2" rx={22} x={136} y={27} />
          <LotusBud x={72} y={26} s={0.4} />
          <LotusBud x={128} y={26} s={0.4} />
          <Lotus c="bloom" c2="bloom2" tip="pink2" x={100} y={29} s={0.64} />
        </>
      )}
      <Sparkle fill="pink" x={22} y={14} r={5} />
      <Sparkle fill="pink" x={178} y={14} r={5} />
    </ArtSvg>
  );
}

// ------------------------------------------------------------------------------------------ footer scene

/**
 * A woman in an ao dai, stylised and faceless, feet at (0, 0) and about 190 high: a fitted tunic with a high collar and
 * a split into two long panels over loose trousers, a bun, long sleeves. `hat` puts a non la on her head; `holds`
 * gives her a bouquet in the crook of the arm.
 */
function AoDai({
  x,
  y,
  s = 1,
  flip = false,
  hat = false,
  holds = false,
  dress = 'ao',
  trim = 'ao2',
}: {
  x: number;
  y: number;
  s?: number;
  flip?: boolean;
  hat?: boolean;
  holds?: boolean;
  dress?: string;
  trim?: string;
}) {
  return (
    <g transform={`${place(x, y, s)}${flip ? ' scale(-1 1)' : ''}`} data-motif="ao-dai">
      <path
        d="M-12 -92C-18 -56 -22 -22 -24 0L-3 0L0 -64L3 0L24 0C22 -22 18 -56 12 -92Z"
        fill={art('trousers')}
      />
      <path d="M-24 0L-3 0M3 0L24 0" stroke={art('string')} strokeWidth="3" strokeLinecap="round" />
      <path
        d="M-12 -152C-15 -128 -12 -112 -15 -94C-17 -70 -22 -44 -26 -26C-12 -20 4 -22 12 -30L8 -94C12 -112 12 -128 12 -152Z"
        fill={art(dress)}
      />
      <path
        d="M12 -152C12 -128 12 -112 8 -94L12 -30C24 -34 28 -50 26 -62C20 -80 20 -108 12 -152Z"
        fill={art(dress)}
        opacity=".82"
      />
      <path d="M-15 -94C-6 -90 6 -90 15 -94" stroke={art(trim)} strokeWidth="2.4" fill="none" />
      {[
        [-5, -128],
        [4, -112],
        [-6, -96],
        [-9, -66],
        [2, -52],
        [-4, -38],
      ].map(([px, py]) => (
        <circle key={`${px}-${py}`} cx={px} cy={py} r="2.4" fill={art(trim)} />
      ))}
      <rect x="-3.4" y="-164" width="6.8" height="14" rx="3" fill={art('skin')} />
      <path d="M-5 -152L0 -143L5 -152" fill={art(trim)} />
      <path
        d={holds ? 'M-11 -146C-26 -128 -30 -108 -22 -92' : 'M-11 -146C-24 -124 -26 -100 -22 -86'}
        stroke={art(dress)}
        strokeWidth="7"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d={holds ? 'M11 -146C26 -132 24 -112 6 -108' : 'M11 -146C24 -124 26 -100 22 -86'}
        stroke={art(dress)}
        strokeWidth="7"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="-22" cy={holds ? -90 : -83} r="4" fill={art('skin')} />
      {!holds ? <circle cx="22" cy="-83" r="4" fill={art('skin')} /> : null}
      <circle cy="-178" r="14" fill={art('skin')} />
      <path d="M-14 -180C-14 -196 14 -196 14 -180C10 -188 -10 -188 -14 -180Z" fill={art('ink')} />
      <circle cx="12" cy="-186" r="8" fill={art('ink')} />
      {hat ? (
        <g>
          <NonLa y={-186} s={1.1} />
        </g>
      ) : (
        <Rose x={-8} y={-190} s={0.4} />
      )}
      {holds ? (
        <g transform="translate(-2 -102) scale(.5)">
          <Rose x={-12} y={-24} s={1.1} />
          <Rose x={14} y={-22} s={1.1} c="bloom" c2="bloom2" c3="bloom3" />
          <Rose x={0} y={-8} s={1.1} c2="pink" />
          <path d="M-22 -2L22 -2L8 36L-8 36Z" fill={art('pink2')} />
        </g>
      ) : null}
    </g>
  );
}

/** A wrapped bouquet for the middle of the scene: flowers on top, paper cone, bow (150 x 200, tip at the bottom). */
function Bouquet({ variant }: { variant: WomenVariant }) {
  return (
    <g data-motif="bouquets">
      <Leaf fill="leaf" x={-6} y={-34} r={-155} s={1.5} />
      <Leaf fill="leaf2" x={6} y={-34} r={-25} s={1.5} />
      {variant === 'womens-day' ? (
        <>
          <Tulip x={-32} y={-26} s={0.9} />
          <Tulip x={34} y={-28} s={0.9} c="bloom" c2="bloom2" />
          <Orchid x={0} y={-104} s={1.3} />
          <Orchid x={-42} y={-72} s={1.05} r={-14} />
          <Orchid x={42} y={-72} s={1.05} r={14} />
          <Rose x={-18} y={-50} s={1.05} />
          <Rose x={20} y={-48} s={1.05} c2="pink" />
        </>
      ) : (
        <>
          <LotusLeaf fill="leaf" rib="leaf2" rx={40} x={-46} y={-40} r={-14} />
          <LotusLeaf fill="leaf" rib="leaf2" rx={40} x={46} y={-40} r={14} />
          <LotusBud x={-54} y={-48} s={1.3} />
          <LotusBud x={56} y={-52} s={1.2} />
          <Lotus c="bloom" c2="bloom2" tip="pink2" x={0} y={-52} s={1.5} />
          <Rose x={-22} y={-30} s={1} />
          <Rose x={24} y={-28} s={1} c2="pink" />
        </>
      )}
      <path d="M-50 -24L50 -24L16 62L-16 62Z" fill={art('pink2')} />
      <path
        d="M-50 -24L0 -6L50 -24M-34 20L0 32L34 20"
        stroke={art('pink')}
        strokeWidth="2.2"
        fill="none"
      />
      <Bow c="ribbon" c2="bloom3" x={0} y={-4} s={0.95} />
    </g>
  );
}

function FlowerBed({ variant, flip = false }: { variant: WomenVariant; flip?: boolean }) {
  return (
    <g transform={flip ? 'scale(-1 1)' : undefined}>
      {variant === 'womens-day' ? (
        <>
          <Tulip x={-44} y={0} s={0.8} />
          <Tulip x={-16} y={4} s={0.95} c="bloom" c2="bloom2" />
          <Tulip x={14} y={0} s={0.8} />
          <Tulip x={42} y={5} s={0.9} c="bloom" c2="bloom2" />
        </>
      ) : (
        <>
          <LotusLeaf fill="leaf" rib="leaf2" rx={34} x={-8} y={-4} />
          <LotusBud x={-30} y={-6} s={1.1} />
          <Lotus c="bloom" c2="bloom2" tip="pink2" x={8} y={-4} s={0.9} />
          <LotusBud x={34} y={-4} s={0.95} />
        </>
      )}
    </g>
  );
}

const STARS: ReadonlyArray<readonly [number, number, number]> = [
  [330, 40, 7],
  [482, 70, 5],
  [900, 52, 6],
  [1010, 30, 5],
  [1130, 76, 7],
  [250, 96, 5],
];

/**
 * The footer scene (1440 x 300): a big wrapped bouquet in the middle with gift boxes and a non la at its foot, two
 * women in ao dai at the sides (one in a non la, one holding flowers) and flower beds beyond them. The middle 400
 * units are a complete composition for a phone; the women and beds show from a tablet up.
 */
export function WomenScene({
  className,
  part,
  split,
  variant,
}: SceneProps & { variant: WomenVariant }) {
  return (
    <ArtSvg
      {...sceneView(part, split)}
      className={className}
      motif="bouquets ao-dai non-la gift-boxes"
    >
      <path
        d="M0 218C140 200 260 210 400 226C540 242 660 208 800 212C940 216 1060 240 1200 224C1300 212 1380 208 1440 216V300H0Z"
        fill={art('cream2')}
      />
      <path
        d="M0 250C150 232 270 244 410 256C550 268 670 240 810 244C950 248 1070 268 1210 254C1310 244 1390 240 1440 246V300H0Z"
        fill={art('cream')}
      />
      {STARS.map(([x, y, r]) => (
        <Sparkle key={x} fill={x % 2 === 0 ? 'pink' : 'bloom2'} x={x} y={y} r={r} />
      ))}
      <g transform="translate(150 266) scale(1.2)">
        <FlowerBed variant={variant} />
      </g>
      <g transform="translate(1290 266) scale(1.2)">
        <FlowerBed variant={variant} flip />
      </g>
      <AoDai x={404} y={262} s={1} hat />
      <AoDai x={1036} y={262} s={1} flip holds dress="bloom" trim="pink2" />
      <GiftBox x={560} y={144} w={46} h={40} body="bloom2" band="white" bow="ribbon" />
      <GiftBox x={826} y={166} w={40} h={34} body="rose2" band="white" bow="ribbon" />
      <g transform="translate(708 112)">
        <Bouquet variant={variant} />
      </g>
      <NonLa x={646} y={168} s={0.85} r={-6} />
      <GiftBox x={778} y={134} w={30} h={26} body="bloom3" band="pink2" bow="ribbon" />
    </ArtSvg>
  );
}

/** A falling petal (one of three tints): a blossom petal for 8/3, a lotus petal for 20/10 (shared shape). */
export function WomenPetal({ index }: { index: number }) {
  const colors = ['bloom2', 'pink', 'rose2'] as const;
  return (
    <svg className="ls-fx-site-glyph" viewBox="-12 -16 24 32" aria-hidden="true" focusable="false">
      <path
        d="M0 14C-10 6 -10 -8 0 -15C10 -8 10 6 0 14Z"
        fill={art(colors[index % colors.length]!)}
      />
      <path
        d="M0 12C-3 4 -3 -6 0 -12"
        stroke={art('white')}
        strokeWidth="1.2"
        fill="none"
        opacity=".5"
      />
    </svg>
  );
}
