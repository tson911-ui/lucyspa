import type { ReactNode } from 'react';
import { ArtSvg, art, n } from './season-art-kit';

// Tet kit (docs/UXUI_REDESIGN_S6_PLAN.md section 4): lanterns, mai and peach blossoms, li xi, paper firecrackers, coins
// and the zodiac animal. Every color is a `--ls-art-*` token of the `tet` preset (contracts registry); yellow exists
// here by the Q-S1 exception. Decoration only: aria-hidden, nothing focusable, no image, no request.
//
// Rule for every zodiac animal added here (Owner, 2026-10-02): clear Tet style, that is red and yellow ao or khan,
// cau doi or li xi, mai and peach blossoms, coins and a festive pose.

/** A mai (yellow, five round petals) or peach (pink) blossom centred on (cx, cy) with a diameter of `size`. */
export function Blossom({
  cx,
  cy,
  size,
  kind,
}: {
  cx: number;
  cy: number;
  size: number;
  kind: 'mai' | 'peach';
}) {
  const [outer, inner, centre] =
    kind === 'mai'
      ? [art('mai'), art('mai2'), art('maiCentre')]
      : [art('peach'), art('peach2'), art('red3')];
  const radius = kind === 'mai' ? 8.6 : 8.2;
  return (
    <g transform={`translate(${n(cx)} ${n(cy)}) scale(${n(size / 40)})`}>
      {[0, 72, 144, 216, 288].map((angle) => (
        <circle key={angle} cx="0" cy="-9" r={radius} transform={`rotate(${angle})`} fill={outer} />
      ))}
      {[0, 72, 144, 216, 288].map((angle) => (
        <circle
          key={`i${angle}`}
          cx="0"
          cy="-7.8"
          r={radius / 2}
          transform={`rotate(${angle})`}
          fill={inner}
          opacity=".85"
        />
      ))}
      {Array.from({ length: 7 }, (_, index) => (
        <path
          key={index}
          d={`M0 0L${n(Math.cos(index * 0.9) * 6.5)} ${n(Math.sin(index * 0.9) * 6.5)}`}
          stroke={centre}
          strokeWidth="1"
          strokeLinecap="round"
        />
      ))}
      <circle r="3.4" fill={centre} />
    </g>
  );
}

/** A red paper lantern on a short string, with a yellow cap, emblem and tassel (48 x 106). */
export function TetLantern({ className }: { className?: string }) {
  return (
    <ArtSvg viewBox="0 0 48 106" className={className}>
      <path d="M24 0V12" stroke={art('cord')} strokeWidth="1.6" />
      <rect x="15" y="11" width="18" height="6" rx="2.5" fill={art('yellow')} />
      <path
        d="M24 16C6 16 0 33 0 46C0 60 7 75 24 75C41 75 48 60 48 46C48 33 42 16 24 16Z"
        fill={art('red')}
      />
      <path
        d="M24 16C15 23 11 34 11 46C11 60 15 69 24 75C33 69 37 60 37 46C37 34 33 23 24 16Z"
        fill={art('red2')}
      />
      <path d="M24 16V75" stroke={art('yellow2')} strokeWidth="1.4" />
      <path
        d="M3 34C14 40 34 40 45 34M1 52C13 59 35 59 47 52"
        stroke={art('yellow2')}
        strokeWidth="1.2"
        fill="none"
        opacity=".8"
      />
      <circle cx="24" cy="45" r="8.5" fill={art('yellow')} />
      {[0, 90, 180, 270].map((angle) => (
        <ellipse
          key={angle}
          cx="24"
          cy="39.2"
          rx="2.3"
          ry="3.6"
          transform={`rotate(${angle} 24 45)`}
          fill={art('red3')}
        />
      ))}
      <circle cx="24" cy="45" r="2" fill={art('yellow3')} />
      <rect x="15" y="73" width="18" height="6" rx="2.5" fill={art('yellow')} />
      <path d="M24 79V86" stroke={art('yellow')} strokeWidth="2" />
      <circle cx="24" cy="87" r="2.8" fill={art('yellow')} />
      <path
        d="M24 89L18 102M24 89V104M24 89L30 102"
        stroke={art('red')}
        strokeWidth="2"
        strokeLinecap="round"
      />
    </ArtSvg>
  );
}

