import { art, n } from './season-art-kit';
import { place } from './season-art-shapes';

// The Mid-Autumn lion dance (mua lan) as the Owner described it: a lion head with one horn and a mirror on the forehead,
// big round eyes with lids and lashes, a wide open mouth with teeth and a red tongue, a long beard and fluffy
// pom-poms; a long cloth body with scales and tassels over two dancers, of whom only two pairs of human legs show
// (loose trousers, cloth shoes); Ong Dia with his big belly, wide smile and fan; cymbals. Colors are `--ls-art-*`
// tokens of the `mid-autumn` preset. Decoration only. Each piece stands on y = 0 and is placed by its callers.

const POMS = ['red2', 'yellow', 'green', 'white', 'orange'] as const;

interface Pose {
  x?: number;
  y?: number;
  s?: number;
}

/** The lion's head from the front, centred on its face: about 116 wide, from the horn (-66) to the beard (+74). */
function LionHead() {
  const fringe = Array.from({ length: 20 }, (_, i) => {
    const a = (i / 20) * Math.PI * 2 - Math.PI / 2;
    return { x: Math.cos(a) * 50, y: Math.sin(a) * 45, c: POMS[i % POMS.length]! };
  });
  const strands = [-26, -17, -8, 0, 8, 17, 26];
  // Thick lashes fanning out of the top of an eye centred on (cx, -7).
  const lash = (cx: number) =>
    [-128, -90, -52].map((deg) => {
      const cos = Math.cos((deg * Math.PI) / 180);
      const sin = Math.sin((deg * Math.PI) / 180);
      return (
        <path
          key={deg}
          d={`M${n(cx + 13 * cos)} ${n(-7 + 13 * sin)}L${n(cx + 22 * cos)} ${n(-7 + 22 * sin)}`}
          stroke={art('ink')}
          strokeWidth="2.8"
          strokeLinecap="round"
        />
      );
    });
  return (
    <g>
      {strands.map((sx, i) => (
        <path
          data-part="beard"
          key={sx}
          d={`M${sx - 5} 34Q${sx + (i % 2 ? 5 : -5)} 58 ${sx * 1.3} ${84 - Math.abs(sx) * 0.4}Q${sx + 6} 54 ${sx + 5} 34Z`}
          fill={art(i % 2 ? 'cloud2' : 'white')}
          stroke={art('lilac')}
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
      ))}
      {fringe.map((p, i) => (
        <circle key={i} cx={n(p.x)} cy={n(p.y)} r="9" fill={art(p.c)} />
      ))}
      <g transform="rotate(-26 -41 -22)">
        <ellipse cx="-41" cy="-22" rx="9" ry="14" fill={art('green')} />
        <ellipse cx="-41" cy="-21" rx="4.6" ry="8.4" fill={art('yellow3')} />
      </g>
      <g transform="rotate(26 41 -22)">
        <ellipse cx="41" cy="-22" rx="9" ry="14" fill={art('green')} />
        <ellipse cx="41" cy="-21" rx="4.6" ry="8.4" fill={art('yellow3')} />
      </g>
      <ellipse rx="43" ry="39" fill={art('red')} stroke={art('yellow2')} strokeWidth="2.4" />
      <path
        d="M-30 -22C-18 -40 18 -40 30 -22C18 -30 -18 -30 -30 -22Z"
        fill={art('green')}
        stroke={art('yellow')}
        strokeWidth="1.8"
      />
      {[-24, -16, 16, 24].map((dx) => (
        <circle key={dx} cx={dx} cy="-27" r="1.8" fill={art('yellow')} />
      ))}
      <path
        data-part="horn"
        d="M-6 -33C-6 -50 -2 -60 7 -68C5 -56 7 -46 6 -33Z"
        fill={art('yellow')}
        stroke={art('yellow2')}
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle
        data-part="mirror"
        cy="-26"
        r="9"
        fill={art('red3')}
        stroke={art('yellow')}
        strokeWidth="2"
      />
      <circle cy="-26" r="6" fill={art('white')} />
      <path
        d="M-3 -29C-1 -31 2 -31 3.4 -29"
        stroke={art('cloud2')}
        strokeWidth="1.6"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M-36 6C-30 -2 -26 4 -22 -2M36 6C30 -2 26 4 22 -2"
        stroke={art('yellow')}
        strokeWidth="3"
        strokeLinecap="round"
        fill="none"
      />
      {[-1, 1].map((side) => (
        <g key={side} data-part="eye">
          <path
            d={`M${side * 17 - 14} -8C${side * 17 - 14} -28 ${side * 17 + 14} -28 ${side * 17 + 14} -8Z`}
            fill={art('orange')}
            stroke={art('ink')}
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
          <circle
            cx={side * 17}
            cy="-7"
            r="12.4"
            fill={art('white')}
            stroke={art('ink')}
            strokeWidth="1.8"
          />
          <circle cx={side * 15} cy="-6" r="7" fill={art('ink')} />
          <circle cx={side * 13} cy="-9" r="2.4" fill={art('white')} />
          {lash(side * 17)}
        </g>
      ))}
      <ellipse cy="8" rx="7" ry="4.4" fill={art('red3')} />
      <path
        d="M-30 15C-12 8 12 8 30 15C36 36 14 46 0 46C-14 46 -36 36 -30 15Z"
        fill={art('red3')}
        stroke={art('yellow2')}
        strokeWidth="1.6"
      />
      <ellipse data-part="tongue" cy="36" rx="15" ry="8" fill={art('red2')} />
      <path d="M0 30L0 42" stroke={art('red3')} strokeWidth="1.4" />
      <path
        d="M-26 14L-22 25L-17 13.6M-14 12.6L-10 24L-5 12M5 12L10 24L14 12.6M17 13.6L22 25L26 14"
        fill={art('white')}
      />
      <path d="M-18 44L-14 36L-9 44.6M-5 45.6L0 38L5 45.6M9 44.6L14 36L18 44" fill={art('white')} />
    </g>
  );
}

