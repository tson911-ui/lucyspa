import { secondsToShopMidnight, shopDay } from './chat.rules.js';

/**
 * Claude integration Wave B (CI-B2): the abuse limits of the website chat (design 6.3), per visitor address, per chat session and for the
 * whole shop per day. Unlike the public page reads these FAIL CLOSED: if the counters cannot be reached the bot is off (`UNAVAILABLE`) and
 * the widget shows the callback form; the site itself is never affected. Counting is pure arithmetic over a counter store (Redis in
 * production, a map in tests), so the numbers are tested without a server.
 */

export const CHAT_RATE = Object.freeze({
  perAddressMinute: 8,
  perAddressHour: 40,
  perSessionDay: 30,
  /** The callback form: a few tries per address an hour. */
  callbackPerAddressHour: 5,
  callbackPerAddressDay: 12,
});

/** Adds one to a key (creating it with a lifetime in seconds) and returns the new count. */
export interface CounterStore {
  increment(key: string, lifetimeSeconds: number): Promise<number>;
}

export type Admission =
  | { kind: 'ADMITTED' }
  /** Too many messages from this address or session: the visitor waits (HTTP 429). */
  | { kind: 'RATE'; retryAfterSeconds: number }
  /** The shop's daily relay cap is used up: the widget shows the callback form. */
  | { kind: 'CAP' }
  /** The counters cannot be reached: the bot is off for now. */
  | { kind: 'UNAVAILABLE' };

export interface Visitor {
  /** A short digest of the address (`unknown` when none could be read: all such visitors share one budget). */
  addressId: string;
  sessionId: string;
}

const secondsToNext = (nowMs: number, windowSeconds: number): number =>
  Math.max(1, Math.ceil(windowSeconds - ((nowMs / 1000) % windowSeconds)));

export class ChatLimiter {
  constructor(private readonly store: CounterStore) {}

  async admitMessage(input: { visitor: Visitor; dailyCap: number; now: Date }): Promise<Admission> {
    const { visitor, now } = input;
    const ms = now.getTime();
    const day = shopDay(now);
    const toMidnight = secondsToShopMidnight(now);
    try {
      const minute = await this.store.increment(
        `lucy:chat:addr-min:${visitor.addressId}:${Math.floor(ms / 60_000)}`,
        120,
      );
      if (minute > CHAT_RATE.perAddressMinute) {
        return { kind: 'RATE', retryAfterSeconds: secondsToNext(ms, 60) };
      }
      const hour = await this.store.increment(
        `lucy:chat:addr-hour:${visitor.addressId}:${Math.floor(ms / 3_600_000)}`,
        7_200,
      );
      if (hour > CHAT_RATE.perAddressHour) {
        return { kind: 'RATE', retryAfterSeconds: secondsToNext(ms, 3_600) };
      }
      const session = await this.store.increment(
        `lucy:chat:session:${visitor.sessionId}:${day}`,
        toMidnight + 3_600,
      );
      if (session > CHAT_RATE.perSessionDay) {
        return { kind: 'RATE', retryAfterSeconds: toMidnight };
      }
      if (input.dailyCap <= 0) return { kind: 'CAP' };
      const global = await this.store.increment(`lucy:chat:day:${day}`, toMidnight + 3_600);
      if (global > input.dailyCap) return { kind: 'CAP' };
      return { kind: 'ADMITTED' };
    } catch {
      return { kind: 'UNAVAILABLE' };
    }
  }

  /**
   * A callback request: a few per address an hour and a dozen a day. Unlike a chat message it is never refused because the counters are
   * down (that is exactly when the form is needed); the database refuses a repeated phone number instead.
   */
  async admitCallback(input: { addressId: string; now: Date }): Promise<Admission> {
    const ms = input.now.getTime();
    try {
      const hour = await this.store.increment(
        `lucy:chat:cb-hour:${input.addressId}:${Math.floor(ms / 3_600_000)}`,
        7_200,
      );
      if (hour > CHAT_RATE.callbackPerAddressHour) {
        return { kind: 'RATE', retryAfterSeconds: secondsToNext(ms, 3_600) };
      }
      const day = await this.store.increment(
        `lucy:chat:cb-day:${input.addressId}:${shopDay(input.now)}`,
        secondsToShopMidnight(input.now) + 3_600,
      );
      if (day > CHAT_RATE.callbackPerAddressDay) {
        return { kind: 'RATE', retryAfterSeconds: secondsToShopMidnight(input.now) };
      }
      return { kind: 'ADMITTED' };
    } catch {
      return { kind: 'ADMITTED' };
    }
  }
}