/** The mai branch of the top-left corner: a branch with three twigs, leaves, blossoms and buds (220 x 120). */
export function TetMaiBranch({ className }: { className?: string }) {
  const blossoms: Array<['mai' | 'peach', number, number, number]> = [
    ['mai', 43, 51, 34],
    ['mai', 52, 66, 28],
    ['mai', 100, 58, 36],
    ['peach', 119, 17, 30],
    ['mai', 149, 71, 34],
    ['peach', 134, 96, 28],
    ['mai', 185, 99, 30],
    ['mai', 199, 59, 26],
    ['peach', 65, 15, 26],
  ];
  return (
    <ArtSvg viewBox="0 0 220 120" className={className}>
      <path
        d="M-4 8C40 12 74 28 108 50C140 70 174 84 214 100"
        stroke={art('wood')}
        strokeWidth="6"
        fill="none"
        strokeLinecap="round"
      />
      {[
        'M36 14C44 30 42 48 50 62',
        'M84 36C98 30 114 32 126 24',
        'M128 62C132 78 128 92 136 104',
        'M168 80C180 70 196 70 206 62',
      ].map((d, index) => (
        <path
          key={d}
          d={d}
          stroke={art('wood')}
          strokeWidth={index === 3 ? 2.6 : 3.2}
          fill="none"
          strokeLinecap="round"
        />
      ))}
      {(
        [
          [60, 26, -30],
          [96, 18, 20],
          [150, 44, -10],
          [190, 92, 30],
          [20, 30, 10],
          [176, 64, 0],
        ] as const
      ).map(([x, y, rotation]) => (
        <ellipse
          key={`${x}-${y}`}
          cx={x}
          cy={y}
          rx="9"
          ry="3.6"
          transform={`rotate(${rotation} ${x} ${y})`}
          fill={art('leaf')}
        />
      ))}
      {blossoms.map(([kind, cx, cy, size]) => (
        <Blossom key={`${cx}-${cy}`} kind={kind} cx={cx} cy={cy} size={size} />
      ))}
      {(
        [
          [16, 40],
          [70, 60],
          [112, 34],
          [142, 50],
          [162, 100],
          [198, 74],
          [76, 22],
        ] as const
      ).map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r="3" fill={art('mai')} />
      ))}
    </ArtSvg>
  );
}

/** A small mai sprig that sits at the end of the wordmark (96 x 60). */
export function TetSprig({ className }: { className?: string }) {
  return (
    <ArtSvg viewBox="0 0 96 60" className={className}>
      <path
        d="M2 58C20 50 40 40 60 28S84 10 94 6"
        stroke={art('wood')}
        strokeWidth="4"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M38 42C42 32 40 24 34 18"
        stroke={art('wood')}
        strokeWidth="2.6"
        fill="none"
        strokeLinecap="round"
      />
      <ellipse cx="22" cy="46" rx="8" ry="3.2" transform="rotate(-24 22 46)" fill={art('leaf')} />
      <ellipse cx="62" cy="22" rx="8" ry="3.2" transform="rotate(-40 62 22)" fill={art('leaf')} />
      <Blossom kind="mai" cx={61} cy={33} size={30} />
      <Blossom kind="mai" cx={81} cy={9} size={26} />
      <Blossom kind="peach" cx={29} cy={15} size={26} />
      <circle cx="30" cy="38" r="2.6" fill={art('mai')} />
      <circle cx="84" cy="20" r="2.4" fill={art('mai')} />
    </ArtSvg>
  );
}

/** A coin with a square hole (centre at the origin of its group). */
function Coin({ x, y, r }: { x: number; y: number; r: number }) {
  return (
    <g transform={`translate(${n(x)} ${n(y)})`}>
      <circle r={r} fill={art('yellow')} />
      <circle r={n(r * 0.82)} fill="none" stroke={art('yellow2')} strokeWidth="1.4" />
      <rect
        x={n(-r * 0.28)}
        y={n(-r * 0.28)}
        width={n(r * 0.56)}
        height={n(r * 0.56)}
        fill="var(--ls-bg-page)"
        stroke={art('yellow2')}
        strokeWidth="1.2"
      />
    </g>
  );
}

