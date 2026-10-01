// Pure rules of the homepage slider (docs/UXUI_REDESIGN_DESIGN.md 16.6), kept out of the component so they
// are tested without a DOM.

/** The slider advances by itself every 6 seconds (Q-CM7). */
export const SLIDER_AUTOPLAY_MS = 6_000;
/** A horizontal swipe shorter than this many pixels is a tap or a scroll, not a slide change. */
export const SWIPE_MIN_PX = 40;

/** The slide that comes `delta` places after `index`, wrapping around the ends. */
export function stepIndex(index: number, count: number, delta: number): number {
  if (count <= 0) return 0;
  return (((index + delta) % count) + count) % count;
}

/**
 * What a touch gesture means: `1` (next) when the finger moved left, `-1` (previous) when it moved right,
 * `0` when it moved too little or mostly up and down (the page is scrolling).
 */
export function swipeDelta(dx: number, dy: number, minimum = SWIPE_MIN_PX): -1 | 0 | 1 {
  if (Math.abs(dx) < minimum || Math.abs(dx) < Math.abs(dy) * 1.5) return 0;
  return dx < 0 ? 1 : -1;
}

/**
 * Whether the slider moves by itself. Never for a single slide, never when the visitor prefers reduced
 * motion, and not while the visitor has paused it, hovers it, has keyboard focus inside it or touches it.
 */
export function isAutoplaying(state: {
  count: number;
  reducedMotion: boolean;
  userPaused: boolean;
  hovering: boolean;
  focused: boolean;
  touching: boolean;
}): boolean {
  return (
    state.count > 1 &&
    !state.reducedMotion &&
    !state.userPaused &&
    !state.hovering &&
    !state.focused &&
    !state.touching
  );
}

/** The recommended image sizes of Q-CM7, shown as a hint in the admin. */
export const SLIDER_IMAGE_HINT = Object.freeze({
  desktop: { width: 1920, height: 800 },
  phone: { width: 1080, height: 1350 },
});