/** One human leg under the cloth: loose trousers and a cloth shoe, 46 tall, hip at (x, -46), tilted a little (dancing). */
function Leg({ x, tilt = 0 }: { x: number; tilt?: number }) {
  return (
    <g data-part="leg" transform={`translate(${x} -46)${tilt ? ` rotate(${tilt})` : ''}`}>
      <path d="M-9 0L9 0C10 16 11 28 9 36L-7 36C-10 28 -10 16 -9 0Z" fill={art('yellow')} />
      <path
        d="M-9 17C-3 20 4 20 10 17"
        stroke={art('yellow2')}
        strokeWidth="1.8"
        fill="none"
        strokeLinecap="round"
      />
      <path d="M-8 34L10 34L13 43C13 46 10 47 7 47L-9 47C-10 41 -9 37 -8 34Z" fill={art('ink')} />
      <rect x="-10" y="45.4" width="22" height="2.8" rx="1.2" fill={art('white')} />
    </g>
  );
}

const HUMP = [
  [34, -113],
  [62, -121],
  [92, -123],
  [122, -120],
  [150, -112],
  [178, -99],
  [200, -85],
  [213, -69],
] as const;

/** The cloth body: scales, a fringe of pom-poms along the spine, a trim at the hem and tassels (x 10..222, y -124..-30). */
function LionCloth() {
  const scallops = 13;
  const w = 212 / scallops;
  let hem = '';
  for (let i = 0; i < scallops; i += 1) {
    const x = 222 - i * w;
    hem += `Q${n(x - w / 2)} -32 ${n(x - w)} -44`;
  }
  // Fish-scale rows: a scale is a half circle of radius 8 hanging from (x, y); it is drawn only where it sits under the
  // spine line (HUMP, linearly interpolated) and above the hem.
  const spine = (px: number): number => {
    const points = [[10, -104], ...HUMP, [222, -60]] as const;
    for (let i = 1; i < points.length; i += 1) {
      const [x1, y1] = points[i - 1]!;
      const [x2, y2] = points[i]!;
      if (px <= x2) return y1 + ((y2 - y1) * (px - x1)) / (x2 - x1);
    }
    return -60;
  };
  const scales: { x: number; y: number; accent: boolean }[] = [];
  for (let r = 0; r < 7; r += 1) {
    const y = -112 + r * 9;
    for (let x = 18 + (r % 2 ? 8 : 0); x + 16 <= 218; x += 16) {
      if (spine(x) + 4 <= y && spine(x + 16) + 4 <= y && y + 8 <= -44) {
        scales.push({ x, y, accent: (x / 8 + r) % 5 === 0 });
      }
    }
  }
  return (
    <g>
      <path
        d={`M10 -104C60 -124 120 -120 160 -106C190 -96 212 -82 222 -60L222 -44${hem}Z`}
        fill={art('green')}
        stroke={art('yellow')}
        strokeWidth="2.4"
        strokeLinejoin="round"
      />
      {scales.map((scale) => (
        <path
          key={`${scale.x}-${scale.y}`}
          d={`M${scale.x} ${scale.y}A8 8 0 0 0 ${scale.x + 16} ${scale.y}`}
          stroke={art(scale.accent ? 'yellow' : 'green2')}
          strokeWidth="2.4"
          fill="none"
          strokeLinecap="round"
        />
      ))}
      {HUMP.map(([px, py], i) => (
        <circle key={px} cx={px} cy={py} r="6.4" fill={art(POMS[i % POMS.length]!)} />
      ))}
      {Array.from({ length: scallops }, (_, i) => {
        const x = 222 - (i + 0.5) * w;
        return (
          <g key={i}>
            <path
              d={`M${n(x)} -33L${n(x)} -26`}
              stroke={art('yellow2')}
              strokeWidth="1.6"
              strokeLinecap="round"
            />
            <circle cx={n(x)} cy="-24" r="3" fill={art(i % 2 ? 'red2' : 'yellow')} />
          </g>
        );
      })}
      <circle cx="228" cy="-72" r="8" fill={art('red2')} />
      <circle cx="236" cy="-60" r="7" fill={art('yellow')} />
      <circle cx="230" cy="-50" r="6.4" fill={art('white')} />
    </g>
  );
}

