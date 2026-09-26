import type {
  CustomerBookingAvailabilityResponse,
  CustomerBookingBranchesResponse,
  CustomerBookingBranchResponse,
  CustomerBookingCancelRequest,
  CustomerBookingCreateRequest,
  CustomerBookingDetail,
  CustomerBookingEmployeesResponse,
  CustomerBookingListResponse,
} from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import { Inject, Injectable } from '@nestjs/common';
import {
  evaluateSequenceAt,
  loadAvailabilityFacts,
  qualifiedEmployeesByService,
  readAvailabilitySettings,
} from '../availability/availability.engine.js';
import { AuthError } from '../auth/auth.error.js';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { SessionService } from '../auth/session.service.js';
import { formatMinute, parseWorkDate } from '../collaborator-work/collaborator-work.rules.js';
import {
  BOOKING_LIMITS,
  cancelCustomerBooking,
  createCustomerBooking,
  customerBookingDetail,
  customerBookingList,
  loadTieBreakFacts,
  normalizeCreateRequest,
} from './booking.core.js';
import { planAssignment } from './booking.planner.js';
import { runCustomerCommand } from './customer-command.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function uuidList(value: string | undefined, field: string, max: number): string[] {
  const items = (value ?? '').split(',').filter((item) => item !== '');
  if (items.length === 0 || items.length > max || !items.every((item) => UUID.test(item))) {
    throw new AuthError('VALIDATION_FAILED', field);
  }
  return items.map((item) => item.toLowerCase());
}

/**
 * Member booking for the signed-in customer (Phase 3 Step 4). The session is the only
 * identity: every read and command is scoped to the session's customer, and nothing here
 * accepts an owner id. Availability always comes from the Step 3 engine; the web app never
 * decides it. Lookups reserve nothing; `create` locks, re-checks and writes in one transaction.
 */
@Injectable()
export class CustomerBookingService {
  constructor(
    @Inject(SessionService)
    private readonly sessions: Pick<SessionService, 'withTransaction' | 'resolveForMutation'>,
    @Inject(AuthThrottleService) private readonly throttle: Pick<AuthThrottleService, 'now'>,
  ) {}

  branches(token: string | undefined): Promise<CustomerBookingBranchesResponse> {
    return this.run(token, async ({ tx }) => ({
      branches: await tx.branch.findMany({
        where: { isActive: true },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        select: { id: true, code: true, name: true },
      }),
    }));
  }

