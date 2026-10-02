// Seasonal effects (docs/UXUI_REDESIGN_DESIGN.md 20.2, Owner decision Q-S5). Pure and server-safe: the per-device
// `ls-fx=off` cookie (same pattern as the theme cookie), the particle pool size and a deterministic layout.

export const FX_COOKIE = 'ls-fx';
export const FX_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** At most 24 particles; fewer on phones. */
export const PARTICLES_DESKTOP = 24;
export const PARTICLES_PHONE = 12;

/** Effects are on unless the cookie says `off`. Anything unknown means on. */
export function parseFxCookie(cookie: string): boolean {
  return !new RegExp(`(?:^|;\\s*)${FX_COOKIE}=off(?:;|$)`).test(cookie);
}

/** Cookie for the switch: 1 year, SameSite=Lax, readable by script, no personal data. "On" clears it. */
export function serializeFxCookie(enabled: boolean): string {
  const attributes = 'Path=/; SameSite=Lax';
  return enabled
    ? `${FX_COOKIE}=; Max-Age=0; ${attributes}`
    : `${FX_COOKIE}=off; Max-Age=${FX_COOKIE_MAX_AGE}; ${attributes}`;
}

export function particleCount(phone: boolean): number {
  return phone ? PARTICLES_PHONE : PARTICLES_DESKTOP;
}

/** Unitless factors the stylesheet turns into lengths and durations with its own tokens. */
export interface ParticleSpec {
  index: number;
  /** Horizontal position inside the banner, percent; always in a gutter zone, never over the text. */
  left: number;
  /** Multiplies the drift duration token (0.75 to 1.25). */
  speed: number;
  /** Fraction of one cycle already elapsed at mount, so the pool starts spread out, not in a clump. */
  delay: number;
  /** Horizontal sway, -1 to 1, times a spacing token. */
  sway: number;
  /** Glyph size factor, 0.7 to 1.2. */
  scale: number;
}

const PHI_CONJUGATE = 0.6180339887;
const fraction = (value: number): number => value - Math.floor(value);

/**
 * Particles only drift in the two outer gutters of the band (percent of its width), so they never cross the text in
 * the middle (docs/UXUI_REDESIGN_DESIGN.md 20.2: decorations never sit under readable text).
 */
export const PARTICLE_START_ZONE = { from: 0, to: 12 } as const;
export const PARTICLE_END_ZONE = { from: 82, to: 96 } as const;

function gutterPosition(unit: number): number {
  const [low, high] = [PARTICLE_START_ZONE, PARTICLE_END_ZONE];
  const position =
    unit < 0.5
      ? low.from + unit * 2 * (low.to - low.from)
      : high.from + (unit - 0.5) * 2 * (high.to - high.from);
  return Math.round(position * 10) / 10;
}

/**
 * The first `count` particles of one fixed low-discrepancy sequence: the same input always gives the same layout
 * (no `Math.random`, so server and client agree), and a smaller pool is a prefix of a larger one.
 */
export function particleLayout(count: number): ParticleSpec[] {
  return Array.from({ length: Math.max(0, Math.min(count, PARTICLES_DESKTOP)) }, (_, index) => ({
    index,
    left: gutterPosition(fraction((index + 1) * PHI_CONJUGATE)),
    speed: Math.round((0.75 + fraction((index + 1) * 0.7548776662) * 0.5) * 100) / 100,
    delay: Math.round(fraction((index + 1) * 0.5698402909) * 100) / 100,
    sway: Math.round((fraction((index + 1) * 0.3247179572) * 2 - 1) * 100) / 100,
    scale: Math.round((0.7 + fraction((index + 1) * 0.8191725134) * 0.5) * 100) / 100,
  }));
}

// ------------------------------------------------------------------------------------------ site-wide particles (S6)

/** Particle density chosen per event (S6b); medium is the default and equals the S2 pool of 24 (12 on phones). */
export type ParticleDensity = 'low' | 'medium' | 'high';

export const SITE_PARTICLES: Record<ParticleDensity, { desktop: number; phone: number }> = {
  low: { desktop: 12, phone: 6 },
  medium: { desktop: 24, phone: 12 },
  high: { desktop: 40, phone: 20 },
};

/** Most particles on a page that is several screens tall: the pool grows with the page, up to this many screens. */
export const SITE_PARTICLE_MAX_SCREENS = 3;

/**
 * How many particles a page gets: the density's pool for one screen, times the number of screens the page is tall
 * (1 to 3), so a long page is as lively as a short one without ever drawing more than 3 pools.
 */
