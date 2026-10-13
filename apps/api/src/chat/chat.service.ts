import {
  CHAT_FALLBACK_REASONS,
  CHAT_LIMITS,
  type ChatCallbackRequestBody,
  type ChatCallbackResponse,
  type ChatFallbackReason,
  type ChatMessageRequest,
  type ChatMessageResponse,
} from '@lucy-spa/contracts';
import { appendOutboxEvent } from '@lucy-spa/database';
import {
  loadAiSettings,
  redisConnectionOptions,
  resolveGlobalPermissionHolders,
  takeSharedAuthGraphLock,
} from '@lucy-spa/server';
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { AuthError } from '../auth/auth.error.js';
import { IdentityValidationError, normalizePhone } from '../auth/identity.js';
import { PrismaService } from '../platform/prisma.service.js';
import type { ClientIdentity } from '../platform/public-rate-limit.core.js';
import { API_ENVIRONMENT, API_LOGGER, type ApiEnvironment } from '../platform/tokens.js';
import { ChatLimiter, type CounterStore } from './chat-limits.js';
import { ChatRelay } from './chat-relay.js';
import { bookingUrl, cleanMessage, isSessionId, optionalText } from './chat.rules.js';

/** The visitor must wait: the controller turns this into HTTP 429 with a Retry-After header. */
export class ChatRateLimited extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super('RATE_LIMITED');
  }
}

/** A repeat of the same phone number within this long is the same request (a double press), not a new one. */
const DUPLICATE_WINDOW_MINUTES = 10;
/** Messages being answered at once: more than this and the widget shows the callback form instead of queueing 20-second calls. */
const MAX_IN_FLIGHT = 10;
const PERMISSION = 'MANAGE_CHAT_REQUESTS';
const EVENT = 'CHAT_CALLBACK_REQUEST';

/** The counters in Redis. A command that fails or takes more than half a second is an error (the limiter then fails closed). */
class RedisCounterStore implements CounterStore {
  private redis: Redis | null = null;
  private connecting: Promise<unknown> | null = null;

  constructor(private readonly redisUrl: string) {}

  private connection(): Redis {
    if (this.redis === null) {
      const redis = new Redis({
        ...redisConnectionOptions(this.redisUrl, 'producer'),
        commandTimeout: 500,
        connectTimeout: 1_000,
        enableOfflineQueue: false,
        lazyConnect: true,
      });
      // Provider messages can carry connection details: nothing is logged from here.
      redis.on('error', () => undefined);
      this.redis = redis;
      this.connecting = redis.connect().catch(() => undefined);
    }
    return this.redis;
  }

  async increment(key: string, lifetimeSeconds: number): Promise<number> {
    const redis = this.connection();
    await this.connecting;
    const results = await redis.multi().incr(key).expire(key, lifetimeSeconds, 'NX').exec();
    const [error, value] = results?.[0] ?? [new Error('no result'), null];
    if (error || typeof value !== 'number') throw error ?? new Error('unexpected counter');
    return value;
  }

  close(): void {
    this.redis?.disconnect();
  }
}

/**
 * Claude integration Wave B (CI-B2): the website chat (docs/PHASE_CLAUDE_INTEGRATION.md section 6.3), anonymous. A visitor message is
 * validated, checked against the switches and the abuse limits, relayed to the shop's n8n bot and answered in plain text (with a booking
 * link the API builds itself), or the widget is told to show the callback form. The chat is read-only by construction: it creates no
 * booking, order, payment or discount. The transcript is never stored; the only thing kept is a callback request the visitor submits.
 * Booking, POS and every other route are untouched whatever happens here.
 */
@Injectable()
export class PublicChatService implements OnModuleDestroy {
  private relay: ChatRelay | null;
  private store: RedisCounterStore | null = null;
  private limiter: ChatLimiter | null = null;
  private inFlight = 0;
  /** Tests replace the clock. */
  now: () => Date = () => new Date();

  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(API_LOGGER) private readonly logger: Logger,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {
    const webhook = environment.chatWebhook;
    this.relay =
      webhook === null
        ? null
        : new ChatRelay({
            url: webhook.url,
            secret: webhook.secret,
            onState: (state) =>
              this.logger.warn({ dependency: 'n8n-chat', state }, 'Website chat relay state'),
          });
  }

  /** Tests give their own relay and limiter; production builds them from the environment. */
  use(parts: { relay?: ChatRelay | null; limiter?: ChatLimiter }): void {
    if (parts.relay !== undefined) this.relay = parts.relay;
    if (parts.limiter !== undefined) this.limiter = parts.limiter;
  }

  private limits(): ChatLimiter {
    if (this.limiter === null) {
      this.store = new RedisCounterStore(this.environment.redisUrl);
      this.limiter = new ChatLimiter(this.store);
    }
    return this.limiter;
  }

  onModuleDestroy(): void {
    this.store?.close();
  }

  private addressId(client: ClientIdentity | null): string {
    return client?.id ?? 'unknown';
  }