/** The whole lion: two dancers' legs, the cloth and the head over the front dancer (x -58..238, y -146..0). */
export function LionDance({ x = 0, y = 0, s = 1 }: Pose) {
  return (
    <g transform={place(x, y, s)} data-motif="lion-dance">
      <Leg x={152} tilt={5} />
      <Leg x={192} tilt={-5} />
      <LionCloth />
      <Leg x={-16} tilt={7} />
      <Leg x={20} tilt={-7} />
      <g transform="translate(0 -92)">
        <LionHead />
      </g>
    </g>
  );
}

/** Ong Dia: a big belly, a wide smiling mask and a palm-leaf fan (x -36..76, y -134..0). */
export function OngDia({ x = 0, y = 0, s = 1 }: Pose) {
  return (
    <g transform={place(x, y, s)} data-motif="ong-dia">
      <path d="M-20 -36L-3 -36L-5 -7L-18 -7Z" fill={art('green2')} />
      <path d="M3 -36L20 -36L18 -7L5 -7Z" fill={art('green2')} />
      <ellipse cx="-11" cy="-4" rx="10" ry="4.4" fill={art('ink')} />
      <ellipse cx="11" cy="-4" rx="10" ry="4.4" fill={art('ink')} />
      <path d="M30 -82L50 -100" stroke={art('yellow')} strokeWidth="11" strokeLinecap="round" />
      <path d="M-30 -82L-34 -60" stroke={art('yellow')} strokeWidth="11" strokeLinecap="round" />
      <ellipse cy="-54" rx="32" ry="29" fill={art('skin')} />
      <path
        d="M-28 -90C-40 -82 -38 -54 -32 -48C-14 -42 14 -42 32 -48C38 -54 40 -82 28 -90C14 -96 -14 -96 -28 -90Z"
        fill={art('yellow')}
      />
      <path
        d="M-8 -92L0 -80L8 -92"
        stroke={art('red')}
        strokeWidth="3"
        fill="none"
        strokeLinejoin="round"
      />
      {[
        [-20, -76],
        [-10, -62],
        [12, -64],
        [22, -78],
        [-24, -56],
        [26, -56],
      ].map(([cx, cy]) => (
        <circle key={`${cx}${cy}`} cx={cx} cy={cy} r="2.8" fill={art('red')} />
      ))}
      <path
        d="M-30 -48C-14 -42 14 -42 30 -48"
        stroke={art('yellow2')}
        strokeWidth="2"
        fill="none"
      />
      <circle cy="-34" r="2" fill={art('crust2')} />
      <circle cx="-31" cy="-56" r="6" fill={art('skin')} />
      <circle cx="-34" cy="-52" r="5.6" fill={art('skin')} />
      <circle cx="50" cy="-100" r="6.4" fill={art('skin')} />
      <path d="M50 -100L52 -112" stroke={art('trunk')} strokeWidth="2.6" strokeLinecap="round" />
      <path
        d="M52 -112L42 -136M52 -112L56 -139M52 -112L68 -134M52 -112L36 -124"
        stroke={art('crust')}
        strokeWidth="1.4"
      />
      <path
        d="M52 -112C30 -116 32 -142 44 -140C46 -148 60 -148 62 -138C74 -136 74 -118 52 -112Z"
        fill={art('hat')}
        stroke={art('crust')}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M52 -113L44 -136M52 -113L56 -142M52 -113L66 -133"
        stroke={art('crust')}
        strokeWidth="1.2"
        opacity=".6"
      />
      <circle cx="0" cy="-110" r="25" fill={art('skin')} />
      <circle cx="-25" cy="-110" r="6.4" fill={art('skin')} />
      <circle cx="25" cy="-110" r="6.4" fill={art('skin')} />
      <circle cx="-25" cy="-110" r="3" fill={art('blush')} />
      <circle cx="25" cy="-110" r="3" fill={art('blush')} />
      <path
        d="M-26 -118C-31 -124 -27 -130 -22 -128M26 -118C31 -124 27 -130 22 -128"
        stroke={art('ink')}
        strokeWidth="2.4"
        fill="none"
        strokeLinecap="round"
      />
      <circle cx="-15" cy="-103" r="7.6" fill={art('blush')} opacity=".85" />
      <circle cx="15" cy="-103" r="7.6" fill={art('blush')} opacity=".85" />
      <path
        d="M-14 -115C-11 -119 -6 -119 -4 -115M4 -115C6 -119 11 -119 14 -115"
        stroke={art('ink')}
        strokeWidth="2.4"
        fill="none"
        strokeLinecap="round"
      />
      <ellipse cx="0" cy="-107" rx="4.4" ry="3.2" fill={art('orange2')} />
      <path d="M-17 -101C-11 -86 11 -86 17 -101C8 -96 -8 -96 -17 -101Z" fill={art('red3')} />
      <path d="M-12 -99C-6 -93 6 -93 12 -99L11 -96.4C6 -91 -6 -91 -11 -96.4Z" fill={art('white')} />
    </g>
  );
}

/** A pair of cymbals (nao bat) lying on the ground with red tassels (about 50 wide). */
export function Cymbals({ x = 0, y = 0, s = 1 }: Pose) {
  const disc = (cx: number, cy: number, r: number) => (
    <g>
      <circle cx={cx} cy={cy} r={r} fill={art('yellow')} stroke={art('yellow2')} strokeWidth="2" />
      <circle
        cx={cx}
        cy={cy}
        r={r * 0.62}
        fill={art('yellow3')}
        stroke={art('yellow2')}
        strokeWidth="1.2"
      />
      <circle cx={cx} cy={cy} r={r * 0.2} fill={art('yellow2')} />
    </g>
  );
  return (
    <g transform={place(x, y, s)} data-motif="drum-cymbals">
      {disc(-18, -18, 19)}
      {disc(14, -22, 19)}
      <path
        d="M-18 -18C-22 -4 -28 2 -24 10M14 -22C20 -8 22 2 26 10"
        stroke={art('red')}
        strokeWidth="2.6"
        fill="none"
        strokeLinecap="round"
      />
      <circle cx="-24" cy="11" r="3.6" fill={art('red')} />
      <circle cx="26" cy="11" r="3.6" fill={art('red')} />
    </g>
  );
}