  branch(token: string | undefined, branchId: string): Promise<CustomerBookingBranchResponse> {
    return this.run(token, async ({ tx, now }) => {
      const branch = await this.activeBranch(tx, branchId);
      const settings = await readAvailabilitySettings(tx);
      const [clock] = await tx.$queryRaw<{ today: string; last: string }[]>`
        SELECT to_char(${now}::timestamptz AT TIME ZONE ${branch.timezone}, 'YYYY-MM-DD') AS today,
               to_char((${now}::timestamptz AT TIME ZONE ${branch.timezone})::date
                 + ${settings.maxAdvanceDays}::int, 'YYYY-MM-DD') AS last`;
      if (!clock) throw new AuthError('SERVICE_UNAVAILABLE');
      const services = await tx.service.findMany({
        where: { isActive: true, branches: { some: { branchId: branch.id, isActive: true } } },
        orderBy: [{ category: { nameVi: 'asc' } }, { nameVi: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          code: true,
          nameVi: true,
          nameEn: true,
          durationMinutes: true,
          priceVnd: true,
          priceMaxVnd: true,
          pricingUnit: true,
          category: { select: { nameVi: true, nameEn: true } },
        },
      });
      return {
        branch: { id: branch.id, code: branch.code, name: branch.name, timezone: branch.timezone },
        firstDate: clock.today,
        lastDate: clock.last,
        services: services.map((service) => ({
          id: service.id,
          code: service.code,
          nameVi: service.nameVi,
          nameEn: service.nameEn,
          categoryNameVi: service.category.nameVi,
          categoryNameEn: service.category.nameEn,
          durationMinutes: service.durationMinutes,
          priceMinVnd: service.priceVnd.toString(),
          priceMaxVnd: service.priceMaxVnd.toString(),
          pricingUnit: service.pricingUnit,
        })),
      };
    });
  }

  /** KTVs qualified for each service (time-independent rules of the engine), names only. */
  async employees(
    token: string | undefined,
    branchId: string,
    serviceIdsParam: string | undefined,
  ): Promise<CustomerBookingEmployeesResponse> {
    const serviceIds = uuidList(serviceIdsParam, 'serviceIds', BOOKING_LIMITS.maxLines);
    return this.run(token, async ({ tx, now }) => {
      const branch = await this.activeBranch(tx, branchId);
      const [clock] = await tx.$queryRaw<{ today: string }[]>`
        SELECT to_char(${now}::timestamptz AT TIME ZONE ${branch.timezone}, 'YYYY-MM-DD') AS today`;
      if (!clock) throw new AuthError('SERVICE_UNAVAILABLE');
      const facts = await loadAvailabilityFacts(tx, {
        branchId: branch.id,
        serviceDate: clock.today,
        serviceIds,
        context: 'REVALIDATION',
        now,
      });
      const qualified = qualifiedEmployeesByService(facts);
      const names = await tx.user.findMany({
        where: { id: { in: [...new Set(qualified.flat())] } },
        select: { id: true, fullName: true },
      });
      const nameById = new Map(names.map((row) => [row.id, row.fullName]));
      return {
        services: serviceIds.map((serviceId, index) => ({
          serviceId,
          employees: (qualified[index] ?? [])
            .map((id) => ({ id, displayName: nameById.get(id) ?? '' }))
            .sort(
              (a, b) => a.displayName.localeCompare(b.displayName, 'vi') || (a.id < b.id ? -1 : 1),
            ),
        })),
      };
    });
  }

  /**
   * Starts on the configured slot grid where the whole ordered sequence can be planned with
   * the requested KTV choices (the same planner as `create`). Advisory only.
   */
  async availability(
    token: string | undefined,
    query: { branchId?: string; date?: string; serviceIds?: string; employees?: string },
  ): Promise<CustomerBookingAvailabilityResponse> {
    if (!query.branchId || !UUID.test(query.branchId))
      throw new AuthError('VALIDATION_FAILED', 'branchId');
    const date = query.date ?? '';
    parseWorkDate(date, 'date');
    const serviceIds = uuidList(query.serviceIds, 'serviceIds', BOOKING_LIMITS.maxLines);
    const choices = (query.employees ?? '').split(',');
    if (
      choices.length !== serviceIds.length ||
      !choices.every((choice) => choice === 'ANY' || UUID.test(choice))
    ) {
      throw new AuthError('VALIDATION_FAILED', 'employees');
    }
    const lines = serviceIds.map((serviceId, index) => ({
      serviceId,
      employeeUserId: choices[index] === 'ANY' ? null : (choices[index] ?? '').toLowerCase(),
    }));
    const branchId = query.branchId.toLowerCase();
    return this.run(token, async ({ tx, now, customerUserId }) => {
      await this.activeBranch(tx, branchId);
      const facts = await loadAvailabilityFacts(tx, {
        branchId,
        serviceDate: date,
        serviceIds,
        context: 'BOOKING',
        now,
        customerUserId,
      });
      if (!facts.window) return { date, starts: [] };
      const tie = await loadTieBreakFacts(tx, {
        branchId,
        date: parseWorkDate(date, 'date'),
        employeeUserIds: facts.employees.map((employee) => employee.userId),
      });
      const starts: string[] = [];
      const step = facts.settings.slotIntervalMinutes;
      for (let minute = facts.window.startMinute; minute < facts.window.endMinute; minute += step) {
        if (planAssignment(evaluateSequenceAt(facts, minute), lines, tie).ok) {
          starts.push(formatMinute(minute));
        }
      }
      return { date, starts };
    });
  }

  async create(
    token: string | undefined,
    body: CustomerBookingCreateRequest,
  ): Promise<CustomerBookingDetail> {
    const request = normalizeCreateRequest(body);
    return this.run(token, async ({ tx, now, customerUserId }) => {
      const id = await createCustomerBooking(tx, customerUserId, request, now);
      return customerBookingDetail(tx, customerUserId, id);
    });
  }

  list(token: string | undefined): Promise<CustomerBookingListResponse> {
    return this.run(token, ({ tx, now, customerUserId }) =>
      customerBookingList(tx, customerUserId, now),
    );
  }

  async detail(token: string | undefined, bookingId: string): Promise<CustomerBookingDetail> {
    if (!UUID.test(bookingId)) throw new AuthError('NOT_FOUND');
    return this.run(token, ({ tx, customerUserId }) =>
      customerBookingDetail(tx, customerUserId, bookingId.toLowerCase()),
    );
  }

  async cancel(
    token: string | undefined,
    bookingId: string,
    body: CustomerBookingCancelRequest,
  ): Promise<CustomerBookingDetail> {
    if (!UUID.test(bookingId)) throw new AuthError('NOT_FOUND');
    const reason = body.reason?.normalize('NFC').trim() || null;
    if (reason !== null && [...reason].length > BOOKING_LIMITS.reasonMaxCodePoints) {
      throw new AuthError('VALIDATION_FAILED', 'reason');
    }
    const id = bookingId.toLowerCase();
    return this.run(token, async ({ tx, now, customerUserId }) => {
      await cancelCustomerBooking(tx, customerUserId, id, reason, now);
      return customerBookingDetail(tx, customerUserId, id);
    });
  }

  private run<T>(
    token: string | undefined,
    work: Parameters<typeof runCustomerCommand<T>>[2],
  ): Promise<T> {
    return runCustomerCommand({ sessions: this.sessions, throttle: this.throttle }, token, work);
  }

  private async activeBranch(tx: Prisma.TransactionClient, branchId: string) {
    const branch = UUID.test(branchId)
      ? await tx.branch.findFirst({
          where: { id: branchId.toLowerCase(), isActive: true },
          select: { id: true, code: true, name: true, timezone: true },
        })
      : null;
    if (!branch) throw new AuthError('NOT_FOUND');
    return branch;
  }
}
