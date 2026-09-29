import type { WalkInOptionsResponse } from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import {
  loadAvailabilityFacts,
  qualifiedEmployeesByService,
} from '../availability/availability.engine.js';
import { AuthError } from '../auth/auth.error.js';

/**
 * The catalog services offered at a branch today, each with the KTVs passing the time-independent
 * qualification rules (Phase 3 Step 6 walk-in intake; reused by Phase 4 Step 3 staff-added service).
 * Read-only; authorization is decided by the caller. Prices are the catalog reference range, never
 * a billing amount.
 */
export async function loadServiceOptions(
  tx: Prisma.TransactionClient,
  branchId: string,
  now: Date,
): Promise<WalkInOptionsResponse> {
  const branch = await tx.branch.findFirst({
    where: { id: branchId, isActive: true },
    select: { id: true, name: true, timezone: true },
  });
  if (!branch) throw new AuthError('NOT_FOUND');
  const services = await tx.service.findMany({
    where: { isActive: true, branches: { some: { branchId, isActive: true } } },
    orderBy: [{ nameVi: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      nameVi: true,
      nameEn: true,
      durationMinutes: true,
      priceVnd: true,
      priceMaxVnd: true,
      pricingUnit: true,
    },
  });
  if (services.length === 0) return { branch, services: [] };
  const [day] = await tx.$queryRaw<{ day: string }[]>`
    SELECT to_char(${now}::timestamptz AT TIME ZONE ${branch.timezone}, 'YYYY-MM-DD') AS day`;
  const facts = await loadAvailabilityFacts(tx, {
    branchId,
    serviceDate: day!.day,
    serviceIds: services.map((service) => service.id),
    context: 'OPERATIONAL',
    now,
  });
  const qualified = qualifiedEmployeesByService(facts);
  const checkedIn = new Map(
    facts.employees.map((employee) => [employee.userId, employee.checkedIn]),
  );
  const names = new Map(
    (
      await tx.user.findMany({
        where: { id: { in: [...new Set(qualified.flat())] } },
        select: { id: true, fullName: true },
      })
    ).map((row) => [row.id, row.fullName]),
  );
  return {
    branch,
    services: services.map((service, index) => ({
      id: service.id,
      nameVi: service.nameVi,
      nameEn: service.nameEn,
      durationMinutes: service.durationMinutes,
      priceMinVnd: service.priceVnd.toString(),
      priceMaxVnd: service.priceMaxVnd.toString(),
      pricingUnit: service.pricingUnit,
      employees: (qualified[index] ?? [])
        .map((employeeId) => ({
          id: employeeId,
          displayName: names.get(employeeId) ?? '',
          checkedIn: checkedIn.get(employeeId) ?? false,
        }))
        .sort((a, b) => a.displayName.localeCompare(b.displayName, 'vi') || (a.id < b.id ? -1 : 1)),
    })),
  };
}
