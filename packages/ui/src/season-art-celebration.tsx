import { ArtSvg, art, n } from './season-art-kit';

// Celebration kit (docs/UXUI_REDESIGN_S6_PLAN.md section 4, S6b): balloons, confetti, ribbons and a cake for a custom
// event (an opening, an anniversary, a promotion). Colors are `--ls-art-*` tokens of the `celebration` preset; no yellow
// anywhere (the Q-S1 exception belongs to four other kits). Decoration only: aria-hidden, nothing focusable.

const BALLOON_COLORS = ['pink', 'violet', 'teal', 'sky', 'coral', 'mint'] as const;
const STREAMER_COLORS = ['violet', 'teal', 'coral', 'sky'] as const;

/** One balloon centred on (0, 0): about 40 x 56 with its knot, a highlight and a soft shade. */
function Balloon({ color, scale = 1 }: { color: string; scale?: number }) {
  return (
    <g transform={`scale(${n(scale)})`}>
      <path
        d="M0 -26C13 -26 20 -14 20 -3C20 11 9 21 2 24L4 29L-4 29L-2 24C-9 21 -20 11 -20 -3C-20 -14 -13 -26 0 -26Z"
        fill={art(color)}
      />
      <path
        d="M8 -20C16 -12 17 2 10 14C6 19 2 22 -2 24C8 16 14 0 8 -20Z"
        fill={art('ink')}
        opacity=".12"
      />
      <ellipse
        cx="-8"
        cy="-12"
        rx="3.4"
        ry="6.4"
        transform="rotate(25 -8 -12)"
        fill={art('white')}
        opacity=".6"
      />
    </g>
  );
}

/** A curly ribbon streamer hanging down `length` (viewBox 12 wide). */
function curlPath(length: number): string {
  const q = length / 4;
  return `M6 0C12 ${n(q * 0.6)} 0 ${n(q * 1.2)} 6 ${n(q * 1.8)}S12 ${n(q * 3)} 6 ${n(q * 3.5)}S2 ${n(length)} 6 ${n(length)}`;
}

// ------------------------------------------------------------------------------------------ header rail

interface RailShape {
  /** Height of the rail in px (a multiple of 4). */
  height: number;
  /** Where the ribbon is anchored (px from the top) and how far each swag sags below it. */
  anchorY: number;
  sag: number;
  swags: number;
  /** Balloon scale at the anchors and between them. */
  scale: number;
  small: number;
}

const RAIL: Record<'wide' | 'narrow', RailShape> = {
  wide: { height: 88, anchorY: 60, sag: 16, swags: 4, scale: 0.78, small: 0.6 },
  narrow: { height: 60, anchorY: 40, sag: 10, swags: 2, scale: 0.56, small: 0.44 },
};

/** The ribbon's height at `x` percent: a parabola per swag, which is what the quadratic of the drawn path is. */
export function ribbonY(shape: RailShape, x: number): number {
  const span = 100 / shape.swags;
  const f = (((x % span) + span) % span) / span;
  return shape.anchorY + 4 * shape.sag * f * (1 - f);
}

/**
 * The header rail: a ribbon in swags across the row with balloons tied to it by their strings and curly streamers
 * hanging below. Percent x, so it follows any width; `wide` for desktops, `narrow` for tablets and phones.
 */