function Envelope({ x, y, rotation }: { x: number; y: number; rotation: number }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rotation})`}>
      <rect width="64" height="92" rx="7" fill={art('red')} />
      <path d="M0 14C0 6 3 0 11 0H53C61 0 64 6 64 14L32 44Z" fill={art('red3')} />
      <rect
        x="5"
        y="5"
        width="54"
        height="82"
        rx="4"
        fill="none"
        stroke={art('yellow')}
        strokeWidth="1.6"
      />
      <circle cx="32" cy="58" r="14" fill={art('yellow')} />
      {[0, 72, 144, 216, 288].map((angle) => (
        <ellipse
          key={angle}
          cx="32"
          cy="50"
          rx="3.6"
          ry="6"
          transform={`rotate(${angle} 32 58)`}
          fill={art('red3')}
        />
      ))}
      <circle cx="32" cy="58" r="3.2" fill={art('yellow3')} />
    </g>
  );
}

/** Three li xi envelopes fanned over a few coins: the bottom-left corner group (136 x 128). */
export function TetEnvelopes({ className }: { className?: string }) {
  return (
    <ArtSvg viewBox="0 0 136 128" className={className}>
      <Envelope x={4} y={30} rotation={-14} />
      <Envelope x={38} y={14} rotation={2} />
      <Envelope x={72} y={30} rotation={16} />
      <Coin x={14} y={116} r={11} />
      <Coin x={40} y={122} r={9} />
      <Coin x={64} y={114} r={10} />
    </ArtSvg>
  );
}

/** A hung string of paper firecrackers with a yellow hook and a red bow; `rolls` sets its length. */
export function TetCrackers({ rolls, className }: { rolls: number; className?: string }) {
  const length = 24 + rolls * 27;
  return (
    <ArtSvg viewBox={`-32 -20 64 ${length + 30}`} className={className}>
      <path d={`M0 -8V${length}`} stroke={art('yellow2')} strokeWidth="2.4" />
      <circle cy="-10" r="5" fill="none" stroke={art('yellow')} strokeWidth="2.6" />
      <path
        d="M0 0C-14 -8 -22 4 -10 8C-4 10 0 4 0 4C0 4 4 10 10 8C22 4 14 -8 0 0Z"
        fill={art('red')}
      />
      <circle cy="3" r="3.6" fill={art('red3')} />
      <path d="M-3 6L-12 22M3 6L12 22" stroke={art('red')} strokeWidth="3" strokeLinecap="round" />
      {Array.from({ length: rolls }, (_, index) => {
        const side = index % 2 ? 1 : -1;
        return (
          <g key={index} transform={`translate(0 ${24 + index * 27}) rotate(${side * 14})`}>
            <rect x="-8" y="-3" width="16" height="30" rx="5" fill={art('red')} />
            <rect x="-8" y="-3" width="6" height="30" rx="3" fill={art('red2')} opacity=".75" />
            <rect x="-8.5" y="5" width="17" height="4.4" fill={art('yellow')} />
            <rect x="-8.5" y="16" width="17" height="4.4" fill={art('yellow')} />
            <path
              d={`M${side * 2} -3C${side * 2} -9 ${side * 8} -9 ${side * 9} -13`}
              stroke={art('cream2')}
              strokeWidth="1.6"
              fill="none"
            />
          </g>
        );
      })}
    </ArtSvg>
  );
}

/** Divider centrepiece: a coin between two blossoms and two beads (160 x 28). */
export function TetDividerArt({ className }: { className?: string }) {
  return (
    <ArtSvg viewBox="0 0 160 28" className={className}>
      <Coin x={80} y={14} r={11} />
      <Blossom kind="mai" cx={44} cy={14} size={26} />
      <Blossom kind="peach" cx={116} cy={14} size={26} />
      <circle cx="4" cy="14" r="3" fill={art('yellow')} />
      <circle cx="156" cy="14" r="3" fill={art('yellow')} />
    </ArtSvg>
  );
}

/** The footer band: a solid panel with a scalloped top edge (24 scallops, stretched to the width). */
export function TetBand({ className }: { className?: string }) {
  const scallops = 24;
  const top = 22;
  const path =
    `M0 ${top}` +
    Array.from(
      { length: scallops },
      (_, index) =>
        `Q${n(((index + 0.5) * 1440) / scallops)} 0 ${n(((index + 1) * 1440) / scallops)} ${top}`,
    ).join('') +
    `V120H0Z`;
  return (
    <ArtSvg viewBox="0 0 1440 120" preserveAspectRatio="none" className={className}>
      <path d={path} fill={art('panel')} />
    </ArtSvg>
  );
}

// ------------------------------------------------------------------------------- zodiac

/**
 * The Goat (Mui, Dinh Mui 2027) in Tet style: a red khan with a bell and tassel, yellow horns, a li xi held at the
 * hoof, coins and a peach and a mai blossom, standing on a yellow ingot (176 x 156).
 */
export function ZodiacGoat({ className }: { className?: string }) {
  return (
    <ArtSvg viewBox="0 0 176 156" className={className}>
      <path
        d="M10 140C26 130 150 130 166 140C158 152 132 154 88 154C44 154 18 152 10 140Z"
        fill={art('yellow2')}
      />
      <path d="M26 135C50 128 126 128 150 135C140 143 36 143 26 135Z" fill={art('yellow')} />
      <Coin x={56} y={140} r={5} />
      <Coin x={72} y={142} r={5} />
      <Coin x={98} y={141} r={5} />
      <rect x="50" y="104" width="12" height="29" rx="5" fill={art('cream2')} />
      <rect x="64" y="106" width="12" height="27" rx="5" fill={art('cream')} />
      <rect x="100" y="106" width="12" height="27" rx="5" fill={art('cream2')} />
      <rect x="114" y="104" width="12" height="29" rx="5" fill={art('cream')} />
      {[50, 64, 100, 114].map((x) => (
        <rect key={x} x={x} y="127" width="12" height="7" rx="3" fill={art('wood')} />
      ))}
      <path d="M42 88C32 86 26 76 31 68C36 74 42 78 46 84Z" fill={art('cream')} />
      <ellipse cx="86" cy="96" rx="50" ry="29" fill={art('cream')} />
      <path d="M38 106C60 126 114 126 136 106C120 116 54 116 38 106Z" fill={art('cream2')} />
      <path d="M112 84C116 66 122 58 130 54L148 76C142 94 130 106 114 108Z" fill={art('cream')} />
      <path
        d="M132 40C126 22 108 14 96 22"
        stroke={art('yellow2')}
        strokeWidth="7"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M140 38C142 20 128 8 112 10"
        stroke={art('yellow')}
        strokeWidth="7"
        fill="none"
        strokeLinecap="round"
      />
      <ellipse cx="118" cy="56" rx="15" ry="6" transform="rotate(20 118 56)" fill={art('cream2')} />
      <ellipse cx="119" cy="57" rx="9" ry="3.4" transform="rotate(20 119 57)" fill={art('blush')} />
      <ellipse cx="138" cy="58" rx="21" ry="18" fill={art('cream')} />
      <ellipse cx="151" cy="66" rx="12" ry="10" fill={art('cream2')} />
      <ellipse cx="158" cy="64" rx="3.2" ry="2.4" fill={art('wood')} />
      <path
        d="M150 71Q154 73 158 70"
        stroke={art('wood')}
        strokeWidth="1.6"
        fill="none"
        strokeLinecap="round"
      />
      <circle cx="140" cy="53" r="3.4" fill={art('ink')} />
      <circle cx="141.2" cy="51.8" r="1.1" fill={art('white')} />
      <ellipse cx="134" cy="64" rx="5" ry="3.2" fill={art('blush')} opacity=".75" />
      <path d="M150 77L155 94L145 79Z" fill={art('cream2')} />
      <path d="M110 84C122 94 140 90 148 78L151 88C142 102 122 104 108 96Z" fill={art('red')} />
      <path
        d="M112 90C122 98 134 97 142 90"
        stroke={art('yellow')}
        strokeWidth="1.6"
        fill="none"
        strokeDasharray="3 3"
      />
      <path d="M120 96L116 112L124 108L128 100Z" fill={art('red3')} />
      <circle cx="132" cy="100" r="5" fill={art('yellow')} />
      <path d="M132 105V108" stroke={art('yellow2')} strokeWidth="1.6" />
      <g transform="translate(136 108) rotate(14) scale(.34)">
        <Envelope x={0} y={0} rotation={0} />
      </g>
      <Blossom kind="peach" cx={35} cy={111} size={30} />
      <Blossom kind="mai" cx={22} cy={96} size={24} />
    </ArtSvg>
  );
}

/** Art for the animals that have it. Anything else draws no animal, never a wrong one. */
export const ZODIAC_ART: Readonly<Record<string, (props: { className?: string }) => ReactNode>> = {
  mui: ZodiacGoat,
};

/** A falling petal: mai (yellow) or peach (pink), alternating by index (16 x 16). */
export function TetPetal({ index }: { index: number }) {
  const fill = index % 2 === 0 ? art('mai') : art('peach');
  return (
    <svg className="ls-fx-site-glyph" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M8 1C13 5 13 11 8 15C3 11 3 5 8 1Z" fill={fill} />
      <path
        d="M8 4C10 6 10 10 8 12"
        stroke={art('white')}
        strokeWidth="1"
        fill="none"
        opacity=".6"
      />
    </svg>
  );
}
