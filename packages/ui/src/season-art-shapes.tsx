import type { CSSProperties, ReactNode } from 'react';
import { ArtSvg, art, n } from './season-art-kit';
import { starPoints } from './season-ornaments';

// Drawing primitives shared by the S6d/S6e kits (Valentine, 8/3, 20/10, Mid-Autumn, 30/4-1/5, 2/9, Vu Lan). Every
// shape is a `<g>` centred on (0, 0) that takes palette key names (`art('rose')` is `var(--ls-art-rose)`), never a
// color of its own, so one drawing follows each kit's palette, light and dark. Decoration only (the callers wrap them
// in an `ArtSvg`).

/** `translate(x y) rotate(r) scale(s)`, trimmed. */
export const place = (x: number, y: number, scale = 1, rotate = 0): string =>
  `translate(${n(x)} ${n(y)})${rotate ? ` rotate(${n(rotate)})` : ''}${scale === 1 ? '' : ` scale(${n(scale)})`}`;

interface Placed {
  x?: number;
  y?: number;
  s?: number;
  r?: number;
  /** Mirror left to right. */
  flip?: boolean;
}

/** The `transform` of a placed shape: flip first, so the shape mirrors around its own centre. */
const at = ({ x = 0, y = 0, s = 1, r = 0, flip = false }: Placed): string =>
  `${place(x, y, s, r)}${flip ? ' scale(-1 1)' : ''}`;

/** A heart about 48 wide and 32 high. */
export function Heart({
  fill,
  shine = 'white',
  ...pose
}: Placed & { fill: string; shine?: string }) {
  return (
    <g transform={at(pose)}>
      <path
        d="M0 16C-24 2 -20 -16 -9 -16C-4 -16 -1 -12 0 -9C1 -12 4 -16 9 -16C20 -16 24 2 0 16Z"
        fill={art(fill)}
      />
      <path
        d="M-15 -5C-15 -10 -11 -12.5 -7.5 -11.5"
        stroke={art(shine)}
        strokeWidth="2.6"
        strokeLinecap="round"
        fill="none"
        opacity=".55"
      />
    </g>
  );
}

/** A rose seen from above, about 30 across: outer petals, a ring of petals, the swirl of the bud. */
export function Rose({
  c = 'rose',
  c2 = 'rose2',
  c3 = 'rose3',
  ...pose
}: Placed & { c?: string; c2?: string; c3?: string }) {
  return (
    <g transform={at(pose)}>
      <circle r="15" fill={art(c3)} />
      {[0, 1, 2, 3, 4].map((index) => {
        const angle = (index * 72 - 90) * (Math.PI / 180);
        return (
          <ellipse
            key={index}
            cx={n(Math.cos(angle) * 9)}
            cy={n(Math.sin(angle) * 9)}
            rx="7.4"
            ry="6.6"
            transform={`rotate(${index * 72} ${n(Math.cos(angle) * 9)} ${n(Math.sin(angle) * 9)})`}
            fill={art(c2)}
          />
        );
      })}
      <circle r="9.4" fill={art(c)} />
      <path
        d="M0.5 0.5C3 0 3.6 -3 1 -4.2C-2.6 -5.6 -6 -2.6 -5.4 1C-4.6 5.4 0.4 7.6 4.6 5.2C8 3.2 8.6 -2.4 5.4 -5.6"
        stroke={art(c3)}
        strokeWidth="1.6"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M-9 -4C-8 -9.5 -3 -12 1 -11.6"
        stroke={art(c3)}
        strokeWidth="1.2"
        fill="none"
        strokeLinecap="round"
        opacity=".6"
      />
    </g>
  );
}

/** A leaf pointing right from (0, 0): 30 long. */
export function Leaf({ fill, vein, ...pose }: Placed & { fill: string; vein?: string }) {
  return (
    <g transform={at(pose)}>
      <path d="M0 0C8 -9 22 -9 30 0C22 9 8 9 0 0Z" fill={art(fill)} />
      {vein ? <path d="M2 0L26 0" stroke={art(vein)} strokeWidth="1.2" opacity=".5" /> : null}
    </g>
  );
}

