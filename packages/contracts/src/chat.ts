/**
 * Claude integration Wave B (docs/PHASE_CLAUDE_INTEGRATION.md section 6.3; Owner answers OQ-CI-6 and OQ-CI-7, message of 2026-10-13): the
 * website chat and the "để lại số điện thoại" callback requests.
 *
 * The browser talks to the API only (never to n8n): `POST /api/v1/public/chat/messages` relays one visitor message to the n8n bot and
 * answers with a plain-text reply (and a booking link the API builds itself), or with a FALLBACK telling the widget to show the callback
 * form. `POST /api/v1/public/chat/callback` stores a callback request. The chat transcript is never stored. Staff with
 * `MANAGE_CHAT_REQUESTS` (GLOBAL) work the inbox under `api/v1/chat-requests`.
 */

export const CHAT_LIMITS = Object.freeze({
  /** Longest visitor message, in characters. */
  messageMax: 500,
  /** Longest reply the widget shows (the API cuts anything longer). */
  replyMax: 1_500,
  nameMax: 80,
  noteMax: 500,
  /** The inbox page size. */
  pageSize: 20,
});

export type ChatLocale = 'vi' | 'en';

/** Why the widget shows the callback form instead of an answer. */
export const CHAT_FALLBACK_REASONS = ['OFF', 'N8N_DOWN', 'CAP_REACHED'] as const;
export type ChatFallbackReason = (typeof CHAT_FALLBACK_REASONS)[number];

/** POST /api/v1/public/chat/messages */
export interface ChatMessageRequest {
  /** A random UUID the widget makes and keeps in sessionStorage (never derived from anything personal). */
  sessionId: string;
  message: string;
  locale: ChatLocale;
  /** A hidden field a person never fills: a filled one is a bot. */
  website?: string;
}

export type ChatMessageResponse =
  | {
      status: 'REPLY';
      reply: string;
      /** Built by the API from structured fields the bot returned; null when the bot named no slot. */
      bookingUrl: string | null;
    }
  | { status: 'FALLBACK'; reason: ChatFallbackReason };

/** POST /api/v1/public/chat/callback */
export interface ChatCallbackRequestBody {
  phone: string;
  name?: string;
  note?: string;
  /** The branch code the visitor prefers (optional). */
  branchCode?: string;
  locale: ChatLocale;
  /** The visitor agreed to be called (the consent line is shown next to the box). */
  consent: boolean;
  reason: ChatFallbackReason | 'VISITOR';
  website?: string;
}

export interface ChatCallbackResponse {
  status: 'RECEIVED';
}

export const CHAT_REQUEST_STATUSES = ['NEW', 'CALLED', 'CLOSED'] as const;
export type ChatRequestStatus = (typeof CHAT_REQUEST_STATUSES)[number];

export interface ChatRequestRow {
  id: string;
  status: ChatRequestStatus;
  reason: ChatFallbackReason | 'VISITOR';
  /** Null once purged (90 days after the request was closed). */
  phone: string | null;
  name: string | null;
  note: string | null;
  preferredBranchName: string | null;
  createdAt: string;
  handledAt: string | null;
  handledByName: string | null;
  closedAt: string | null;
  rowVersion: number;
}

/** GET /api/v1/chat-requests?status=&page= */
export interface ChatRequestList {
  items: ChatRequestRow[];
  total: number;
  page: number;
  pageSize: number;
  counts: Record<ChatRequestStatus, number>;
}

/** POST /api/v1/chat-requests/:id/status : NEW to CALLED, NEW or CALLED to CLOSED (never back). */
export interface ChatRequestStatusRequest {
  expectedRowVersion: number;
  status: 'CALLED' | 'CLOSED';
}
