import { Body, Controller, HttpCode, Inject, Injectable, Optional, Post } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import {
  processProviderNotification,
  type PaymentProvider,
  type VerifiedProviderNotification,
} from '@lucy-spa/server';
import type { Logger } from 'pino';
import { AuthError } from '../auth/auth.error.js';
import { PublicWebhook } from '../auth/public-webhook.js';
import { PrismaService } from '../platform/prisma.service.js';
import { API_LOGGER, PAYMENT_PROVIDER } from '../platform/tokens.js';

/** A real notification is a few hundred bytes; anything large is not one. */
const MAX_BODY_CHARACTERS = 16_384;
/** Unauthentic deliveries tolerated per minute before the endpoint answers 429 to them (real ones never wait). */
const INVALID_PER_MINUTE = 60;

/**
 * The public PayOS webhook (design 16.4). Its ONLY authority is the provider signature, verified before any
 * state change. Deliveries with a valid signature are never throttled; unauthentic ones are cheap to refuse
 * (an HMAC) and are throttled per minute so they cannot become a flood. No session or cookie is read or
 * created, no workforce or customer authority is implied, and responses never say why a delivery was refused.
 * A processing failure answers 503 so PayOS retries; the worker sweep recovers anything a retry misses.
 */
@Injectable()
export class PayosWebhookService {
  private windowStartedAt = 0;
  private invalidInWindow = 0;

  constructor(
    @Inject(PrismaService) private readonly prisma: Pick<PrismaService, 'client'>,
    @Optional() @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider | null = null,
    @Optional() @Inject(API_LOGGER) private readonly logger: Logger | null = null,
  ) {}

  async receive(body: unknown): Promise<{ received: true }> {
    const provider = this.provider;
    if (!provider) throw new AuthError('SERVICE_UNAVAILABLE');
    let size: number;
    try {
      size = JSON.stringify(body)?.length ?? 0;
    } catch {
      size = MAX_BODY_CHARACTERS + 1;
    }
    if (size > MAX_BODY_CHARACTERS) throw new AuthError('VALIDATION_FAILED');
    const verified = provider.verifyNotification(body);
    if (!verified) {
      const now = Date.now();
      if (now - this.windowStartedAt >= 60_000) {
        this.windowStartedAt = now;
        this.invalidInWindow = 0;
      }
      this.invalidInWindow += 1;
      throw new AuthError(
        this.invalidInWindow > INVALID_PER_MINUTE ? 'RATE_LIMITED' : 'AUTHENTICATION_FAILED',
      );
    }
    await this.apply(verified);
    return { received: true };
  }

  private async apply(notification: VerifiedProviderNotification): Promise<void> {
    try {
      const outcome = await this.prisma.client.$transaction(
        (tx) => processProviderNotification(tx, notification),
        { timeout: 15_000 },
      );
      this.logger?.info(
        {
          orderCode: notification.orderCode,
          duplicate: outcome.duplicate,
          outcome: outcome.duplicate ? 'DUPLICATE' : outcome.result.outcome,
        },
        'PayOS notification processed',
      );
    } catch (error) {
      // A concurrent duplicate that lost the race on the unique dedupe key: the first one already applied it.
      if (Reflect.get(Object(error), 'code') === 'P2002') return;
      this.logger?.error(
        { errorName: error instanceof Error ? error.name : 'UnknownError' },
        'PayOS notification could not be processed',
      );
      throw new AuthError('SERVICE_UNAVAILABLE');
    }
  }
}

@Controller('api/v1/webhooks')
export class PayosWebhookController {
  constructor(@Inject(PayosWebhookService) private readonly webhook: PayosWebhookService) {}

  @Post('payos')
  @HttpCode(200)
  @PublicWebhook()
  @ApiOkResponse({
    description:
      'PayOS payment notification. Server-to-server: authenticated only by the PayOS signature, never by a session.',
  })
  receive(@Body() body: unknown): Promise<{ received: true }> {
    return this.webhook.receive(body);
  }
}
