import { ArtSvg, art, n, type ArtProps } from './season-art-kit';
import {
  Hang,
  Leaf,
  Lotus,
  LotusLeaf,
  RailCord,
  RailRow,
  Sparkle,
  Star,
  place,
  type RailCell,
} from './season-art-shapes';
import { starPoints } from './season-ornaments';

// The two flag-day kits (docs/UXUI_REDESIGN_S6_PLAN.md section 4.1): Reunification and Labour Day (30/4-1/5) and
// National Day (2/9). One drawing set with a variant: red flag-and-star bunting, static fireworks, peace doves and lotus.
// Yellow is allowed in both (Q-S1). The accent stays rose (never danger red); the red here is decoration only.

export type NationalVariant = 'reunification-labour' | 'national-day';

// ------------------------------------------------------------------------------------------ pieces

/** A flag of red with a yellow star, waving, `w` x `h`, its top-left at (0, 0). */
function WavyFlag({
  x = 0,
  y = 0,
  w,
  h,
  r = 0,
}: {
  x?: number;
  y?: number;
  w: number;
  h: number;
  r?: number;
}) {
  const q = h * 0.1;
  return (
    <g transform={place(x, y, 1, r)} data-motif="flag-bunting">
      <path
        d={`M0 0C${n(w * 0.25)} ${n(-q)} ${n(w * 0.5)} ${n(q)} ${w} 0L${w} ${h}C${n(w * 0.75)} ${n(h + q)} ${n(w * 0.25)} ${n(h - q)} 0 ${h}Z`}
        fill={art('red')}
      />
      <path
        d={`M0 ${n(h * 0.5)}C${n(w * 0.25)} ${n(h * 0.5 - q)} ${n(w * 0.5)} ${n(h * 0.5 + q)} ${w} ${n(h * 0.5)}L${w} ${h}C${n(w * 0.75)} ${n(h + q)} ${n(w * 0.25)} ${n(h - q)} 0 ${h}Z`}
        fill={art('red3')}
        opacity=".14"
      />
      <polygon
        points={starPoints(w / 2, h / 2, h * 0.34, h * 0.14)}
        fill={art('yellow')}
        transform={`translate(0 ${n(q * 0.1)})`}
      />
    </g>
  );
}

/** A triangular pennant of bunting with a star, `w` wide, hanging from (0, 0). */
function Pennant({
  x = 0,
  y = 0,
  w = 40,
  r = 0,
  field = 'red',
}: {
  x?: number;
  y?: number;
  w?: number;
  r?: number;
  field?: string;
}) {
  return (
    <g transform={place(x, y, 1, r)} data-motif="flag-bunting">
      <path d={`M${-w / 2} 0L${w / 2} 0L0 ${n(w * 1.15)}Z`} fill={art(field)} />
      <polygon points={starPoints(0, w * 0.34, w * 0.2, w * 0.085)} fill={art('yellow')} />
    </g>
  );
}

/** A static firework burst: rays with a dot at each tip, a shorter second ring, a bright core. `R` is the radius. */
function Firework({
  x = 0,
  y = 0,
  R = 40,
  c = 'yellow',
  c2 = 'red',
}: {
  x?: number;
  y?: number;
  R?: number;
  c?: string;
  c2?: string;
}) {
  const rays = Array.from({ length: 12 }, (_, i) => (i / 12) * Math.PI * 2);
  return (
    <g transform={place(x, y)} data-motif="fireworks">
      {rays.map((a, i) => (
        <g key={i}>
          <path
            d={`M${n(Math.cos(a) * R * 0.3)} ${n(Math.sin(a) * R * 0.3)}L${n(Math.cos(a) * R * 0.86)} ${n(Math.sin(a) * R * 0.86)}`}
            stroke={art(c)}
            strokeWidth="2.6"
            strokeLinecap="round"
          />
          <circle cx={n(Math.cos(a) * R)} cy={n(Math.sin(a) * R)} r="2.6" fill={art(c2)} />
          <circle
            cx={n(Math.cos(a + Math.PI / 12) * R * 0.58)}
            cy={n(Math.sin(a + Math.PI / 12) * R * 0.58)}
            r="2"
            fill={art(c2)}
          />
        </g>
      ))}
      <circle r={n(R * 0.1)} fill={art('yellow3')} />
      <Sparkle fill="yellow3" r={R * 0.18} />
    </g>
  );
}

