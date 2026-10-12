import {
  REPORT_DEFINITIONS,
  REPORT_EXPORT_FORMATS,
  REPORT_LIMITS,
  type ReportDefinition,
  type ReportExportRequest,
} from '@lucy-spa/contracts';
import { toCsv, toXlsx, type ExportSheet } from '@lucy-spa/server';
import { Inject, Injectable } from '@nestjs/common';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { AuthError } from '../auth/auth.error.js';
import { SessionService } from '../auth/session.service.js';
import {
  appendAdminAudit,
  runAdminCommand,
  type AdminCommandDependencies,
} from '../authorization/admin-command.js';
import { decide } from '../authorization/authorization.js';
import { spendConfirmation, takeFreshConfirmation } from '../finance/finance.reauth.js';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';
import { builderFor } from './export.builders.js';
import { exportWords, type ExportLocale } from './export.labels.js';
import { runReport, type ReportBranch } from './report.frame.js';

/**
 * Phase 8 P8-4 (design section 6, P8-T9): a report as a file. Two transactions, in this order:
 *
 *   1. the report is READ in its read-only snapshot (permission `EXPORT_REPORTS` and the report's own permissions at the SAME branches,
 *      the row cap, the file bytes);
 *   2. one short command transaction makes the file leave: it decides the permission again, spends the fresh password confirmation for
 *      pay and profit reports, and writes the audit row `REPORT_EXPORTED`. If it fails, no file is returned.
 *
 * This is the only write of the whole report area. At most two files at a time per person.
 */

export interface ExportResult {
  filename: string;
  contentType: string;
  bytes: Uint8Array;
  rows: number;
}

const CONTENT_TYPE = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv; charset=utf-8',
} as const;

const AUDIT_CLASS = (definition: ReportDefinition) => {
  const permissions = [...definition.requires, ...(definition.columnPermissions ?? [])];
  if (permissions.includes('VIEW_EMPLOYEE_PAY') || definition.area === 'staff') {
    return 'EMPLOYEE_PAY' as const;
  }
  if (['revenue', 'money', 'profit'].includes(definition.area)) return 'FINANCIAL' as const;
  return 'STANDARD' as const;
};

@Injectable()
export class ReportExportService {
  private readonly inFlight = new Map<string, number>();

  constructor(
    @Inject(SessionService)
    private readonly sessions: Pick<
      SessionService,
      | 'withReadOnlyTransaction'
      | 'resolve'
      | 'withTransaction'
      | 'withExclusiveTransaction'
      | 'resolveForMutation'
    >,
    @Inject(AuthThrottleService) private readonly throttle: Pick<AuthThrottleService, 'now'>,
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
  ) {}