/** A bow with two tails, about 36 wide. */
export function Bow({ c, c2, ...pose }: Placed & { c: string; c2: string }) {
  return (
    <g transform={at(pose)}>
      <path d="M0 2C-4 12 -8 20 -12 24L-5 22L-2 28Z" fill={art(c2)} />
      <path d="M0 2C4 12 8 20 12 24L5 22L2 28Z" fill={art(c2)} />
      <path d="M0 0C-8 -12 -22 -10 -18 0C-15 8 -4 4 0 0Z" fill={art(c)} />
      <path d="M0 0C8 -12 22 -10 18 0C15 8 4 4 0 0Z" fill={art(c)} />
      <circle r="4.4" fill={art(c2)} />
    </g>
  );
}

/** A gift box with a lid and a bow on top: `w` x `h` body, its origin at the top-left of the body. */
export function GiftBox({
  w,
  h,
  body,
  band,
  bow,
  x = 0,
  y = 0,
}: {
  w: number;
  h: number;
  body: string;
  band: string;
  bow?: string;
  x?: number;
  y?: number;
}) {
  return (
    <g transform={place(x, y)}>
      <rect width={w} height={h} rx="3" fill={art(body)} />
      <rect x="-3" y="-6" width={w + 6} height="12" rx="3" fill={art(body)} />
      <rect x="-3" y="-6" width={w + 6} height="4" rx="2" fill={art('white')} opacity=".28" />
      <rect x={w / 2 - 3.5} y="-6" width="7" height={h + 6} fill={art(band)} />
      <path
        d={`M${w / 2} -6C${w / 2 - 14} -22 ${w / 2 - 22} -6 ${w / 2} -6C${w / 2 + 22} -6 ${w / 2 + 14} -22 ${w / 2} -6Z`}
        fill={art(bow ?? band)}
      />
    </g>
  );
}

/** A five-point star centred on (0, 0) with an outer radius `r`. */
export function Star({ fill, r = 10, ...pose }: Placed & { fill: string; r?: number }) {
  return (
    <g transform={at(pose)}>
      <polygon points={starPoints(0, 0, r, r * 0.42)} fill={art(fill)} />
    </g>
  );
}

/** A four-ray sparkle, `r` from the centre to each tip. */
export function Sparkle({ fill, r = 8, ...pose }: Placed & { fill: string; r?: number }) {
  const k = r * 0.22;
  return (
    <g transform={at(pose)}>
      <path
        d={`M0 ${-r}C${k} ${-k} ${k} ${-k} ${r} 0C${k} ${k} ${k} ${k} 0 ${r}C${-k} ${k} ${-k} ${k} ${-r} 0C${-k} ${-k} ${-k} ${-k} 0 ${-r}Z`}
        fill={art(fill)}
      />
    </g>
  );
}

/**
 * A lotus bloom in side view, about 56 wide and 40 high, resting on (0, 0): two rows of pointed petals fanned out,
 * the outer row in `c2`, the inner in `c`, with a pale tip.
 */
export function Lotus({ c, c2, tip, ...pose }: Placed & { c: string; c2: string; tip?: string }) {
  const petal = 'M0 0C-9 -8 -9 -24 0 -38C9 -24 9 -8 0 0Z';
  return (
    <g transform={at(pose)}>
      {[-64, 64].map((angle) => (
        <path key={angle} d={petal} transform={`rotate(${angle})`} fill={art(c2)} />
      ))}
      {[-34, 34].map((angle) => (
        <path key={angle} d={petal} transform={`rotate(${angle}) scale(.94)`} fill={art(c)} />
      ))}
      <path d={petal} fill={art(c)} />
      <path d="M0 -34C-3 -26 -3 -18 0 -10C3 -18 3 -26 0 -34Z" fill={art(tip ?? c2)} opacity=".6" />
      <path d="M-12 -2C-6 4 6 4 12 -2C6 0 -6 0 -12 -2Z" fill={art(c2)} />
    </g>
  );
}

