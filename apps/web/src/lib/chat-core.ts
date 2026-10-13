import type { ChatFallbackReason, ChatMessageResponse } from '@lucy-spa/contracts';
import { ApiError } from './api/client';

/**
 * Claude integration Wave B: the pure parts of the website chat widget. The session id is a random UUID kept in `sessionStorage` (never
 * derived from anything personal, gone with the tab); an answer or a failure is turned into what the panel does next; a phone number is
 * checked loosely here (the server has the real rule) so an obvious slip is caught before it is sent.
 */

const SESSION_KEY = 'lucy-chat-session';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type SessionStore = Pick<Storage, 'getItem' | 'setItem'>;

/** The chat session of this tab: read from storage, else made (and stored when storage allows it). */
export function chatSessionId(
  storage: SessionStore | null,
  random: () => string = () => crypto.randomUUID(),
): string {
  try {
    const stored = storage?.getItem(SESSION_KEY);
    if (stored && UUID.test(stored)) return stored;
  } catch {
    // Storage may be blocked: a session that lives as long as the panel is enough.
  }
  const made = random();
  try {
    storage?.setItem(SESSION_KEY, made);
  } catch {
    // Same: nothing to keep.
  }
  return made;
}

/** What the panel does with the API's answer to one message. */
export type ChatStep =
  | { kind: 'REPLY'; reply: string; bookingUrl: string | null }
  | { kind: 'FORM'; reason: ChatFallbackReason }
  | { kind: 'WAIT' };

export function stepFromAnswer(answer: ChatMessageResponse): ChatStep {
  return answer.status === 'REPLY'
    ? { kind: 'REPLY', reply: answer.reply, bookingUrl: answer.bookingUrl }
    : { kind: 'FORM', reason: answer.reason };
}

/** A failed call: too many messages waits; anything else (the site's API unreachable, an error) offers the callback form. */
export function stepFromFailure(error: unknown): ChatStep {
  if (error instanceof ApiError && error.status === 429) return { kind: 'WAIT' };
  return { kind: 'FORM', reason: 'N8N_DOWN' };
}

/**
 * The booking link the API built is absolute (`https://site/vi/account/book?...`); on this site it is opened as a path so the visit stays in
 * the app. A link to anywhere else is refused (null): the widget only ever links to the booking page.
 */
export function bookingPath(url: string | null, origin: string): string | null {
  if (url === null || !URL.canParse(url)) return null;
  const parsed = new URL(url);
  if (parsed.origin !== origin) return null;
  return /^\/(vi|en)\/account\/book$/.test(parsed.pathname)
    ? `${parsed.pathname}${parsed.search}`
    : null;
}

/** A loose check: digits, spaces, dots, dashes, brackets and a leading plus; 9 to 15 digits. The server decides what is a real number. */
export function looksLikePhone(value: string): boolean {
  const text = value.trim();
  if (!/^\+?[0-9 ().-]+$/.test(text)) return false;
  const digits = text.replace(/\D/g, '');
  return digits.length >= 9 && digits.length <= 15;
}