/** A peace dove in flight carrying an olive sprig, facing right, about 90 wide, centred on (0, 0). */
function Dove({ x = 0, y = 0, s = 1, r = 0 }: { x?: number; y?: number; s?: number; r?: number }) {
  return (
    <g transform={place(x, y, s, r)} data-motif="peace-doves">
      <path d="M-6 -4C-16 -20 -28 -28 -44 -30C-36 -16 -32 -4 -26 6Z" fill={art('dove2')} />
      <path d="M-24 8L-46 14L-44 20L-22 16ZM-24 10L-48 22L-42 26L-20 16Z" fill={art('dove2')} />
      <ellipse
        cx="0"
        cy="6"
        rx="26"
        ry="10"
        transform="rotate(-10)"
        fill={art('dove')}
        stroke={art('dove2')}
        strokeWidth="1.6"
      />
      <circle cx="26" cy="-4" r="8.4" fill={art('dove')} stroke={art('dove2')} strokeWidth="1.6" />
      <path d="M33 -7L43 -4L33 -1Z" fill={art('yellow2')} />
      <circle cx="28" cy="-6" r="1.8" fill={art('ink')} />
      <path
        d="M2 4C-4 -16 -16 -30 -34 -34C-28 -20 -24 -8 -14 6Z"
        fill={art('dove')}
        stroke={art('dove2')}
        strokeWidth="1.6"
      />
      <path
        d="M-8 -6C-14 -14 -20 -20 -26 -22M-4 0C-10 -8 -16 -14 -22 -16"
        stroke={art('dove2')}
        strokeWidth="1.4"
        fill="none"
      />
      <path
        d="M40 -2C46 4 52 6 58 4"
        stroke={art('leaf2')}
        strokeWidth="1.8"
        fill="none"
        strokeLinecap="round"
      />
      <Leaf fill="leaf" x={46} y={5} r={-30} s={0.5} />
      <Leaf fill="leaf" x={52} y={5.4} r={40} s={0.5} />
    </g>
  );
}

/** A flagpole standing on the ground with a waving flag, the foot at (0, 0), the flag 96 wide. */
function FlagPole({ h = 190, flag = 96 }: { h?: number; flag?: number }) {
  return (
    <g>
      <path d={`M0 0L0 ${-h}`} stroke={art('string')} strokeWidth="4" strokeLinecap="round" />
      <circle cy={-h - 4} r="5" fill={art('yellow2')} />
      <WavyFlag x={3} y={-h + 4} w={flag} h={flag * 0.66} />
      <ellipse cy="2" rx="14" ry="4" fill={art('ink')} opacity=".12" />
    </g>
  );
}

/** A lotus pond patch: leaves, a bloom and buds, about 150 wide, the water line on y = 0. */
function LotusPatch({ big = false }: { big?: boolean }) {
  const k = big ? 1.25 : 1;
  return (
    <g transform={`scale(${k})`} data-motif="lotus">
      <LotusLeaf fill="leaf" rib="leaf2" rx={52} x={-34} y={-6} />
      <LotusLeaf fill="leaf2" rib="leaf" rx={44} x={46} y={-4} />
      <path d="M-6 -4L-6 -22M32 -4L32 -30" stroke={art('leaf2')} strokeWidth="2.6" />
      <Lotus c="lotus" c2="lotus3" tip="lotus2" x={-6} y={-18} s={0.96} />
      <Lotus c="lotus2" c2="lotus" tip="white" x={34} y={-26} s={0.7} />
      <path d="M62 -4L62 -26" stroke={art('leaf2')} strokeWidth="2.4" />
      <path d="M62 -26C56 -30 55 -40 62 -50C69 -40 68 -30 62 -26Z" fill={art('lotus')} />
    </g>
  );
}

// ------------------------------------------------------------------------------------------ header rail