export function siteParticleCount(
  density: ParticleDensity,
  phone: boolean,
  pageHeight: number,
  viewportHeight: number,
): number {
  const base = SITE_PARTICLES[density][phone ? 'phone' : 'desktop'];
  const screens =
    viewportHeight > 0 && pageHeight > 0
      ? Math.min(Math.max(pageHeight / viewportHeight, 1), SITE_PARTICLE_MAX_SCREENS)
      : 1;
  return Math.round(base * screens);
}

/** Particles spread over the whole width of the page (the text keep-out mask removes them over words). */
export function siteParticleLayout(count: number): ParticleSpec[] {
  return Array.from({ length: Math.max(0, count) }, (_, index) => ({
    index,
    left: Math.round(fraction((index + 1) * PHI_CONJUGATE) * 1000) / 10,
    speed: Math.round((0.75 + fraction((index + 1) * 0.7548776662) * 0.5) * 100) / 100,
    delay: Math.round(fraction((index + 1) * 0.5698402909) * 100) / 100,
    sway: Math.round((fraction((index + 1) * 0.3247179572) * 2 - 1) * 100) / 100,
    scale: Math.round((0.7 + fraction((index + 1) * 0.8191725134) * 0.5) * 100) / 100,
  }));
}

// ------------------------------------------------------------------------------------------ text keep-out mask

/** A rectangle in page pixels, relative to the particle layer. */
export interface KeepoutRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const KEEPOUT_PADDING = 8;
export const KEEPOUT_MAX_RECTS = 320;
export const KEEPOUT_BLUR = 7;

/**
 * Pads the rectangles, drops the empty ones and the ones outside the layer, merges rectangles that sit on one line
 * and touch (so a paragraph becomes a few boxes, not one per word), and keeps at most `KEEPOUT_MAX_RECTS`.
 */
export function normalizeKeepouts(
  rects: readonly KeepoutRect[],
  width: number,
  height: number,
  padding = KEEPOUT_PADDING,
): KeepoutRect[] {
  const padded = rects
    .filter((rect) => rect.width > 0.5 && rect.height > 0.5)
    .map((rect) => ({
      x: rect.x - padding,
      y: rect.y - padding,
      width: rect.width + padding * 2,
      height: rect.height + padding * 2,
    }))
    .filter(
      (rect) =>
        rect.x < width && rect.y < height && rect.x + rect.width > 0 && rect.y + rect.height > 0,
    )
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const merged: KeepoutRect[] = [];
  for (const rect of padded) {
    const last = merged[merged.length - 1];
    const sameLine =
      last !== undefined &&
      Math.abs(last.y - rect.y) <= 4 &&
      Math.abs(last.height - rect.height) <= 8 &&
      rect.x <= last.x + last.width + padding;
    if (sameLine) {
      const right = Math.max(last.x + last.width, rect.x + rect.width);
      last.width = right - last.x;
      last.height = Math.max(last.height, rect.height);
    } else {
      merged.push({ ...rect });
    }
  }
  return merged.slice(0, KEEPOUT_MAX_RECTS);
}

const round1 = (value: number): number => Math.round(value * 10) / 10;

/**
 * An SVG image for `mask-image`: opaque everywhere except soft holes over the keep-out rectangles. Particles drawn
 * in the layer vanish inside a hole and come back outside it, so they never cross a word. The outer box is larger
 * than the layer so the blur does not fade the page edges.
 */
export function keepoutMaskSvg(
  width: number,
  height: number,
  rects: readonly KeepoutRect[],
): string {
  const outer = `M${-KEEPOUT_BLUR * 3} ${-KEEPOUT_BLUR * 3}H${round1(width + KEEPOUT_BLUR * 3)}V${round1(height + KEEPOUT_BLUR * 3)}H${-KEEPOUT_BLUR * 3}Z`;
  const holes = rects
    .map(
      (rect) =>
        `M${round1(rect.x)} ${round1(rect.y)}h${round1(rect.width)}v${round1(rect.height)}h${round1(-rect.width)}Z`,
    )
    .join('');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(width)}" height="${Math.round(height)}" viewBox="0 0 ${round1(width)} ${round1(height)}">` +
    `<filter id="b" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="${KEEPOUT_BLUR / 2}"/></filter>` +
    `<path filter="url(#b)" fill-rule="evenodd" fill="#000" d="${outer}${holes}"/></svg>`
  );
}

/** The `mask-image` value for the layer; "none" when there is nothing to keep clear. */
export function keepoutMaskImage(
  width: number,
  height: number,
  rects: readonly KeepoutRect[],
): string {
  if (rects.length === 0 || width <= 0 || height <= 0) return 'none';
  return `url("data:image/svg+xml,${encodeURIComponent(keepoutMaskSvg(width, height, rects))}")`;
}
