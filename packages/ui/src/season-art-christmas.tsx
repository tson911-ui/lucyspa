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
/** What hangs at each place of the wire, in order: mostly bulbs, with stockings, bells and candy canes between. */
const HANG_PATTERN = [
  'bulb',
  'bulb',
  'stocking',
  'bulb',
  'bell',
  'bulb',
  'cane',
  'bulb',
  'bulb',
  'bell',
] as const;
export type HangKind = 'bulb' | 'stocking' | 'bell' | 'cane';

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
): Array<{ x: number; y: number; color: string; kind: HangKind }> {
  const { anchors, sag, perSwag } = LIGHT_SHAPE[variant];
  const bulbs: Array<{ x: number; y: number; color: string; kind: HangKind }> = [];
  anchors.slice(0, -1).forEach((x1, index) => {
    for (let step = 1; step < perSwag; step++) {
      const point = swagPoint(
        x1,
        anchors[index + 1]!,
        LIGHT_TOP,
        LIGHT_TOP + sag * 2,
        step / perSwag,
      );
      bulbs.push({
        ...point,
        color: BULB_COLORS[bulbs.length % 4]!,
        kind: HANG_PATTERN[bulbs.length % HANG_PATTERN.length]!,
      });
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
      {lightPositions(variant).map((item, index) => {
        const style = {
          left: `${n(item.x)}%`,
          top: `calc(var(--ls-art-u) * ${n(item.y / 4)})`,
        };
        if (item.kind === 'stocking') {
          return (
            <ArtSvg
              key={index}
              viewBox="0 -4 26 42"
              className="ls-art-hang ls-art-hang-stocking"
              style={style}
              motif="stockings"
            >
              <StockingShape />
            </ArtSvg>
          );
        }
        if (item.kind === 'bell') {
          return (
            <ArtSvg
              key={index}
              viewBox="0 -2 26 34"
              className="ls-art-hang ls-art-hang-bell"
              style={style}
              motif="bells"
            >
              <BellShape />
            </ArtSvg>
          );
        }
        if (item.kind === 'cane') {
          return (
            <ArtSvg
              key={index}
              viewBox="0 0 22 44"
              className="ls-art-hang ls-art-hang-cane"
              style={style}
              motif="candy-canes"
            >
              <CaneShape />
            </ArtSvg>
          );
        }
        return (
          <ArtSvg key={index} viewBox="0 0 28 36" className="ls-art-bulb" style={style}>
            <circle cx="14" cy="21" r="12" fill={art(item.color)} opacity=".14" />
            <rect x="11.4" y="2" width="5.2" height="4.4" rx="1" fill={art('wire')} />
            <path d="M14 6C8 8 6.5 16 14 20C21.5 16 20 8 14 6Z" fill={art(item.color)} />
            <ellipse cx="12" cy="11" rx="1.4" ry="2.4" fill={art('white')} opacity=".55" />
          </ArtSvg>
        );
      })}
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
    <ArtSvg viewBox={`0 0 ${GARLAND_W} ${GARLAND_H}`} className={className} motif="bells">
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
      <g transform="translate(6 42) scale(.95)">
        <BellShape />
      </g>
      <g transform="translate(30 40) scale(.95)">
        <BellShape />
      </g>
    </ArtSvg>
  );
}

/** A santa hat that sits on the top edge of the wordmark (56 x 48). */
export function ChristmasHat({ className }: { className?: string }) {
  return (
    <ArtSvg viewBox="0 0 56 48" className={className} motif="santa">
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

/** Divider centrepiece: candy canes and bells around a wreath (200 x 32). */
export function ChristmasDividerArt({ className }: { className?: string }) {
  return (
    <ArtSvg viewBox="0 0 200 32" className={className} motif="candy-canes bells wreath">
      <g transform="translate(6 0) scale(.7)">
        <CaneShape />
      </g>
      <g transform="translate(38 1) scale(.8)">
        <BellShape />
      </g>
      <g transform="translate(100 16) scale(.62)">
        <WreathShape />
      </g>
      <g transform="translate(141 1) scale(.8)">
        <BellShape />
      </g>
      <g transform="translate(178 0) scale(.7)">
        <CaneShape />
      </g>
    </ArtSvg>
  );
}

// ------------------------------------------------------------------------------- small iconic shapes

function StockingShape() {
  return (
    <>
      <path d="M7 6Q9 -3 15 -2" stroke={art('wire')} strokeWidth="1.4" fill="none" />
      <path d="M6 10H20V25C20 30 17 32 14 33L9 37C5 38 1 34 3 30L6 26Z" fill={art('red')} />
      <rect
        x="4"
        y="6"
        width="18"
        height="7"
        rx="3"
        fill={art('white')}
        stroke={art('snow2')}
        strokeWidth="1"
      />
      <path d="M3 30C1 34 5 38 9 37L12 35L8 31Z" fill={art('pine2')} />
      <rect x="14" y="21" width="6" height="5" rx="1" fill={art('pine2')} />
      <circle cx="11" cy="18" r="1.6" fill={art('white')} />
      <circle cx="15" cy="15" r="1.2" fill={art('white')} />
    </>
  );
}

function CaneShape() {
  const hook = 'M7 42V15Q7 5 13 5Q19 5 19 13';
  return (
    <>
      <path d={hook} stroke={art('snow2')} strokeWidth="8" fill="none" strokeLinecap="round" />
      <path d={hook} stroke={art('white')} strokeWidth="6" fill="none" strokeLinecap="round" />
      <path d={hook} stroke={art('red')} strokeWidth="6" fill="none" strokeDasharray="4.5 4.5" />
    </>
  );
}

function BellShape() {
  return (
    <>
      <path
        d="M13 4C7 4 6 11 5 17L3 23H23L21 17C20 11 19 4 13 4Z"
        fill={art('snow2')}
        stroke={art('ice')}
        strokeWidth="1.5"
      />
      <path
        d="M8 13C9 10 11 9 13 9"
        stroke={art('white')}
        strokeWidth="1.6"
        fill="none"
        strokeLinecap="round"
      />
      <circle cx="13" cy="26" r="3" fill={art('red3')} />
      <path d="M13 4C8 -1 4 3 9 5Z M13 4C18 -1 22 3 17 5Z" fill={art('red')} />
      <circle cx="13" cy="4.5" r="2" fill={art('red3')} />
    </>
  );
}

/** A wreath centred on the origin (radius 15) with berries and a bow. */
function WreathShape() {
  return (
    <>
      {Array.from({ length: 20 }, (_, index) => (
        <ellipse
          key={index}
          cx="0"
          cy={index % 2 ? -15 : -13}
          rx="7"
          ry="3"
          transform={`rotate(${index * 18})`}
          fill={art(index % 3 === 0 ? 'pine2' : index % 3 === 1 ? 'pine' : 'pine3')}
        />
      ))}
      {[20, 80, 140, 200, 260, 320].map((angle) => (
        <circle
          key={angle}
          cx="0"
          cy="-15"
          r="2.4"
          fill={art('red')}
          transform={`rotate(${angle})`}
        />
      ))}
      <g transform="translate(0 15)">
        <path d="M0 0C-10 -8 -14 4 -4 5Z M0 0C10 -8 14 4 4 5Z" fill={art('red')} />
        <path d="M-2 4L-7 14L-1 11L0 15M2 4L7 14L1 11L0 15" fill={art('red3')} />
        <circle r="2.8" fill={art('red2')} />
      </g>
    </>
  );
}

// ------------------------------------------------------------------------------- figures

/** A snowman with a scarf, a green top hat and a carrot nose (84 x 124). */
export function ChristmasSnowman({ className }: { className?: string }) {
  return (
    <ArtSvg viewBox="0 0 84 124" className={className} motif="snowman">
      <ellipse cx="42" cy="121" rx="28" ry="4" fill={art('snow2')} opacity=".6" />
      {[
        [42, 92, 28],
        [42, 58, 21],
        [42, 30, 16],
      ].map(([cx, cy, r]) => (
        <circle
          key={cy}
          cx={cx}
          cy={cy}
          r={r}
          fill={art('snow')}
          stroke={art('snow2')}
          strokeWidth="2"
        />
      ))}
      <path
        d="M22 56L5 44M10 48L5 41M62 56L79 46M73 50L78 43"
        stroke={art('wood')}
        strokeWidth="3"
        strokeLinecap="round"
        fill="none"
      />
      <rect x="26" y="43" width="32" height="8" rx="4" fill={art('red')} />
      <path d="M50 49L57 72L49 72L46 51Z" fill={art('red')} />
      <path d="M52 55L55 66" stroke={art('white')} strokeWidth="2" opacity=".7" />
      <ellipse cx="42" cy="15" rx="18" ry="4" fill={art('pine3')} />
      <rect x="31" y="0" width="22" height="15" rx="2" fill={art('pine3')} />
      <rect x="31" y="9" width="22" height="4.5" fill={art('red')} />
      <circle cx="36" cy="28" r="1.9" fill={art('ink')} />
      <circle cx="48" cy="28" r="1.9" fill={art('ink')} />
      <path d="M42 31L59 35L42 37Z" fill={art('carrot')} />
      {[-9, -5, -2, 2, 5, 9].map((dx, index) => (
        <circle
          key={dx}
          cx={42 + dx}
          cy={38 + (index === 0 || index === 5 ? 0 : 1.6)}
          r="1"
          fill={art('ink')}
        />
      ))}
      <circle cx="31" cy="34" r="3" fill={art('pink')} opacity=".7" />
      {[56, 68, 80].map((y) => (
        <circle key={y} cx="42" cy={y} r="2.2" fill={art('ink')} />
      ))}
    </ArtSvg>
  );
}

/** Santa Claus standing and waving, with his sack (96 x 132). */
export function ChristmasSanta({ className }: { className?: string }) {
  return (
    <ArtSvg viewBox="0 0 96 132" className={className} motif="santa">
      <ellipse cx="46" cy="129" rx="30" ry="3.5" fill={art('snow2')} opacity=".6" />
      <path d="M70 94C66 106 66 124 80 127C94 124 96 106 90 94Z" fill={art('wood')} />
      <path d="M70 97C76 101 84 101 90 97" stroke={art('red3')} strokeWidth="4" fill="none" />
      <ellipse cx="80" cy="93" rx="9" ry="4.5" fill={art('wood')} />
      <rect x="26" y="112" width="17" height="14" rx="6" fill={art('ink')} />
      <rect x="47" y="112" width="17" height="14" rx="6" fill={art('ink')} />
      <rect x="28" y="96" width="34" height="20" fill={art('red3')} />
      <path d="M24 52C20 70 20 90 22 106H66C68 90 68 70 64 52Z" fill={art('red')} />
      <rect x="40" y="52" width="8" height="54" fill={art('white')} />
      <rect x="20" y="102" width="48" height="8" rx="4" fill={art('white')} />
      <rect x="22" y="80" width="44" height="8" fill={art('ink')} />
      <rect x="38" y="77" width="12" height="14" rx="2" fill={art('snow2')} />
      <rect x="41" y="81" width="6" height="6" fill={art('ink')} />
      <path d="M26 58L10 42" stroke={art('red')} strokeWidth="12" strokeLinecap="round" />
      <circle cx="12" cy="43" r="6" fill={art('white')} />
      <circle cx="7" cy="37" r="6" fill={art('ink')} />
      <path d="M62 58L74 82" stroke={art('red')} strokeWidth="12" strokeLinecap="round" />
      <circle cx="74" cy="84" r="6" fill={art('white')} />
      <circle cx="76" cy="91" r="5.5" fill={art('ink')} />
      <circle cx="44" cy="38" r="14" fill={art('skin')} />
      <circle cx="35" cy="42" r="3" fill={art('pink')} opacity=".7" />
      <path
        d="M31 40C30 58 40 64 44 64C48 64 58 58 57 40C52 46 36 46 31 40Z"
        fill={art('white')}
        stroke={art('snow2')}
        strokeWidth="1"
      />
      <ellipse
        cx="38"
        cy="43"
        rx="6"
        ry="3"
        fill={art('white')}
        stroke={art('snow2')}
        strokeWidth="1"
      />
      <ellipse
        cx="50"
        cy="43"
        rx="6"
        ry="3"
        fill={art('white')}
        stroke={art('snow2')}
        strokeWidth="1"
      />
      <circle cx="44" cy="41" r="3" fill={art('red2')} />
      <circle cx="39" cy="35" r="1.6" fill={art('ink')} />
      <circle cx="49" cy="35" r="1.6" fill={art('ink')} />
      <path d="M29 34C29 16 40 8 52 8C58 8 64 14 66 24C60 22 56 24 54 34Z" fill={art('red')} />
      <rect x="27" y="30" width="34" height="9" rx="4.5" fill={art('white')} />
      <circle cx="66" cy="26" r="6" fill={art('white')} />
    </ArtSvg>
  );
}

function ReindeerShape({ lead }: { lead?: boolean }) {
  return (
    <>
      <path
        d="M-12 8L-30 18M-6 9L-22 20M14 8L34 14M20 7L38 6"
        stroke={art('wood')}
        strokeWidth="4"
        strokeLinecap="round"
        fill="none"
      />
      <ellipse rx="21" ry="11" fill={art('wood')} />
      <ellipse cx="-2" cy="5" rx="13" ry="4.5" fill={art('white')} opacity=".3" />
      <path d="M14 -6C20 -12 24 -16 28 -18L34 -10C28 -4 22 2 16 6Z" fill={art('wood')} />
      <ellipse cx="33" cy="-16" rx="8" ry="6.5" transform="rotate(-20 33 -16)" fill={art('wood')} />
      <ellipse cx="40" cy="-13" rx="4" ry="3" fill={art('wood')} />
      <circle cx="43" cy="-13" r="2.6" fill={art(lead ? 'red' : 'ink')} />
      <circle cx="34" cy="-18" r="1.3" fill={art('ink')} />
      <ellipse cx="28" cy="-23" rx="3" ry="5" transform="rotate(-30 28 -23)" fill={art('wood')} />
      <path
        d="M30 -23L26 -35M28 -30L22 -31M28 -30L32 -37"
        stroke={art('wood')}
        strokeWidth="2.6"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="-21" cy="-4" r="3.2" fill={art('white')} />
      <path d="M19 -9L22 2" stroke={art('red')} strokeWidth="3" />
      <circle cx="22" cy="4" r="2.2" fill={art('snow2')} />
    </>
  );
}

/** Santa's sleigh with two reindeer (the leader has the red nose), flying right, with a few sparkles (300 x 112). */
export function ChristmasSleigh({ className }: { className?: string }) {
  return (
    <ArtSvg viewBox="0 0 300 112" className={className} motif="sleigh-reindeer">
      {[
        [176, 14],
        [284, 12],
        [150, 6],
        [214, 96],
      ].map(([x, y]) => (
        <path
          key={`${x}-${y}`}
          d={`M${x} ${y! - 4}L${x! + 1.2} ${y! - 1.2}L${x! + 4} ${y}L${x! + 1.2} ${y! + 1.2}L${x} ${y! + 4}L${x! - 1.2} ${y! + 1.2}L${x! - 4} ${y}L${x! - 1.2} ${y! - 1.2}Z`}
          fill={art('ice')}
        />
      ))}
      <path
        d="M10 98H124Q140 98 138 84M40 88V98M96 88V98"
        stroke={art('wood')}
        strokeWidth="4"
        strokeLinecap="round"
        fill="none"
      />
      <rect x="18" y="42" width="15" height="15" rx="1" fill={art('pine')} />
      <rect x="24" y="42" width="3" height="15" fill={art('pink')} />
      <rect x="31" y="34" width="13" height="13" rx="1" fill={art('pink')} />
      <rect x="36" y="34" width="3" height="13" fill={art('red')} />
      <path d="M46 70Q46 48 62 48Q78 48 78 70Z" fill={art('red')} />
      <circle cx="62" cy="37" r="10" fill={art('skin')} />
      <path d="M52 39Q52 53 62 55Q72 53 72 39Q66 45 52 39Z" fill={art('white')} />
      <path d="M52 33Q52 19 66 19Q74 19 76 29Q70 27 70 33Z" fill={art('red')} />
      <rect x="51" y="30" width="22" height="6" rx="3" fill={art('white')} />
      <circle cx="76" cy="29" r="4" fill={art('white')} />
      <circle cx="62" cy="39" r="2" fill={art('red2')} />
      <path d="M74 54L96 48" stroke={art('red')} strokeWidth="7" strokeLinecap="round" />
      <circle cx="98" cy="47" r="4" fill={art('ink')} />
      <path
        d="M18 58Q18 88 52 90H112Q124 90 124 78V58Q100 74 70 70Q40 66 18 58Z"
        fill={art('red')}
      />
      <path
        d="M18 58Q40 66 70 70Q100 74 124 58"
        stroke={art('white')}
        strokeWidth="3"
        fill="none"
      />
      <path
        d="M124 60Q136 54 136 42M18 60Q6 58 6 44"
        stroke={art('red')}
        strokeWidth="7"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M98 47Q150 44 176 56M204 56Q222 52 236 50"
        stroke={art('ice')}
        strokeWidth="1.5"
        fill="none"
      />
      <g transform="translate(184 70)">
        <ReindeerShape />
      </g>
      <g transform="translate(256 54)">
        <ReindeerShape lead />
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
    <ArtSvg viewBox="0 0 120 170" className={className} motif="tree">
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
    <ArtSvg viewBox="0 0 128 64" className={className} motif="gifts">
      <Gift x={4} y={22} w={44} h={38} body="red" ribbon="white" />
      <Gift x={56} y={6} w={34} h={54} body="pine" ribbon="pink" rotation={4} />
      <Gift x={96} y={30} w={30} h={30} body="bulb3" ribbon="red" />
    </ArtSvg>
  );
}

/** Two gifts for the foot of the right tree (92 x 64). */
export function ChristmasGiftsB({ className }: { className?: string }) {
  return (
    <ArtSvg viewBox="0 0 92 64" className={className} motif="gifts">
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
