// GSAP wrapper, pure part (DESIGN.md 11): the one rule for "may anything animate", the staff duration cap and the parsing of
// the duration tokens. No DOM and no GSAP here, so it runs on the server and in plain tests.
import { motionAllowed, type MotionEnvironment } from './reveal-core';

/** `full` = tweens may run; `reduced` = no tween at all, content is in its final state (reduced motion, the off switch, a kill flag). */
export type MotionState = 'full' | 'reduced';

/** No tween is longer than this in the compact (staff) scope (DESIGN.md 11.3). */
export const STAFF_MOTION_CAP_MS = 200;

/** The duration tokens of tokens.css the wrapper may read (`--ls-dur-<name>`). */
export type MotionToken = 'fast' | 'base' | 'slow' | 'reveal' | 'hero';

export interface MotionSwitches {
  environment: MotionEnvironment;
  /** The visitor's `ls-fx` switch: off turns the seasonal particles and every tween off together (DESIGN.md 11.5). */
  effectsEnabled: boolean;
  /** The staff-wide motion setting. Stubbed: nothing writes it before groups 2 and 3, so it is `on`. */
  staffSetting: 'on' | 'off';
  /** The build-time kill flag (`NEXT_PUBLIC_LS_MOTION=off`). */
  killed: boolean;
}

/** Any one of the switches turns motion off; otherwise the device decides (reduced motion, data saver, low memory). */
export function resolveMotionState(switches: MotionSwitches): MotionState {
  if (switches.killed || switches.staffSetting === 'off' || !switches.effectsEnabled)
    return 'reduced';
  return motionAllowed(switches.environment) ? 'full' : 'reduced';
}

/** `240ms`, `0.24s`, `0`; anything else (an unset token) reads as 0, so an unknown token never animates. */
export function parseCssDurationMs(value: string): number {
  const match = /^\s*(-?\d*\.?\d+)\s*(ms|s)?\s*$/.exec(value);
  if (!match) return 0;
  const amount = Number(match[1]);
  const milliseconds = match[2] === 's' ? amount * 1000 : amount;
  return Number.isFinite(milliseconds) && milliseconds > 0 ? milliseconds : 0;
}

/** `16px` to 16; anything else to 0. */
export function parseCssPx(value: string): number {
  const match = /^\s*(-?\d*\.?\d+)px\s*$/.exec(value);
  return match ? Number(match[1]) : 0;
}

/** The staff cap is enforced here, in one place, not left to each component. */
export function clampDurationMs(milliseconds: number, compact: boolean): number {
  return compact ? Math.min(milliseconds, STAFF_MOTION_CAP_MS) : milliseconds;
}
