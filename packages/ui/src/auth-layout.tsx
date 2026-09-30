import { useId, type ReactNode } from 'react';

// One sprig: a curved stem with five leaves that shrink toward the tip. Drawn in a 120 x 190 box.
const STEM = 'M20 180C30 130 55 95 100 70';
const LEAF = 'M0 0C7-9 19-9 28 0C19 9 7 9 0 0ZM3 0H25';
const LEAVES: ReadonlyArray<{ x: number; y: number; angle: number; scale: number }> = [
  { x: 27.8, y: 151.8, angle: -120, scale: 1 },
  { x: 39.5, y: 126.9, angle: -10, scale: 0.95 },
  { x: 55.3, y: 105.1, angle: -99, scale: 0.9 },
  { x: 75.4, y: 86.2, angle: 12, scale: 0.8 },
  { x: 100, y: 70, angle: -29, scale: 0.7 },
];
const BUDS: ReadonlyArray<readonly [number, number]> = [
  [178, 196],
  [52, 44],
  [205, 28],
];

/**
 * Botanical line art as a tiling SVG pattern. Stroke only, in `currentColor`; the parent sets the
 * color and a low opacity. No image file, so it renders in both themes and costs no request.
 */
export function BotanicalPattern({ className }: { className?: string | undefined }) {
  const key = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const sprig = `sprig-${key}`;
  const tile = `tile-${key}`;
  return (
    <svg className={className} aria-hidden focusable="false">
      <defs>
        <g
          id={sprig}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.25}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d={STEM} />
          {LEAVES.map((leaf) => (
            <path
              key={`${leaf.x}-${leaf.y}`}
              d={LEAF}
              transform={`translate(${leaf.x} ${leaf.y}) rotate(${leaf.angle}) scale(${leaf.scale})`}
            />
          ))}
        </g>
        <pattern
          id={tile}
          width={240}
          height={240}
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(-18)"
        >
          <use href={`#${sprig}`} transform="translate(10 10)" />
          <use href={`#${sprig}`} transform="rotate(180 120 120) translate(10 10)" />
          <g fill="none" stroke="currentColor" strokeWidth={1.25}>
            {BUDS.map(([cx, cy]) => (
              <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={2.5} />
            ))}
          </g>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${tile})`} />
    </svg>
  );
}

/**
 * Sign-in and recovery pages (contract 12.6, Owner correction after Step 5): the centered card of
 * before, on a full-screen brand background (deep brand-red gradient plus botanical line art, the same
 * in light and dark). The wordmark sits at the top inside the card; the language switch and theme
 * toggle sit at the top right of the page, styled for the red background. The card keeps the normal
 * surface tokens (light card in light mode, dark card in dark mode). The background is decoration and
 * hidden from assistive technology; a photo can replace it later.
 */
export function AuthLayout({
  brand,
  topActions,
  children,
}: {
  /** The wordmark, rendered at the top of the card. */
  brand: ReactNode;
  /** Language switch and theme toggle, top right of the page. */
  topActions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="ls-auth">
      <BotanicalPattern className="ls-auth-pattern" />
      <div className="ls-auth-top">{topActions}</div>
      <main className="ls-auth-main" id="main-content" tabIndex={-1}>
        <div className="ls-auth-card">
          <div className="ls-auth-card-brand">{brand}</div>
          {children}
        </div>
      </main>
    </div>
  );
}
