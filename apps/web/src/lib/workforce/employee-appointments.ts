import type {
  AuthorizationScope,
  EmployeeDirectoryAppointment,
  OrganizationLevel,
} from '@lucy-spa/contracts';

export interface AppointmentNames {
  levels: Record<OrganizationLevel, string>;
  system: string;
  unknown: string;
  region: (id: string) => string | undefined;
  area: (id: string) => string | undefined;
  branch: (id: string) => string | undefined;
}

export function appointmentScopeName(scope: AuthorizationScope, names: AppointmentNames): string {
  switch (scope.kind) {
    case 'GLOBAL':
      return names.system;
    case 'REGION':
      return names.region(scope.regionId) ?? names.unknown;
    case 'AREA':
      return names.area(scope.areaId) ?? names.unknown;
    case 'BRANCH':
      return names.branch(scope.branchId) ?? names.unknown;
  }
}

/**
 * One label per active appointment, e.g. "CEO / Quản lý cấp cao · Toàn hệ thống" or
 * "Trưởng nhóm · Chi nhánh A (Nhóm 1)". Separate from the employment title; several
 * appointments produce several labels, in the order the API returned them.
 */
export function appointmentLabels(
  appointments: readonly EmployeeDirectoryAppointment[] | undefined,
  names: AppointmentNames,
): string[] {
  return (appointments ?? []).map((appointment) => {
    const team = appointment.teamName ? ` (${appointment.teamName})` : '';
    return `${names.levels[appointment.level]} · ${appointmentScopeName(appointment.scope, names)}${team}`;
  });
}
