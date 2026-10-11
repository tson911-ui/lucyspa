import type { ProductImageZipResponse } from '@lucy-spa/contracts';
import type { MediaStorage } from '@lucy-spa/server';
import { Inject, Injectable } from '@nestjs/common';
import { AuthError } from '../auth/auth.error.js';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { SessionService } from '../auth/session.service.js';
import { runAdminCommand, type AdminContext } from '../authorization/admin-command.js';
import { sqlStateOf } from '../booking/customer-command.js';
import { MEDIA_STORAGE } from '../platform/tokens.js';
import * as core from './image-zip.core.js';

/** Many pictures are processed in one transaction: well above Prisma's 5 seconds, still bounded. */
const ZIP_TIMEOUT_MS = 300_000;
const SHA256 = /^[0-9a-f]{64}$/;

export interface UploadedZip {
  readonly buffer: Buffer;
}

/** Phase 9 P9-8: the bulk picture import (PRD 31.3). Authority is decided inside each command; see `image-zip.core.ts`. */
@Injectable()
export class ProductImageZipService {
  constructor(
    @Inject(SessionService)
    private readonly sessions: Pick<
      SessionService,
      'withTransaction' | 'withExclusiveTransaction' | 'resolveForMutation'
    >,
    @Inject(AuthThrottleService) private readonly throttle: Pick<AuthThrottleService, 'now'>,
    @Inject(MEDIA_STORAGE) private readonly storage: MediaStorage,
  ) {}

  preview(
    token: string | undefined,
    file: UploadedZip | undefined,
    requestId?: string,
  ): Promise<ProductImageZipResponse> {
    if (!file || !Buffer.isBuffer(file.buffer)) throw new AuthError('VALIDATION_FAILED', 'file');
    const bytes = file.buffer;
    return this.run(token, requestId, (context) => core.previewZip(context, bytes));
  }

  apply(
    token: string | undefined,
    file: UploadedZip | undefined,
    fields: { sha256?: unknown; allowPublished?: unknown },
    requestId?: string,
  ): Promise<ProductImageZipResponse> {
    if (!file || !Buffer.isBuffer(file.buffer)) throw new AuthError('VALIDATION_FAILED', 'file');
    if (typeof fields.sha256 !== 'string' || !SHA256.test(fields.sha256)) {
      throw new AuthError('VALIDATION_FAILED', 'sha256');
    }
    if (fields.allowPublished !== 'true' && fields.allowPublished !== 'false') {
      throw new AuthError('VALIDATION_FAILED', 'allowPublished');
    }
    const bytes = file.buffer;
    const request = {
      expectedSha256: fields.sha256,
      allowPublished: fields.allowPublished === 'true',
    };
    return this.run(token, requestId, (context) =>
      core.applyZip(context, bytes, request, this.storage),
    );
  }

  private run<T>(
    token: string | undefined,
    requestId: string | undefined,
    work: (context: AdminContext) => Promise<T>,
  ): Promise<T> {
    return runAdminCommand(
      { sessions: this.sessions, throttle: this.throttle },
      token,
      { exclusive: false, requestId, timeoutMs: ZIP_TIMEOUT_MS },
      async (context) => {
        try {
          return await work(context);
        } catch (error) {
          if (error instanceof AuthError) throw error;
          const meta = Reflect.get(Object(error), 'meta');
          const state = sqlStateOf(error) ?? (meta ? Reflect.get(Object(meta), 'code') : undefined);
          if (
            ['55P03', '40P01', '40001', '23505', '23P01', '23514', '23503'].includes(state ?? '') ||
            ['P2002', 'P2034', 'P2003'].includes(Reflect.get(Object(error), 'code'))
          ) {
            throw new AuthError('CONFLICT');
          }
          throw error;
        }
      },
    );
  }
}
