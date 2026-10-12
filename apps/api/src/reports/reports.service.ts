import {
  REPORT_DEFINITIONS,
  type RefundReport,
  type ReportRegistryResponse,
  type RevenueReport,
} from '@lucy-spa/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { SessionService } from '../auth/session.service.js';
import { refundReport, type RefundQuery } from './refunds.core.js';
import { runReport, type ReportContext, type ReportKind } from './report.frame.js';
import { revenueReport, type RevenueQuery } from './revenue.core.js';

/**
 * Phase 8: the reports. Every method runs in the read-only frame (`runReport`); nothing here writes. The one write of the whole area
 * (the audit row of an exported file, P8-4) is made by the export service in its own transaction after the data was read.
 */
@Injectable()
export class ReportsService {
  constructor(
    @Inject(SessionService)
    private readonly sessions: Pick<SessionService, 'withReadOnlyTransaction' | 'resolve'>,
    @Inject(AuthThrottleService) private readonly throttle: Pick<AuthThrottleService, 'now'>,
  ) {}

  /** What this person may open: drives the menu. A report with no covered branch is `available: false`, never an error. */
  registry(token: string | undefined): Promise<ReportRegistryResponse> {
    return this.run(token, 'dashboard', async (context) => {
      const reports = REPORT_DEFINITIONS.map((definition) => {
        const covered = context.allBranches.filter((branch) =>
          definition.requires.every((permission) => context.can(permission, branch.id)),
        );
        const exportable =
          definition.exportable &&
          covered.some((branch) => context.can('EXPORT_REPORTS', branch.id));
        return {
          id: definition.id,
          area: definition.area,
          wave: definition.wave,
          available: covered.length > 0,
          exportable,
          exportReauth: definition.exportReauth,
          branchIds: covered.map((branch) => branch.id),
        };
      });
      const seen = new Set(reports.flatMap((report) => report.branchIds));
      return {
        generatedAt: context.now.toISOString(),
        branches: context.allBranches
          .filter((branch) => seen.has(branch.id))
          .map(({ id, code, name }) => ({ id, code, name })),
        reports,
      };
    });
  }

  /** R1-R4: revenue overview, by branch, side and kind, channel and method (one payload; the screens regroup it). */
  revenue(token: string | undefined, query: RevenueQuery): Promise<RevenueReport> {
    return this.run(token, 'report', (context) => revenueReport(context, query));
  }

  /** R10: refunds, exchange differences and reversed payments of a period. */
  refunds(token: string | undefined, query: RefundQuery): Promise<RefundReport> {
    return this.run(token, 'report', (context) => refundReport(context, query));
  }

  /** The single entry for the reports of the later Steps. */
  run<T>(
    token: string | undefined,
    kind: ReportKind,
    work: (context: ReportContext) => Promise<T>,
  ): Promise<T> {
    return runReport({ sessions: this.sessions, throttle: this.throttle }, token, kind, work);
  }
}
