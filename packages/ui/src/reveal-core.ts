// Customer-side motion gate (docs/UXUI_REDESIGN_PART2_DESIGN.md section 7): when content may reveal on scroll.

/** The visitor's device and preferences that decide whether scroll effects run. */
export interface MotionEnvironment {
  reducedMotion: boolean;
  /** `navigator.connection.saveData` */
  saveData: boolean;
  /** `navigator.deviceMemory` in GB; undefined when the browser does not say. */
  deviceMemory: number | undefined;
  hasObserver: boolean;
}

/** Low memory phones and data-saver mode skip scroll effects, as do reduced motion and browsers without an observer. */
export const LOW_MEMORY_GB = 2;

export function motionAllowed(environment: MotionEnvironment): boolean {
  if (environment.reducedMotion || environment.saveData || !environment.hasObserver) return false;
  return environment.deviceMemory === undefined || environment.deviceMemory > LOW_MEMORY_GB;
}

/** At most six children are staggered; later ones share the last delay, so a long list never feels slow. */
export const MAX_STAGGER_INDEX = 5;

export function staggerIndex(position: number): number {
  return Math.min(Math.max(Math.trunc(position), 0), MAX_STAGGER_INDEX);
}

/** An element already inside the viewport at mount never starts hidden: above the fold is visible from the first paint. */
export function startsVisible(
  rect: { top: number; bottom: number },
  viewportHeight: number,
): boolean {
  return rect.bottom <= 0 ? false : rect.top < viewportHeight;
}

/** Reads the environment in the browser. */
export function readMotionEnvironment(): MotionEnvironment {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return {
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    saveData: connection?.saveData === true,
    deviceMemory: typeof memory === 'number' ? memory : undefined,
    hasObserver: typeof IntersectionObserver !== 'undefined',
  };
}
