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
