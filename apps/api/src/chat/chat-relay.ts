import { CircuitBreaker, cleanReply, parseBotBooking, type BotBooking } from './chat.rules.js';

/**
 * Claude integration Wave B (CI-B2): the server-to-server call from the API to the shop's n8n "Website Chat" webhook (design 6.3). The
 * browser never reaches n8n. The call carries the header secret, has a hard timeout of 20 seconds (the n8n workflow stops itself at 15, so
 * it never keeps spending tokens after the widget has fallen back), and its answer is read strictly: a JSON object with a text `reply`
 * and optionally a `booking` slot, nothing else is used. Any failure (timeout, a status other than 200, unreadable or empty answer,
 * a breaker that is open) is one outcome, `DOWN`, which makes the widget show the callback form. The reply text and the secret are never
 * logged or put in an error.
 */

export const RELAY_TIMEOUT_MS = 20_000;
/** An answer larger than this is not a chat answer. */
const MAX_ANSWER_BYTES = 64 * 1024;

export interface RelayInput {
  sessionId: string;
  message: string;
  locale: 'vi' | 'en';
}

export type RelayOutcome =
  { ok: true; reply: string; booking: BotBooking | null } | { ok: false; reason: 'DOWN' };

export type FetchLike = (
  url: string,
  init: {
    method: 'POST';
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
    redirect: 'error';
  },
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

export interface ChatRelayOptions {
  url: string;
  secret: string;
  breaker?: CircuitBreaker;
  fetch?: FetchLike;
  timeoutMs?: number;
  now?: () => number;
  /** Told once when the breaker opens and once when it closes again; carries no text. */
  onState?: (state: 'OPEN' | 'CLOSED') => void;
}

export class ChatRelay {
  private readonly breaker: CircuitBreaker;
  private readonly fetcher: FetchLike;
  private readonly timeoutMs: number;
  private readonly now: () => number;
  private wasOpen = false;

  constructor(private readonly options: ChatRelayOptions) {
    this.breaker = options.breaker ?? new CircuitBreaker();
    this.fetcher = options.fetch ?? ((url, init) => fetch(url, init));
    this.timeoutMs = options.timeoutMs ?? RELAY_TIMEOUT_MS;
    this.now = options.now ?? Date.now;
  }

  /** True while the breaker refuses calls (no call is made then). */
  get open(): boolean {
    return this.breaker.open;
  }

  async send(input: RelayInput): Promise<RelayOutcome> {
    if (!this.breaker.allow(this.now())) return { ok: false, reason: 'DOWN' };
    const outcome = await this.call(input);
    if (outcome.ok) this.breaker.success();
    else this.breaker.failure(this.now());
    const open = this.breaker.open;
    if (open !== this.wasOpen) {
      this.wasOpen = open;
      this.options.onState?.(open ? 'OPEN' : 'CLOSED');
    }
    return outcome;
  }

  private async call(input: RelayInput): Promise<RelayOutcome> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher(this.options.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          'x-lucy-chat-secret': this.options.secret,
        },
        body: JSON.stringify({
          channel: 'web',
          sessionId: input.sessionId,
          message: input.message,
          locale: input.locale,
        }),
        signal: controller.signal,
        // A redirect would send the secret and the message somewhere else.
        redirect: 'error',
      });
      if (!response.ok || response.status !== 200) return { ok: false, reason: 'DOWN' };
      const raw = await response.text();
      if (raw.length > MAX_ANSWER_BYTES) return { ok: false, reason: 'DOWN' };
      let body: unknown;
      try {
        body = JSON.parse(raw);
      } catch {
        return { ok: false, reason: 'DOWN' };
      }
      // n8n may answer a one-element array (its "Respond to Webhook" with a list of items).
      const record = Array.isArray(body) ? body[0] : body;
      if (typeof record !== 'object' || record === null) return { ok: false, reason: 'DOWN' };
      const reply = cleanReply((record as Record<string, unknown>)['reply']);
      if (reply === null) return { ok: false, reason: 'DOWN' };
      return {
        ok: true,
        reply,
        booking: parseBotBooking((record as Record<string, unknown>)['booking']),
      };
    } catch {
      return { ok: false, reason: 'DOWN' };
    } finally {
      clearTimeout(timer);
    }
  }
}