/** A round lotus leaf seen at an angle: an ellipse `rx` wide with a few ribs. */
export function LotusLeaf({
  fill,
  rib,
  rx = 40,
  ...pose
}: Placed & { fill: string; rib: string; rx?: number }) {
  const ry = rx * 0.34;
  return (
    <g transform={at(pose)}>
      <ellipse rx={rx} ry={ry} fill={art(fill)} />
      {[-0.7, -0.35, 0, 0.35, 0.7].map((t) => (
        <path
          key={t}
          d={`M0 0L${n(rx * t * 1.2)} ${n(ry * (1 - Math.abs(t) * 0.35) * (t < 0 ? -1 : 1) * 0.9)}`}
          stroke={art(rib)}
          strokeWidth="1.1"
          opacity=".45"
        />
      ))}
    </g>
  );
}

/** A swallow-tailed or plain flag of Vietnam: red field, yellow star; `w` x `h`, origin at the top-left. */
export function Flag({
  w,
  h,
  field,
  star,
  x = 0,
  y = 0,
  r = 0,
}: {
  w: number;
  h: number;
  field: string;
  star: string;
  x?: number;
  y?: number;
  r?: number;
}) {
  return (
    <g transform={place(x, y, 1, r)}>
      <path d={`M0 0L${w} 0L${w} ${h}L0 ${h}Z`} fill={art(field)} />
      <g transform={place(w / 2, h / 2)}>
        <polygon points={starPoints(0, 0, h * 0.34, h * 0.14)} fill={art(star)} />
      </g>
    </g>
  );
}

/** A hanging cell of a header rail: the string drops from the top to the item, which `children` draw. */
export function Hang({
  width,
  height,
  stringTo,
  stringColor,
  children,
  className,
}: {
  width: number;
  height: number;
  stringTo: number;
  stringColor: string;
  children: ReactNode;
  className?: string | undefined;
}) {
  return (
    <ArtSvg viewBox={`0 0 ${width} ${height}`} className={className}>
      <path
        d={`M${width / 2} 0L${width / 2} ${stringTo}`}
        stroke={art(stringColor)}
        strokeWidth="1.4"
        fill="none"
      />
      {children}
    </ArtSvg>
  );
}

/** The rail's cells in a flex row of equal columns (`RailRow`); `hide` drops a cell on tablets or phones. */
export interface RailCell {
  node: ReactNode;
  hide?: 'narrow' | 'medium';
}

export function RailRow({
  cells,
  align = 'top',
  height,
}: {
  cells: readonly RailCell[];
  align?: 'top' | 'bottom';
  /** Share of the header row's height each drawing takes (0 to 1). */
  height: number;
}) {
  return (
    <div
      className="ls-art-rail"
      data-align={align}
      style={{ '--ls-art-rail-h': height } as CSSProperties}
    >
      {cells.map((cell, index) => (
        <div
          key={index}
          className={`ls-art-rail-cell${cell.hide === 'narrow' ? ' ls-art-hide-narrow' : cell.hide === 'medium' ? ' ls-art-hide-medium' : ''}`}
        >
          {cell.node}
        </div>
      ))}
    </div>
  );
}

/** A cord across the row that the rail's pieces hang from (percent width, so it follows any width). */
export function RailCord({ color, sag = 6 }: { color: string; sag?: number }) {
  return (
    <ArtSvg viewBox="0 0 100 10" preserveAspectRatio="none" className="ls-art-cord">
      <path
        d={`M0 1Q50 ${1 + sag} 100 1`}
        stroke={art(color)}
        strokeWidth="2.2"
        fill="none"
        vectorEffect="non-scaling-stroke"
      />
    </ArtSvg>
  );
}