export function CelebrationBunting({ variant }: { variant: 'wide' | 'narrow' }) {
  const shape = RAIL[variant];
  const span = 100 / shape.swags;
  const control = shape.anchorY + shape.sag * 2;
  const path = Array.from({ length: shape.swags }, (_, index) => {
    const x1 = index * span;
    return `${index === 0 ? `M0 ${shape.anchorY}` : ''}Q${n(x1 + span / 2)} ${control} ${n(x1 + span)} ${shape.anchorY}`;
  }).join('');
  const balloons = Array.from({ length: shape.swags * 2 + 1 }, (_, index) => {
    const x = (index * span) / 2;
    return { x, anchor: index % 2 === 0, color: BALLOON_COLORS[index % BALLOON_COLORS.length]! };
  });
  const streamers = Array.from({ length: shape.swags * 2 }, (_, index) => ({
    x: (Math.floor(index / 2) + (index % 2 ? 0.74 : 0.26)) * span,
    color: STREAMER_COLORS[index % STREAMER_COLORS.length]!,
  }));
  return (
    <div
      className={`ls-art-bunting ls-art-bunting-${variant}`}
      style={{ height: `calc(var(--ls-art-u) * ${shape.height / 4})` }}
      aria-hidden="true"
    >
      <ArtSvg
        viewBox={`0 0 100 ${shape.height}`}
        preserveAspectRatio="none"
        className="ls-art-ribbon"
        motif="ribbons"
      >
        <path
          d={path}
          stroke={art('pink')}
          strokeWidth="6"
          fill="none"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d={path}
          stroke={art('pink2')}
          strokeWidth="1.6"
          fill="none"
          strokeDasharray="10 8"
          vectorEffect="non-scaling-stroke"
          transform="translate(0 -1)"
        />
      </ArtSvg>
      {streamers.map(({ x, color }, index) => {
        const top = ribbonY(shape, x) + 2;
        const length = shape.height - top;
        return (
          <ArtSvg
            key={`s${index}`}
            viewBox={`0 0 12 ${n(length)}`}
            className="ls-art-streamer"
            style={{
              left: `${n(x)}%`,
              top: `calc(var(--ls-art-u) * ${n(top / 4)})`,
              height: `calc(var(--ls-art-u) * ${n(length / 4)})`,
            }}
          >
            <path
              d={curlPath(length)}
              stroke={art(color)}
              strokeWidth="3.2"
              fill="none"
              strokeLinecap="round"
            />
          </ArtSvg>
        );
      })}
      {balloons.map(({ x, anchor, color }, index) => {
        const scale = anchor ? shape.scale : shape.small;
        const bodyW = 40 * scale;
        const bodyBottom = 30 * scale;
        const tie = ribbonY(shape, x);
        const width = n(bodyW);
        return (
          <ArtSvg
            key={`b${index}`}
            viewBox={`0 0 ${width} ${n(tie)}`}
            className="ls-art-ball"
            style={{
              left: `${n(x)}%`,
              width: `calc(var(--ls-art-u) * ${n(bodyW / 4)})`,
            }}
            motif="balloons"
          >
            <path
              d={`M${n(bodyW / 2)} ${n(bodyBottom + 2)}C${n(bodyW / 2 + 4)} ${n((bodyBottom + tie) / 2)} ${n(bodyW / 2 - 4)} ${n((bodyBottom + tie) / 2 + 3)} ${n(bodyW / 2)} ${n(tie)}`}
              stroke={art('string')}
              strokeWidth="1"
              fill="none"
            />
            <g transform={`translate(${n(bodyW / 2)} ${n(27 * scale)})`}>
              <Balloon color={color} scale={scale} />
            </g>
          </ArtSvg>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------------------------------ corner

const CORNER_W = 232;
const CORNER_H = 112;

function Confetti({
  pieces,
}: {
  pieces: ReadonlyArray<readonly [number, number, number, string, 'rect' | 'dot']>;
}) {
  return (
    <>
      {pieces.map(([x, y, rotation, color, kind]) =>
        kind === 'dot' ? (
          <circle key={`${x}-${y}`} cx={x} cy={y} r="2.6" fill={art(color)} />
        ) : (
          <rect
            key={`${x}-${y}`}
            x={x - 4}
            y={y - 1.8}
            width="8"
            height="3.6"
            rx="1"
            transform={`rotate(${rotation} ${x} ${y})`}
            fill={art(color)}
          />
        ),
      )}
    </>
  );
}

const CORNER_CONFETTI = [
  [150, 14, 30, 'teal', 'rect'],
  [166, 34, -40, 'coral', 'rect'],
  [184, 12, 70, 'violet', 'dot'],
  [196, 46, 20, 'sky', 'rect'],
  [214, 24, -25, 'pink', 'rect'],
  [138, 52, 55, 'mint', 'dot'],
  [176, 62, -60, 'violet2', 'rect'],
  [222, 64, 40, 'teal2', 'dot'],
] as const;

/** A bunch of balloons tied with a bow and curling ribbons, in the top-left corner (232 x 112). */
export function CelebrationCorner({ className }: { className?: string }) {
  return (
    <ArtSvg
      viewBox={`0 0 ${CORNER_W} ${CORNER_H}`}
      className={className}
      motif="balloons ribbons confetti"
    >
      {(
        [
          [26, 62],
          [68, 57],
          [110, 69],
          [48, 82],
          [88, 87],
        ] as const
      ).map(([x, y]) => (
        <path
          key={x}
          d={`M${x} ${y}Q${n((x + 62) / 2 + 4)} ${n((y + 94) / 2)} 62 94`}
          stroke={art('string')}
          strokeWidth="1.2"
          fill="none"
        />
      ))}
      <g transform="translate(26 32) rotate(-8)">
        <Balloon color="pink" scale={1.05} />
      </g>
      <g transform="translate(68 24) rotate(4)">
        <Balloon color="violet" scale={1.15} />
      </g>
      <g transform="translate(110 40) rotate(10)">
        <Balloon color="teal" scale={1} />
      </g>
      <g transform="translate(48 58) rotate(-4)">
        <Balloon color="sky" scale={0.82} />
      </g>
      <g transform="translate(88 64) rotate(6)">
        <Balloon color="coral" scale={0.78} />
      </g>
      <path d="M62 94C52 82 40 90 52 100C58 104 62 98 62 94Z" fill={art('violet')} />
      <path d="M62 94C72 82 84 90 72 100C66 104 62 98 62 94Z" fill={art('pink')} />
      <circle cx="62" cy="94" r="4.4" fill={art('violet2')} />
      <path
        d="M58 98C54 108 46 110 44 108"
        stroke={art('teal')}
        strokeWidth="3"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M66 98C70 110 80 110 82 106"
        stroke={art('coral')}
        strokeWidth="3"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M118 96C140 84 160 108 184 92S214 100 226 88"
        stroke={art('pink')}
        strokeWidth="5"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M118 96C140 84 160 108 184 92S214 100 226 88"
        stroke={art('pink2')}
        strokeWidth="1.4"
        fill="none"
        strokeDasharray="8 7"
        transform="translate(0 -1)"
      />
      <Confetti pieces={CORNER_CONFETTI} />
    </ArtSvg>
  );
}

// ------------------------------------------------------------------------------------------ logo and divider

/** A cake with a lit candle, beside the wordmark (56 x 48). */
export function CelebrationCakeMini({ className }: { className?: string }) {
  return (
    <ArtSvg viewBox="0 0 56 48" className={className} motif="cake">
      <ellipse cx="28" cy="43" rx="25" ry="4" fill={art('cream2')} />
      <rect x="8" y="26" width="40" height="16" rx="4" fill={art('pink2')} />
      <path
        d="M8 30C12 38 16 30 20 34C24 38 28 28 32 34C36 38 40 30 44 34C46 36 47 33 48 31V26H8Z"
        fill={art('white')}
      />
      <rect x="25.6" y="14" width="4.8" height="13" rx="1.4" fill={art('violet')} />
      <path d="M28 4C32 8 32 12 28 14C24 12 24 8 28 4Z" fill={art('coral')} />
      <circle cx="16" cy="36" r="1.6" fill={art('teal')} />
      <circle cx="28" cy="38" r="1.6" fill={art('violet')} />
      <circle cx="40" cy="36" r="1.6" fill={art('sky')} />
    </ArtSvg>
  );
}

/** Divider centrepiece: a bow between two balloons with confetti (200 x 32). */
export function CelebrationDividerArt({ className }: { className?: string }) {
  return (
    <ArtSvg viewBox="0 0 200 32" className={className} motif="balloons ribbons confetti">
      <g transform="translate(46 13) scale(.42)">
        <Balloon color="violet" />
      </g>
      <g transform="translate(154 13) scale(.42)">
        <Balloon color="teal" />
      </g>
      <path
        d="M46 24C56 28 70 20 84 26M154 24C144 28 130 20 116 26"
        stroke={art('string')}
        strokeWidth="1"
        fill="none"
      />
      <path d="M100 16C90 6 78 10 84 20C88 26 98 22 100 16Z" fill={art('pink')} />
      <path d="M100 16C110 6 122 10 116 20C112 26 102 22 100 16Z" fill={art('pink2')} />
      <circle cx="100" cy="16" r="4" fill={art('violet2')} />
      <path
        d="M98 20L92 30M102 20L108 30"
        stroke={art('coral')}
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      <Confetti
        pieces={[
          [14, 10, 20, 'teal', 'rect'],
          [28, 22, -30, 'coral', 'dot'],
          [64, 8, 50, 'sky', 'rect'],
          [136, 8, -45, 'pink', 'rect'],
          [172, 22, 30, 'violet', 'dot'],
          [188, 10, -20, 'mint', 'rect'],
        ]}
      />
    </ArtSvg>
  );
}

// ------------------------------------------------------------------------------------------ footer scene

/** A three-tier cake with candles, drips and sprinkles on a stand (180 x 190). */
export function CelebrationCake({ className }: { className?: string }) {
  return (
    <ArtSvg viewBox="0 0 180 190" className={className} motif="cake">
      <ellipse cx="90" cy="176" rx="84" ry="10" fill={art('cream2')} />
      <rect x="40" y="170" width="100" height="6" rx="3" fill={art('violet2')} />
      <rect x="14" y="116" width="152" height="54" rx="9" fill={art('pink2')} />
      <path
        d="M14 126C22 150 30 128 40 142C50 156 58 126 70 140C80 152 90 126 102 140C112 154 122 128 134 140C144 150 152 128 166 136V116H14Z"
        fill={art('white')}
      />
      <rect x="34" y="70" width="112" height="48" rx="8" fill={art('violet2')} />
      <path
        d="M34 80C42 100 52 80 62 92C72 104 80 80 92 92C102 102 112 80 124 92C134 100 140 82 146 86V70H34Z"
        fill={art('white')}
      />
      <rect x="58" y="30" width="64" height="42" rx="7" fill={art('teal2')} />
      <path
        d="M58 40C64 58 72 40 80 50C88 60 94 40 104 50C112 58 118 42 122 44V30H58Z"
        fill={art('white')}
      />
      {[72, 90, 108].map((x, index) => (
        <g key={x}>
          <rect
            x={x - 3}
            y="8"
            width="6"
            height="22"
            rx="2"
            fill={art(['pink', 'violet', 'sky'][index]!)}
          />
          <path
            d={`M${x} -4C${x + 5} 1 ${x + 5} 6 ${x} 9C${x - 5} 6 ${x - 5} 1 ${x} -4Z`}
            fill={art('coral')}
          />
        </g>
      ))}
      {(
        [
          [28, 140, 'teal'],
          [56, 154, 'violet'],
          [84, 146, 'coral'],
          [112, 156, 'sky'],
          [140, 146, 'pink'],
          [150, 128, 'violet'],
          [46, 98, 'pink'],
          [76, 108, 'teal'],
          [104, 100, 'coral'],
          [130, 106, 'sky'],
        ] as const
      ).map(([x, y, color]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r="3" fill={art(color)} />
      ))}
    </ArtSvg>
  );
}

/** A tall bunch of balloons on a weight with curling ribbons (120 x 220). */
export function CelebrationBunch({
  className,
  flip = false,
}: {
  className?: string;
  flip?: boolean;
}) {
  const balloons: ReadonlyArray<readonly [number, number, string, number, number]> = [
    [60, 40, 'violet', 1.3, 0],
    [24, 76, 'pink', 1.15, -8],
    [98, 78, 'teal', 1.15, 8],
    [50, 112, 'sky', 1.05, -4],
    [80, 116, 'coral', 1, 5],
  ];
  return (
    <ArtSvg viewBox="0 0 120 220" className={className} motif="balloons ribbons">
      <g transform={flip ? 'translate(120 0) scale(-1 1)' : undefined}>
        {balloons.map(([x, y, , , rotation], index) => (
          <path
            key={index}
            d={`M${x} ${y + 34 * (index === 0 ? 1.3 : 1)}C${x} 150 ${n(60 + (x - 60) * 0.2)} 170 60 188`}
            stroke={art('string')}
            strokeWidth="1.3"
            fill="none"
            transform={`rotate(${rotation * 0.1} ${x} ${y})`}
          />
        ))}
        {balloons.map(([x, y, color, scale, rotation]) => (
          <g key={`${x}-${y}`} transform={`translate(${x} ${y}) rotate(${rotation})`}>
            <Balloon color={color} scale={scale} />
          </g>
        ))}
        <path d="M60 188C48 176 34 184 46 196C54 202 60 194 60 188Z" fill={art('violet')} />
        <path d="M60 188C72 176 86 184 74 196C66 202 60 194 60 188Z" fill={art('pink')} />
        <circle cx="60" cy="188" r="5" fill={art('violet2')} />
        <path
          d="M54 196C50 210 42 214 38 212"
          stroke={art('teal')}
          strokeWidth="3.4"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M66 196C70 210 80 214 84 210"
          stroke={art('coral')}
          strokeWidth="3.4"
          fill="none"
          strokeLinecap="round"
        />
        <rect x="42" y="208" width="36" height="10" rx="3" fill={art('cream2')} />
      </g>
    </ArtSvg>
  );
}

function GiftBox({
  x,
  y,
  w,
  h,
  body,
  ribbon,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  body: string;
  ribbon: string;
}) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect width={w} height={h} rx="3" fill={art(body)} />
      <rect x="-3" y="-5" width={w + 6} height="11" rx="3" fill={art(body)} opacity=".92" />
      <rect x="-3" y="-5" width={w + 6} height="4" rx="2" fill={art('white')} opacity=".25" />
      <rect x={w / 2 - 3.5} y="-5" width="7" height={h + 5} fill={art(ribbon)} />
      <path
        d={`M${w / 2} -5C${w / 2 - 14} -20 ${w / 2 - 20} -5 ${w / 2} -5C${w / 2 + 20} -5 ${w / 2 + 14} -20 ${w / 2} -5Z`}
        fill={art(ribbon)}
      />
    </g>
  );
}

/** Three presents for the foot of the cake or a bunch (130 x 64). */
export function CelebrationGifts({ className }: { className?: string }) {
  return (
    <ArtSvg viewBox="0 0 130 64" className={className} motif="gifts ribbons">
      <GiftBox x={4} y={24} w={42} h={36} body="violet" ribbon="pink2" />
      <GiftBox x={54} y={10} w={34} h={50} body="teal" ribbon="white" />
      <GiftBox x={96} y={30} w={30} h={30} body="pink" ribbon="violet2" />
    </ArtSvg>
  );
}

/** The ground of the scene: a soft cream drift and a pastel drift, stretched to the width (1440 x 232). */
export function CelebrationFloor({ className }: { className?: string }) {
  return (
    <ArtSvg viewBox="0 0 1440 232" preserveAspectRatio="none" className={className}>
      <path
        d="M0 160C120 140 240 150 360 164C500 178 620 140 760 144C900 148 1020 172 1160 154C1260 142 1360 138 1440 148V232H0Z"
        fill={art('cream2')}
      />
      <path
        d="M0 188C140 168 260 180 400 192C540 204 660 176 800 180C940 184 1060 204 1200 190C1300 180 1380 176 1440 182V232H0Z"
        fill={art('cream')}
      />
    </ArtSvg>
  );
}

/** Confetti on the floor, not stretched: a fixed scatter, cropped to the width (1440 x 232). */
export function CelebrationFloorConfetti({ className }: { className?: string }) {
  const colors = ['pink', 'violet', 'teal', 'sky', 'coral', 'mint'] as const;
  const pieces = Array.from({ length: 36 }, (_, index) => {
    const x = (index * 197) % 1400;
    const y = 176 + ((index * 53) % 44);
    return [
      x + 20,
      y,
      (index * 47) % 180,
      colors[index % colors.length]!,
      index % 3 === 0 ? 'dot' : 'rect',
    ] as const;
  });
  return (
    <ArtSvg
      viewBox="0 0 1440 232"
      preserveAspectRatio="xMidYMax slice"
      className={className}
      motif="confetti"
    >
      <Confetti pieces={pieces} />
    </ArtSvg>
  );
}

/** A falling confetti piece (16 x 16): the shape and color follow the index. */
export function CelebrationConfettiPiece({ index }: { index: number }) {
  const color = BALLOON_COLORS[index % BALLOON_COLORS.length]!;
  return (
    <svg className="ls-fx-site-glyph" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      {index % 3 === 0 ? (
        <circle cx="8" cy="8" r="3.6" fill={art(color)} />
      ) : index % 3 === 1 ? (
        <rect x="2" y="5.6" width="12" height="4.8" rx="1.2" fill={art(color)} />
      ) : (
        <path d="M3 2C9 3 7 8 11 9C9 11 6 10 5 14C4 9 8 7 3 2Z" fill={art(color)} />
      )}
    </svg>
  );
}