  async message(
    body: ChatMessageRequest,
    client: ClientIdentity | null,
  ): Promise<ChatMessageResponse> {
    const fallback = (reason: ChatFallbackReason): ChatMessageResponse => ({
      status: 'FALLBACK',
      reason,
    });
    // A filled honeypot is a script: it gets the same answer as a chat that is switched off, and nothing is relayed.
    if (typeof body.website === 'string' && body.website.trim() !== '') return fallback('OFF');
    const message = cleanMessage(body.message);
    if (message === null) throw new AuthError('VALIDATION_FAILED', 'message');
    if (!isSessionId(body.sessionId)) throw new AuthError('VALIDATION_FAILED', 'sessionId');
    if (body.locale !== 'vi' && body.locale !== 'en') {
      throw new AuthError('VALIDATION_FAILED', 'locale');
    }
    const settings = await loadAiSettings(this.prisma.client);
    if (!settings.enabled || !settings.chatEnabled) return fallback('OFF');
    // No webhook configured, or the breaker is open: nothing is called and no daily count is used.
    if (this.relay === null || this.relay.open) return fallback('N8N_DOWN');
    if (this.inFlight >= MAX_IN_FLIGHT) return fallback('N8N_DOWN');
    const now = this.now();
    const admission = await this.limits().admitMessage({
      visitor: { addressId: this.addressId(client), sessionId: body.sessionId },
      dailyCap: settings.chatDailyCap,
      now,
    });
    if (admission.kind === 'RATE') throw new ChatRateLimited(admission.retryAfterSeconds);
    if (admission.kind === 'CAP') return fallback('CAP_REACHED');
    if (admission.kind === 'UNAVAILABLE') return fallback('OFF');
    this.inFlight += 1;
    try {
      const outcome = await this.relay.send({
        sessionId: body.sessionId,
        message,
        locale: body.locale,
      });
      if (!outcome.ok) return fallback('N8N_DOWN');
      return {
        status: 'REPLY',
        reply: outcome.reply,
        bookingUrl:
          outcome.booking === null
            ? null
            : bookingUrl(this.environment.webOrigin, body.locale, outcome.booking),
      };
    } finally {
      this.inFlight -= 1;
    }
  }

  async callback(
    body: ChatCallbackRequestBody,
    client: ClientIdentity | null,
  ): Promise<ChatCallbackResponse> {
    // A script that fills the hidden field is told it worked and nothing is stored.
    if (typeof body.website === 'string' && body.website.trim() !== '') {
      return { status: 'RECEIVED' };
    }
    if (body.consent !== true) throw new AuthError('VALIDATION_FAILED', 'consent');
    if (body.locale !== 'vi' && body.locale !== 'en') {
      throw new AuthError('VALIDATION_FAILED', 'locale');
    }
    const reason =
      body.reason === 'VISITOR' ||
      (CHAT_FALLBACK_REASONS as readonly string[]).includes(body.reason)
        ? body.reason
        : null;
    if (reason === null) throw new AuthError('VALIDATION_FAILED', 'reason');
    let phone: string;
    try {
      phone = normalizePhone(body.phone).phoneCanonical;
    } catch (error) {
      if (error instanceof IdentityValidationError)
        throw new AuthError('VALIDATION_FAILED', 'phone');
      throw error;
    }
    const name = optionalText(body.name, CHAT_LIMITS.nameMax);
    if (name === undefined) throw new AuthError('VALIDATION_FAILED', 'name');
    const note = optionalText(body.note, CHAT_LIMITS.noteMax);
    if (note === undefined) throw new AuthError('VALIDATION_FAILED', 'note');
    const branchCode =
      typeof body.branchCode === 'string' &&
      /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(body.branchCode)
        ? body.branchCode
        : null;
    const now = this.now();
    const admission = await this.limits().admitCallback({
      addressId: this.addressId(client),
      now,
    });
    if (admission.kind === 'RATE') throw new ChatRateLimited(admission.retryAfterSeconds);

    await this.prisma.client.$transaction(async (tx) => {
      await takeSharedAuthGraphLock(tx);
      const recent = await tx.chatCallbackRequest.findFirst({
        where: {
          phone,
          createdAt: { gt: new Date(now.getTime() - DUPLICATE_WINDOW_MINUTES * 60_000) },
        },
        select: { id: true },
      });
      // The same number again within minutes is a double press: the visitor is told it was received, one request exists.
      if (recent) return;
      const branch =
        branchCode === null
          ? null
          : await tx.branch.findFirst({
              where: { code: branchCode, isActive: true },
              select: { id: true },
            });
      const request = await tx.chatCallbackRequest.create({
        data: {
          reason,
          locale: body.locale,
          phone,
          name,
          note,
          preferredBranchId: branch?.id ?? null,
        },
        select: { id: true },
      });
      const recipients = await resolveGlobalPermissionHolders(tx, { permission: PERMISSION });
      if (recipients.length === 0) return;
      const event = await appendOutboxEvent(tx, {
        aggregateType: 'ChatCallbackRequest',
        aggregateId: request.id,
        eventType: EVENT,
        schemaVersion: 1,
        payload: { entityId: request.id },
      });
      // Consumed in this same transaction: no relay has anything left to do with the event (the pattern of the supplier import notice).
      await tx.outboxEvent.update({
        where: { id: event.id },
        data: { publishedAt: event.occurredAt },
      });
      await tx.notification.createMany({
        skipDuplicates: true,
        data: recipients.map((recipientUserId) => ({
          recipientUserId,
          sourceEventId: event.id,
          branchId: null,
          type: EVENT,
          entityType: 'ChatCallbackRequest',
          entityId: request.id,
          contextCode: 'chat',
          actionAt: event.occurredAt,
        })),
      });
    });
    return { status: 'RECEIVED' };
  }
}
