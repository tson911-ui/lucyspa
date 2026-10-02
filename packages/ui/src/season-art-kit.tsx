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

/**
 * Which window of a 1440 x 300 footer panorama a drawing shows. `all` is the wide picture (cropped to its centre by
 * the box it sits in); on a phone the same scene is drawn as `mid` (the centre, 720 wide) over `start` and `end` (the
 * two sides, side by side), two rows at the same half scale, so no motif is cropped away.
 */
export type ScenePart = 'all' | 'mid' | 'start' | 'end';

export interface SceneProps extends ArtProps {
  part?: ScenePart | undefined;
  /** Phone windows: `start` is the first `split` units, `mid` the next 720, `end` the rest (see `PHONE_SPLITS`). */
  split?: number | undefined;
}

export const SCENE_WIDTH = 1440;
export const SCENE_MID_WIDTH = SCENE_WIDTH / 2;
/** The left window width that keeps the two cuts (at `split` and `split + 720`) in gaps between motifs. */
export const SCENE_SPLIT = 360;

export function sceneView(
  part: ScenePart = 'all',
  split: number = SCENE_SPLIT,
): {
  viewBox: string;
  preserveAspectRatio: SVGAttributes<SVGSVGElement>['preserveAspectRatio'];
} {
  const height = 300;
  const meet = 'xMidYMax meet';
  const end = split + SCENE_MID_WIDTH;
  switch (part) {
    case 'mid':
      return { viewBox: `${split} 0 ${SCENE_MID_WIDTH} ${height}`, preserveAspectRatio: meet };
    case 'start':
      return { viewBox: `0 0 ${split} ${height}`, preserveAspectRatio: meet };
    case 'end':
      return {
        viewBox: `${end} 0 ${SCENE_WIDTH - end} ${height}`,
        preserveAspectRatio: meet,
      };
    default:
      return { viewBox: `0 0 ${SCENE_WIDTH} ${height}`, preserveAspectRatio: 'xMidYMax slice' };
  }
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
