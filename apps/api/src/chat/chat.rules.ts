import { CHAT_LIMITS } from '@lucy-spa/contracts';

/**
 * Claude integration Wave B (CI-B2): the pure rules of the website chat (docs/PHASE_CLAUDE_INTEGRATION.md section 6.3). What a visitor may
 * send, what the bot's answer may become, the booking link the API builds itself, the shop-time day a daily count belongs to, and the
 * circuit breaker that stops asking a bot that is down. Nothing here touches the network, the database or the clock (callers pass `now`).
 */

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isSessionId = (value: unknown): value is string =>
  typeof value === 'string' && SESSION_ID.test(value);

/* eslint-disable no-control-regex */
const CONTROL =
  /[\u{0}-\u{8}\u{b}\u{c}\u{e}-\u{1f}\u{7f}-\u{9f}\u{200b}-\u{200f}\u{2028}\u{2029}\u{202a}-\u{202e}\u{2066}-\u{2069}\u{feff}]/gu;
/* eslint-enable no-control-regex */

/**
 * A visitor's message: Unicode-normalized, control and invisible direction characters removed, runs of white space folded to one space.
 * Null when it is not text, empty, or longer than the limit (a long message is refused, never cut, so nobody is answered about half a
 * question).
 */
export function cleanVisitorText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.normalize('NFC').replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();
  if (text === '' || text.length > max) return null;
  return text;
}

export const cleanMessage = (value: unknown): string | null =>
  cleanVisitorText(value, CHAT_LIMITS.messageMax);

/** Optional free text of the callback form (name, note): empty means absent; too long or not text is refused (`undefined`). */
export function optionalText(value: unknown, max: number): string | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return undefined;
  if (value.trim() === '') return null;
  const text = cleanVisitorText(value, max);
  return text === null ? undefined : text;
}

/**
 * The bot's answer as plain text for the widget: HTML tags and entities, markdown links and images, bare addresses and e-mails are
 * removed (a link in a reply is built by the API from structured fields, never copied from model text), markdown emphasis marks are
 * dropped, control characters go, the length is capped. Null when nothing readable is left.
 */
export function cleanReply(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  let text = value.normalize('NFC');
  text = text
    .replace(/<\/?(?:br|p|div|li|ul|ol|h[1-6])\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&[a-z]{2,8};|&#\d{1,6};/gi, ' ');
  text = text.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1');
  text = text.replace(/\b(?:https?:\/\/|www\.)\S+/gi, '');
  text = text.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '');
  text = text
    .replace(/^#{1,6}[ \t]*/gm, '')
    .replace(/\*\*|__|~~|[*`]/g, '')
    .replace(CONTROL, ' ');
  text = text
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line, index, lines) => line !== '' || (index > 0 && lines[index - 1] !== ''))
    .join('\n')
    .trim();
  if (text === '') return null;
  if (text.length <= CHAT_LIMITS.replyMax) return text;
  // Cut at the last sentence or word before the limit so a reply does not end in the middle of a word.
  const head = text.slice(0, CHAT_LIMITS.replyMax);
  const stop = Math.max(head.lastIndexOf('. '), head.lastIndexOf('\n'), head.lastIndexOf(' '));
  return `${(stop > CHAT_LIMITS.replyMax / 2 ? head.slice(0, stop) : head).trim()}…`;
}

export interface BotBooking {
  branch: string;
  services: string[];
  date: string;
  time: string | null;
}

const CODE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The slot the bot named, if it is well formed (a branch code, one to three service codes, a date, optionally a start time). */
export function parseBotBooking(value: unknown): BotBooking | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const branch = record['branch'];
  const services = record['services'];
  const date = record['date'];
  const time = record['time'];
  if (typeof branch !== 'string' || !CODE.test(branch)) return null;
  if (
    !Array.isArray(services) ||
    services.length < 1 ||
    services.length > 3 ||
    !services.every((code) => typeof code === 'string' && CODE.test(code))
  ) {
    return null;
  }
  if (typeof date !== 'string' || !DATE.test(date)) return null;
  if (time !== undefined && time !== null && (typeof time !== 'string' || !TIME.test(time))) {
    return null;
  }
  return {
    branch,
    services: [...new Set(services as string[])],
    date,
    time: typeof time === 'string' ? time : null,
  };
}

/** The booking page link, built here from structured fields only. The page still asks the visitor to sign in and confirm. */
export function bookingUrl(origin: string, locale: 'vi' | 'en', booking: BotBooking): string {
  const query = [
    `branch=${encodeURIComponent(booking.branch)}`,
    `services=${booking.services.map(encodeURIComponent).join(',')}`,
    `date=${booking.date}`,
    ...(booking.time ? [`time=${encodeURIComponent(booking.time)}`] : []),
  ].join('&');
  return `${origin}/${locale}/account/book?${query}`;
}

/** The shop-time calendar day (`YYYY-MM-DD`) a daily count belongs to. */
export function shopDay(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** Seconds until the next shop-time midnight (for a daily counter's lifetime and a Retry-After). */
export function secondsToShopMidnight(now: Date): number {
  const [y, m, d] = shopDay(now).split('-').map(Number) as [number, number, number];
  // Vietnam has no daylight saving: the shop day ends at 17:00 UTC.
  const end = Date.UTC(y, m - 1, d, 17, 0, 0);
  const next = end > now.getTime() ? end : end + 86_400_000;
  return Math.max(1, Math.ceil((next - now.getTime()) / 1000));
}

/**
 * Stops asking a bot that keeps failing (design 6.3: open after five failures within 60 seconds). While open every call is refused at
 * once and the widget shows the callback form; after the cool-down one call is let through, and its result closes or reopens it.
 */
export class CircuitBreaker {
  private failures: number[] = [];
  private openedAt: number | null = null;
  private probing = false;

  constructor(
    private readonly threshold = 5,
    private readonly windowMs = 60_000,
    private readonly coolDownMs = 30_000,
  ) {}

  /** May a call go out now? A half-open breaker lets exactly one probe through. */
  allow(now: number): boolean {
    if (this.openedAt === null) return true;
    if (now - this.openedAt < this.coolDownMs) return false;
    if (this.probing) return false;
    this.probing = true;
    return true;
  }

  success(): void {
    this.failures = [];
    this.openedAt = null;
    this.probing = false;
  }

  failure(now: number): void {
    this.probing = false;
    this.failures = [...this.failures.filter((at) => now - at < this.windowMs), now];
    if (this.openedAt !== null || this.failures.length >= this.threshold) this.openedAt = now;
  }

  get open(): boolean {
    return this.openedAt !== null;
  }
}
