import { createHash } from 'node:crypto';
import type {
  ProductImportApplyRequest,
  ProductImportCancelRequest,
  ProductImportDetailResponse,
  ProductImportKindName,
  ProductImportListResponse,
} from '@lucy-spa/contracts';
import {
  buildTemplate,
  IMPORT_LIMITS,
  mapColumns,
  readSpreadsheet,
  SpreadsheetError,
  type SpreadsheetFailure,
  type TemplateFile,
  type TemplateFormat,
  type TemplateLanguage,
} from '@lucy-spa/server';
import { Inject, Injectable } from '@nestjs/common';
import { AuthError } from '../auth/auth.error.js';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { SessionService } from '../auth/session.service.js';
import { runAdminCommand, type AdminContext } from '../authorization/admin-command.js';
import { sqlStateOf } from '../booking/customer-command.js';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';
import * as core from './import.core.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KINDS: readonly ProductImportKindName[] = ['CATALOG', 'OPENING_STOCK'];

/** The reason a file is refused, as the camelCase field the API reports (the screen writes the sentence). */
const REASONS: Record<SpreadsheetFailure, string> = {
  too_large: 'tooLarge',
  xls: 'xls',
  unsupported: 'unsupported',
  corrupt: 'corrupt',
  encoding: 'encoding',
  empty: 'empty',
  too_many_rows: 'tooManyRows',
  too_many_columns: 'tooManyColumns',
};

/** A big file is many statements in one transaction: well above Prisma's 5 seconds, still bounded. */
const BATCH_TIMEOUT_MS = 120_000;

export interface UploadedSheet {
  readonly buffer: Buffer;
  readonly originalname: string;
}

/** The browser sends the name as UTF-8 bytes read as Latin-1; undo that when the result is clean text. */
function cleanFilename(name: string): string {
  const decoded = Buffer.from(name, 'latin1').toString('utf8');
  const chosen = decoded.includes('\uFFFD') ? name : decoded;
  const base = chosen.split(/[\\/]/).pop() ?? '';
  const printable = [...base].filter(
    (char) => char.charCodeAt(0) > 31 && char.charCodeAt(0) !== 127,
  );
  return printable.join('').trim().slice(0, 200) || 'import';
}

/**
 * Phase 6 P6-5: the Excel/CSV import. Every command is authorized inside its transaction (the cores). The file is parsed outside the
 * database transaction; the preview and the apply each run in one transaction, so a failure leaves nothing behind.
 */
@Injectable()
export class ProductImportService {
  constructor(
    @Inject(SessionService)
    private readonly sessions: Pick<
      SessionService,
      'withTransaction' | 'withExclusiveTransaction' | 'resolveForMutation'
    >,
    @Inject(AuthThrottleService) private readonly throttle: Pick<AuthThrottleService, 'now'>,
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
  ) {}

  list(token: string | undefined): Promise<ProductImportListResponse> {
    return this.run(token, undefined, false, (context) => core.listJobs(context));
  }

  detail(token: string | undefined, id: string): Promise<ProductImportDetailResponse> {
    const job = this.id(id);
    return this.run(token, undefined, false, (context) => core.getJob(context, job));
  }

  async template(
    token: string | undefined,
    kind: string,
    format: string,
    language: string,
  ): Promise<TemplateFile> {
    if (!KINDS.includes(kind as ProductImportKindName))
      throw new AuthError('VALIDATION_FAILED', 'kind');
    if (format !== 'xlsx' && format !== 'csv') throw new AuthError('VALIDATION_FAILED', 'format');
    if (language !== 'vi' && language !== 'en') throw new AuthError('VALIDATION_FAILED', 'lang');
    await this.run(token, undefined, false, async (context) => core.requireImport(context));
    return buildTemplate(
      kind as ProductImportKindName,
      format as TemplateFormat,
      language as TemplateLanguage,
    );
  }

  async upload(
    token: string | undefined,
    file: UploadedSheet | undefined,
    fields: { kind?: unknown; branchId?: unknown },
    requestId?: string,
  ): Promise<ProductImportDetailResponse> {
    if (!file || !Buffer.isBuffer(file.buffer)) throw new AuthError('VALIDATION_FAILED', 'file');
    const kind = fields.kind;
    if (typeof kind !== 'string' || !KINDS.includes(kind as ProductImportKindName)) {
      throw new AuthError('VALIDATION_FAILED', 'kind');
    }
    const branchId =
      fields.branchId === undefined || fields.branchId === '' ? null : fields.branchId;
    if (branchId !== null && (typeof branchId !== 'string' || !UUID.test(branchId))) {
      throw new AuthError('VALIDATION_FAILED', 'branchId');
    }
    if ((kind === 'OPENING_STOCK') !== (branchId !== null)) {
      throw new AuthError('VALIDATION_FAILED', 'branchId');
    }
    // 1. Authorize before any parsing work.
    await this.run(token, requestId, false, async (context) => core.requireImport(context));
    // 2. Read the file (no database).
    if (file.buffer.length > IMPORT_LIMITS.maxBytes)
      throw new AuthError('IMPORT_FILE_INVALID', REASONS.too_large);
    const filename = cleanFilename(file.originalname);
    let sheet;
    try {
      sheet = readSpreadsheet(file.buffer, filename);
    } catch (error) {
      if (error instanceof SpreadsheetError)
        throw new AuthError('IMPORT_FILE_INVALID', REASONS[error.reason]);
      throw new AuthError('IMPORT_FILE_INVALID', 'corrupt');
    }
    const map = mapColumns(kind as ProductImportKindName, sheet.header.cells);
    if (map.missing.length > 0) {
      // Only SKU and quantity are required columns, so the field is missingSku, missingQuantity or missingSkuQuantity.
      throw new AuthError(
        'IMPORT_FILE_INVALID',
        `missing${map.missing.map((key) => key[0]!.toUpperCase() + key.slice(1)).join('')}`,
      );
    }
    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    // 3. Plan and store the preview.
    return this.run(token, requestId, true, (context) =>
      core.uploadJob(context, {
        kind: kind as ProductImportKindName,
        branchId: (branchId as string | null)?.toLowerCase() ?? null,
        filename,
        sha256,
        sheet,
        map,
      }),
    );
  }

  apply(
    token: string | undefined,
    id: string,
    body: ProductImportApplyRequest,
    requestId?: string,
  ): Promise<ProductImportDetailResponse> {
    const job = this.id(id);
    return this.run(token, requestId, true, (context) => core.applyJob(context, job, body));
  }

  cancel(
    token: string | undefined,
    id: string,
    body: ProductImportCancelRequest,
    requestId?: string,
  ): Promise<ProductImportDetailResponse> {
    const job = this.id(id);
    return this.run(token, requestId, false, (context) => core.cancelJob(context, job, body));
  }

  private id(value: string | undefined): string {
    if (typeof value !== 'string' || !UUID.test(value)) throw new AuthError('NOT_FOUND');
    return value.toLowerCase();
  }

  private run<T>(
    token: string | undefined,
    requestId: string | undefined,
    long: boolean,
    work: (context: AdminContext) => Promise<T>,
  ): Promise<T> {
    return runAdminCommand(
      { sessions: this.sessions, throttle: this.throttle },
      token,
      { exclusive: false, requestId, ...(long ? { timeoutMs: BATCH_TIMEOUT_MS } : {}) },
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
