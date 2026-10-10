'use client';

import type { BranchSummary, EmployeeDirectoryAppointment } from '@lucy-spa/contracts';
import { organizationDictionary } from '../../../i18n/organization';
import { appointmentLabels } from '../../../lib/workforce/employee-appointments';
import { canAnywhere } from '../../../lib/workforce/permissions';
import { useAccount, useWorkforce } from '../session';
import { Badge } from '../ui';

/**
 * The management level (active Organization Appointments) is separate from the employment
 * title. It is only offered to callers who may see appointments; the API sends nothing to
 * anyone else, so this is a display hint, never an authorization decision.
 */
export function useManagementLevelVisible(): boolean {
  const { account } = useAccount();
  return (
    canAnywhere(account, 'VIEW_ORGANIZATION') || canAnywhere(account, 'MANAGE_ORG_ASSIGNMENTS')
  );
}

/** Every active appointment, none singled out as "main"; "—" when there is none. */
export function ManagementLevels({
  appointments,
  branches,
}: {
  appointments: readonly EmployeeDirectoryAppointment[] | undefined;
  branches: ReadonlyMap<string, BranchSummary> | null;
}) {
  const { locale } = useWorkforce();
  const { account } = useAccount();
  const text = organizationDictionary(locale);
  if (!appointments?.length) return <>—</>;
  const labels = appointmentLabels(appointments, {
    levels: text.levels,
    system: text.system,
    unknown: '—',
    region: (id) => account.organization?.regions.find((row) => row.id === id)?.name,
    area: (id) => account.organization?.areas.find((row) => row.id === id)?.name,
    branch: (id) => branches?.get(id)?.name,
  });
  return (
    <>
      {labels.map((label, index) => (
        <div key={`${appointments[index]!.id}`} title={label}>
          <Badge tone="info">{label}</Badge>
        </div>
      ))}
    </>
  );
}