/** Flag pennants and stars hanging from a cord across the row (flags with a yellow star on red). */
export function NationalRail() {
  const pennant = (drop: number, w: number, r = 0) => (
    <Hang width={52} height={84} stringTo={0} stringColor="string">
      <Pennant x={26} y={drop} w={w} r={r} />
    </Hang>
  );
  const star = (drop: number, big: boolean) => (
    <Hang width={52} height={84} stringTo={drop + 12} stringColor="string">
      <Star fill="yellow" x={26} y={drop + 22} r={big ? 20 : 16} />
      <Star fill="yellow3" x={26} y={drop + 22} r={big ? 9 : 7} />
    </Hang>
  );
  const cells: RailCell[] = [
    { node: pennant(0, 46, -3) },
    { node: star(6, false), hide: 'narrow' },
    { node: pennant(0, 46, 3), hide: 'medium' },
    { node: star(12, true) },
    { node: pennant(0, 46, -2), hide: 'medium' },
    { node: star(6, false), hide: 'narrow' },
    { node: pennant(0, 46, 3) },
    { node: star(10, true), hide: 'medium' },
    { node: pennant(0, 46, -3), hide: 'narrow' },
  ];
  return (
    <>
      <RailCord color="string" sag={5} />
      <RailRow cells={cells} height={0.86} />
    </>
  );
}

// ------------------------------------------------------------------------------------------ corner

/** A flag on a pole with two firework bursts and sparkles in the top-left corner (232 x 112). */
export function NationalCorner({ className }: ArtProps) {
  return (
    <ArtSvg viewBox="0 0 232 112" className={className} motif="fireworks flag-bunting">
      <Firework x={150} y={46} R={38} c="yellow" c2="red" />
      <Firework x={84} y={34} R={24} c="red2" c2="yellow2" />
      <Firework x={206} y={92} R={16} c="yellow2" c2="red2" />
      <g transform="translate(18 0)">
        <path d="M0 0L0 74" stroke={art('string')} strokeWidth="3.4" strokeLinecap="round" />
        <circle cy="76" r="4" fill={art('yellow2')} />
        <WavyFlag x={2} y={2} w={52} h={36} />
      </g>
      <Sparkle fill="yellow" x={110} y={86} r={6} />
      <Sparkle fill="yellow3" x={40} y={66} r={5} />
    </ArtSvg>
  );
}

// ------------------------------------------------------------------------------------------ logo and divider

/** Beside the wordmark: a flag with a star (30/4-1/5) or a dove (2/9) (56 x 48). */
export function NationalLogo({ className, variant }: ArtProps & { variant: NationalVariant }) {
  return (
    <ArtSvg
      viewBox="0 0 56 48"
      className={className}
      motif={variant === 'national-day' ? 'peace-doves' : 'flag-bunting'}
    >
      {variant === 'national-day' ? (
        <Dove x={26} y={26} s={0.5} r={-6} />
      ) : (
        <g>
          <path d="M12 6L12 46" stroke={art('string')} strokeWidth="2.4" strokeLinecap="round" />
          <WavyFlag x={13} y={7} w={32} h={22} />
        </g>
      )}
    </ArtSvg>
  );
}

/** Divider centrepiece: a star between two bursts (30/4-1/5), or a lotus between two doves (2/9) (200 x 32). */
export function NationalDividerArt({
  className,
  variant,
}: ArtProps & { variant: NationalVariant }) {
  return (
    <ArtSvg viewBox="0 0 200 32" className={className} motif="fireworks lotus peace-doves">
      {variant === 'reunification-labour' ? (
        <>
          <Firework x={56} y={16} R={13} c="red" c2="yellow2" />
          <Firework x={144} y={16} R={13} c="yellow2" c2="red" />
          <Star fill="red" x={100} y={16} r={13} />
          <Star fill="yellow" x={100} y={17} r={7} />
        </>
      ) : (
        <>
          <Dove x={56} y={16} s={0.27} r={-4} />
          <g transform="translate(144 16) scale(-1 1)">
            <Dove s={0.27} r={-4} />
          </g>
          <LotusLeaf fill="leaf" rib="leaf2" rx={18} x={100} y={28} />
          <Lotus c="lotus" c2="lotus3" tip="lotus2" x={100} y={28} s={0.58} />
        </>
      )}
      <Sparkle fill="yellow" x={22} y={14} r={5} />
      <Sparkle fill="yellow" x={178} y={14} r={5} />
    </ArtSvg>
  );
}

