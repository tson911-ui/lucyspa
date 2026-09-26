import type { IncomePeriod, MyIncomeResponse, UnavailableIncomeSource } from '@lucy-spa/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { AuthError } from '../auth/auth.error.js';
import { SessionService } from '../auth/session.service.js';
import { runAdminCommand } from '../authorization/admin-command.js';
import { formatMinute, parseWorkDate } from '../collaborator-work/collaborator-work.rules.js';
import { businessToday, day } from '../employees/employment.js';
import { currentClassification, titleOfEmployee } from '../employees/workforce-title.js';

/** Sources a later module will provide; shown as "not yet available", never as 0. */
const FUTURE_SOURCES: UnavailableIncomeSource[] = [
  'SERVICE_TOUR',
  'COMMISSION',
  'TIPS',
  'ADJUSTMENTS',
];

const DAY_MS = 86_400_000;

/**
 * The calendar range of a period around an anchor date. Work dates are branch-local
 * calendar dates already, so no timezone conversion happens here: DAY is the date itself,
 * WEEK is ISO (Monday–Sunday) and MONTH is the calendar month.
 */
export function incomePeriod(kind: IncomePeriod, anchor: Date): { from: Date; to: Date } {
  if (kind === 'DAY') return { from: anchor, to: anchor };
  if (kind === 'WEEK') {
    const monday = new Date(anchor.getTime() - ((anchor.getUTCDay() + 6) % 7) * DAY_MS);
    return { from: monday, to: new Date(monday.getTime() + 6 * DAY_MS) };
  }
  const from = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));
  const to = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 0));
  return { from, to };
}

/**
 * "Thu nhập của tôi / My Income" (follow-up Step 7): a read model over the authoritative
 * compensation sources that exist today. It writes nothing and stores no income rows:
 *
 * - collaborator work: the Step 6 occurrences and their agreed pay (the same rows payroll
 *   and branch finance will reference later), SCHEDULED only, by branch-local work date;
 * - base salary: the current monthly amount on the employee profile, shown for official
 *   employees (managers included) as configured, never prorated or turned into earnings.
 *
 * The subject is always the session's own user; no identifier is accepted.
 */
@Injectable()
export class MyIncomeService {
  constructor(
    @Inject(SessionService)
    private readonly sessions: Pick<
      SessionService,
      'withTransaction' | 'withExclusiveTransaction' | 'resolveForMutation'
    >,
    @Inject(AuthThrottleService) private readonly throttle: Pick<AuthThrottleService, 'now'>,
  ) {}

  async get(
    sessionToken: string | undefined,
    query: { period?: string; date?: string },
  ): Promise<MyIncomeResponse> {
    const requested = query.period ?? 'MONTH';
    if (requested !== 'DAY' && requested !== 'WEEK' && requested !== 'MONTH') {
      throw new AuthError('VALIDATION_FAILED', 'period');
    }
    const kind: IncomePeriod = requested;
    const anchorInput = query.date === undefined ? null : parseWorkDate(query.date, 'date');
    return runAdminCommand(
      { sessions: this.sessions, throttle: this.throttle },
      sessionToken,
      { exclusive: false },
      async ({ tx, actor }) => {
        const user = await tx.user.findUnique({
          where: { id: actor.userId },
          select: {
            kind: true,
            employeeProfile: {
              select: {
                baseSalaryVnd: true,
                branchAssignments: { where: { revokedAt: null }, select: { branchId: true } },
              },
            },
          },
        });
        if (!user || (user.kind !== 'OWNER' && user.kind !== 'EMPLOYEE')) {
          throw new AuthError('FORBIDDEN');
        }
        const profile = user.employeeProfile;
        const branchIds = profile?.branchAssignments.map((row) => row.branchId) ?? [];
        const anchor = anchorInput ?? (await businessToday(tx, branchIds));
        const range = incomePeriod(kind, anchor);
        const period = { kind, date: day(anchor), from: day(range.from), to: day(range.to) };
        // The Owner has no employee profile and no personal compensation source here.
        if (user.kind === 'OWNER' || !profile) {
          return {
            kind: 'OWNER',
            title: 'OWNER',
            classification: null,
            period,
            baseSalary: null,
            collaboratorWork: null,
            unavailableSources: [],
          };
        }
        const classification = await currentClassification(tx, actor.userId, branchIds);
        const official = classification === 'OFFICIAL_EMPLOYEE';
        const rows = await tx.collaboratorWorkOccurrence.findMany({
          where: {
            employeeUserId: actor.userId,
            status: 'SCHEDULED',
            workDate: { gte: range.from, lte: range.to },
          },
          orderBy: [{ workDate: 'asc' }, { startMinute: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            workDate: true,
            branchId: true,
            mode: true,
            startMinute: true,
            endMinute: true,
            agreedPayVnd: true,
          },
        });
        const collaborator = classification === 'COLLABORATOR' || rows.length > 0;
        return {
          kind: 'EMPLOYEE',
          title: await titleOfEmployee(tx, actor.userId, branchIds),
          classification,
          period,
          baseSalary: official
            ? { amountVnd: profile.baseSalaryVnd?.toString() ?? null, unit: 'MONTH' }
            : null,
          collaboratorWork: collaborator ? summarize(rows) : null,
          unavailableSources: official || collaborator ? FUTURE_SOURCES : [],
        };
      },
    );
  }
}

interface Row {
  id: string;
  workDate: Date;
  branchId: string;
  mode: 'SHIFT' | 'FULL_DAY';
  startMinute: number;
  endMinute: number;
  agreedPayVnd: bigint | null;
}

/** Exact bigint sums; an occurrence without agreed pay is counted, never added as 0. */
function summarize(rows: Row[]): NonNullable<MyIncomeResponse['collaboratorWork']> {
  const branches = new Map<string, { total: bigint; count: number; unagreed: number }>();
  let total = 0n;
  let unagreed = 0;
  for (const row of rows) {
    const branch = branches.get(row.branchId) ?? { total: 0n, count: 0, unagreed: 0 };
    branch.count += 1;
    if (row.agreedPayVnd === null) {
      unagreed += 1;
      branch.unagreed += 1;
    } else {
      total += row.agreedPayVnd;
      branch.total += row.agreedPayVnd;
    }
    branches.set(row.branchId, branch);
  }
  return {
    totalAgreedPayVnd: total.toString(),
    occurrenceCount: rows.length,
    unagreedCount: unagreed,
    byBranch: [...branches.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([branchId, entry]) => ({
        branchId,
        totalAgreedPayVnd: entry.total.toString(),
        occurrenceCount: entry.count,
        unagreedCount: entry.unagreed,
      })),
    items: rows.map((row) => ({
      id: row.id,
      workDate: day(row.workDate),
      branchId: row.branchId,
      mode: row.mode,
      startTime: formatMinute(row.startMinute),
      endTime: formatMinute(row.endMinute),
      agreedPayVnd: row.agreedPayVnd === null ? null : row.agreedPayVnd.toString(),
    })),
  };
}