  async export(
    token: string | undefined,
    request: ReportExportRequest,
    requestId?: string,
    options: { maxRows?: number } = {},
  ): Promise<ExportResult> {
    const definition = REPORT_DEFINITIONS.find((entry) => entry.id === request.report);
    if (!definition) throw new AuthError('VALIDATION_FAILED', 'report');
    if (!definition.exportable) throw new AuthError('NOT_FOUND');
    const builder = builderFor(definition.id);
    if (!(REPORT_EXPORT_FORMATS as readonly string[]).includes(request.format)) {
      throw new AuthError('VALIDATION_FAILED', 'format');
    }
    if (request.locale !== undefined && request.locale !== 'vi' && request.locale !== 'en') {
      throw new AuthError('VALIDATION_FAILED', 'locale');
    }
    const locale: ExportLocale = request.locale === 'en' ? 'en' : 'vi';
    const words = exportWords(locale);
    const maxRows = options.maxRows ?? REPORT_LIMITS.maxExportRows;

    const principal = await this.sessions.resolve(token);
    if (principal?.kind !== 'AUTHENTICATED' || principal.userId === null) {
      throw new AuthError('AUTHENTICATION_REQUIRED');
    }
    const person = principal.userId;
    if ((this.inFlight.get(person) ?? 0) >= REPORT_LIMITS.maxParallelExports) {
      throw new AuthError('EXPORT_BUSY');
    }
    this.inFlight.set(person, (this.inFlight.get(person) ?? 0) + 1);
    try {
      // 1. Read the report and make the bytes.
      const made = await runReport(
        { sessions: this.sessions, throttle: this.throttle },
        token,
        'export',
        async (context) => {
          const covered = context.scope(
            ['EXPORT_REPORTS', ...definition.requires],
            request.branchId,
          );
          const built = await builder(context, covered, request, words, maxRows);
          if (built.rows > maxRows) throw new AuthError('REPORT_TOO_MANY_ROWS');
          const user = await context.tx.user.findUnique({
            where: { id: context.actor.userId },
            select: { fullName: true },
          });
          const zone = covered[0]?.timezone ?? 'Asia/Ho_Chi_Minh';
          const exportedAt = context.now.toLocaleString('sv-SE', { timeZone: zone });
          const info: ExportSheet = {
            name: words.sheetInfo,
            columns: [
              { header: words.info.report, kind: 'text' },
              { header: definitionTitle(words, definition.id), kind: 'text' },
            ],
            rows: [
              ...(built.period
                ? [[words.info.period, `${built.period.from} → ${built.period.to}`]]
                : []),
              ...(built.compared
                ? [[words.info.compared, `${built.compared.from} → ${built.compared.to}`]]
                : []),
              [words.info.branches, covered.map((branch) => branch.name).join(', ')],
              [words.info.rows, String(built.rows)],
              [words.info.exportedAt, `${exportedAt} (${zone})`],
              [words.info.exportedBy, user?.fullName ?? ''],
              ...(definition.area === 'revenue' ? [[words.info.definition, words.definition]] : []),
            ],
          };
          const bytes = request.format === 'csv' ? toCsv(built.main) : toXlsx([built.main, info]);
          const stamp = built.period
            ? `${built.period.from}_${built.period.to}`
            : context.now.toISOString().slice(0, 10);
          return {
            bytes,
            rows: built.rows,
            filename: `lucyspa_${definition.id}_${stamp}.${request.format}`,
            covered,
            period: built.period,
          };
        },
      );

      // 2. Let the file leave: decide again, spend the password for pay/profit data, write the audit row.
      await runAdminCommand(
        { sessions: this.sessions, throttle: this.throttle } as AdminCommandDependencies,
        token,
        { exclusive: false, requestId },
        async (context) => {
          for (const branch of made.covered as readonly ReportBranch[]) {
            for (const permission of ['EXPORT_REPORTS', ...definition.requires] as const) {
              if (
                !decide(context.actor.graph, permission, { kind: 'BRANCH', branchId: branch.id })
              ) {
                throw new AuthError('FORBIDDEN');
              }
            }
          }
          if (definition.exportReauth) {
            const confirmedAt = await takeFreshConfirmation(
              context,
              this.environment.auth.freshAuthSeconds,
            );
            await spendConfirmation(context, confirmedAt, 'REPORT_EXPORT', null);
          }
          await appendAdminAudit(context, {
            action: 'REPORT_EXPORTED',
            entityType: 'ReportExport',
            entityId: definition.id,
            branchId: made.covered.length === 1 ? made.covered[0]!.id : null,
            classification: AUDIT_CLASS(definition),
            after: {
              report: definition.id,
              format: request.format,
              from: made.period?.from ?? null,
              to: made.period?.to ?? null,
              branchIds: made.covered.map((branch) => branch.id),
              rows: made.rows,
              bytes: made.bytes.length,
              locale,
            },
          });
        },
      );
      return {
        filename: made.filename,
        contentType: CONTENT_TYPE[request.format],
        bytes: made.bytes,
        rows: made.rows,
      };
    } finally {
      const left = (this.inFlight.get(person) ?? 1) - 1;
      if (left <= 0) this.inFlight.delete(person);
      else this.inFlight.set(person, left);
    }
  }
}

function definitionTitle(words: ReturnType<typeof exportWords>, id: string): string {
  return words.reports[id] ?? id;
}