// ------------------------------------------------------------------------------------------ footer scene

/** Bunting along the top of the scene: a swagged cord with a pennant at every step. */
function SceneBunting() {
  const spans = 6;
  const span = 1440 / spans;
  const dip = 26;
  const baseY = 8;
  const path = Array.from({ length: spans }, (_, i) => {
    const x1 = i * span;
    return `${i === 0 ? `M0 ${baseY}` : ''}Q${n(x1 + span / 2)} ${baseY + dip * 2} ${n(x1 + span)} ${baseY}`;
  }).join('');
  const flags: Array<[number, number, number]> = [];
  for (let i = 0; i < spans; i += 1) {
    for (let k = 1; k <= 4; k += 1) {
      const f = k / 5;
      const x = i * span + f * span;
      const y = baseY + 4 * dip * f * (1 - f);
      const tilt = (f - 0.5) * 36;
      flags.push([x, y, tilt]);
    }
  }
  return (
    <g>
      <path d={path} stroke={art('string')} strokeWidth="2.4" fill="none" />
      {flags.map(([x, y, tilt], i) => (
        <Pennant key={i} x={x} y={y} w={34} r={tilt} />
      ))}
    </g>
  );
}

/**
 * The footer scene (1440 x 300): bunting across the top, fireworks bursting over the scene, flags on poles, lotus
 * ponds in the corners and peace doves in flight. 30/4-1/5 puts a big firework in the middle with a dove on each side;
 * 2/9 puts a large dove with an olive branch there, between two lotus. The middle 400 units are complete for a phone.
 */
export function NationalScene({ className, variant }: ArtProps & { variant: NationalVariant }) {
  const labour = variant === 'reunification-labour';
  return (
    <ArtSvg
      viewBox="0 0 1440 300"
      preserveAspectRatio="xMidYMax slice"
      className={className}
      motif="flag-bunting fireworks peace-doves lotus"
    >
      <path
        d="M0 218C140 200 260 210 400 226C540 242 660 208 800 212C940 216 1060 240 1200 224C1300 212 1380 208 1440 216V300H0Z"
        fill={art('cream2')}
      />
      <path
        d="M0 250C150 232 270 244 410 256C550 268 670 240 810 244C950 248 1070 268 1210 254C1310 244 1390 240 1440 246V300H0Z"
        fill={art('cream')}
      />
      <SceneBunting />
      <Firework x={196} y={120} R={44} c="yellow" c2="red" />
      <Firework x={484} y={92} R={30} c="red2" c2="yellow2" />
      <Firework x={968} y={84} R={34} c="yellow2" c2="red2" />
      <Firework x={1250} y={116} R={48} c="red" c2="yellow" />
      <g transform="translate(350 266)">
        <FlagPole />
      </g>
      <g transform="translate(1100 266)">
        <FlagPole />
      </g>
      <g transform="translate(150 262)">
        <LotusPatch big />
      </g>
      <g transform="translate(1292 262)">
        <LotusPatch big />
      </g>
      {labour ? (
        <>
          <Firework x={720} y={104} R={70} c="yellow" c2="red" />
          <Dove x={580} y={138} s={0.95} r={-8} />
          <g transform="translate(860 138) scale(-1 1)">
            <Dove s={0.95} r={-8} />
          </g>
        </>
      ) : (
        <>
          <Dove x={720} y={104} s={1.7} r={-6} />
          <Sparkle fill="yellow" x={640} y={64} r={8} />
          <Sparkle fill="yellow" x={812} y={60} r={7} />
          <Sparkle fill="yellow3" x={780} y={150} r={6} />
        </>
      )}
      <g transform="translate(604 200) scale(.64)">
        <LotusPatch />
      </g>
      <g transform="translate(836 200) scale(.64)">
        <LotusPatch />
      </g>
    </ArtSvg>
  );
}

export function NationalNoParticle() {
  return null;
}
