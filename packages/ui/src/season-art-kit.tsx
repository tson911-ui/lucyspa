import type { CSSProperties, ReactNode, SVGAttributes } from 'react';
import { cx } from './cx';

// Shared helpers of the site-wide season art (docs/UXUI_REDESIGN_S6_PLAN.md section 3): a decorative SVG wrapper and
// the color accessor. Art never carries a color of its own: every color is `var(--ls-art-<name>)`, a token that
// season.css sets per preset and theme, so a kit follows light and dark and tests can check its palette.

/** `art('panelText')` is `var(--ls-art-panel-text)`; keys are camelCase like the registry. */
export const art = (key: string): string =>
  `var(--ls-art-${key.replace(/[A-Z0-9]/g, (char) => `-${char.toLowerCase()}`)})`;

/** Two decimals, no trailing zeros: stable SVG numbers on the server and the client. */
export const n = (value: number): string => value.toFixed(2).replace(/\.?0+$/, '');

/** The one prop of a placed drawing: the class that positions it (season-art.css). */
export interface ArtProps {
  className?: string | undefined;
}

/** A decorative SVG: hidden from assistive technology, never focusable, never takes the pointer. */
export function ArtSvg({
  viewBox,
  className,
  preserveAspectRatio,
  style,
  motif,
  children,
}: {
  viewBox: string;
  className?: string | undefined;
  preserveAspectRatio?: SVGAttributes<SVGSVGElement>['preserveAspectRatio'];
  style?: CSSProperties | undefined;
  /** The iconic motif(s) this drawing is (space-separated ids of SEASON_MOTIFS), for tests and review. */
  motif?: string | undefined;
  children: ReactNode;
}) {
  return (
    <svg
      className={cx('ls-art', className)}
      viewBox={viewBox}
      preserveAspectRatio={preserveAspectRatio}
      style={style}
      data-motif={motif}
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}
