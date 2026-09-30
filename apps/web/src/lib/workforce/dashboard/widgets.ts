import type { PermissionCodeName } from '@lucy-spa/contracts';
import { canAnywhere, canAt, type Account } from '../permissions';

// Widget metadata (docs/UXUI_REDESIGN_DESIGN.md 14.1). No React here: layout derivation and permission
// gating are pure and tested; `registry.ts` attaches the lazy components. The title of a widget is
// `t.dashboard.widgets[id]`. Everything below is a UX hint: the API authorizes every request again.

export type WidgetSize = 's' | 'm' | 'l' | 'xl';

/** Grid columns of each size on a 12-column desktop grid (contract 14.1). */
export const SIZE_COLUMNS: Record<WidgetSize, number> = { s: 3, m: 6, l: 9, xl: 12 };

export type WidgetId =
  | 'todayBookings'
  | 'inService'
  | 'waiting'
  | 'awaitingInvoice'
  | 'paymentAlerts'
  | 'pendingLeave'
  | 'myAttendance'
  | 'myLeave'
  | 'paidInvoices'
  | 'notifications'
  | 'quickLinks';

/** `branch`: data of the selected branch; `global`: not branch specific; `self`: the signed-in employee. */
export type WidgetScope = 'branch' | 'global' | 'self';

/** What every widget component receives. `branchId` is the dashboard's selected branch (branch widgets). */
export interface WidgetProps {
  branchId: string | null;
  size: WidgetSize;
  /** The localized widget title. */
  title: string;
}

export interface WidgetMeta {
  id: WidgetId;
  scope: WidgetScope;
  /** Sizes offered by the customize mode; the first is not necessarily the default. */
  sizes: readonly WidgetSize[];
  defaultSize: WidgetSize;
  /** Permissions needed at the selected branch (branch widgets only). All must hold there. */
  atBranch?: readonly PermissionCodeName[];
  /** Whether the widget is offered to this account at all (hides it and its "add back" entry). */
  requires: (account: Account) => boolean;
}

const employeeOnly = (account: Account) => account.kind === 'EMPLOYEE';

/**
 * Default order (the default layout is this list filtered by `requires`). Adding a widget later
 * (Phase 8) is one entry here plus one component in `registry.ts`.
 */
export const WIDGETS: readonly WidgetMeta[] = [
  {
    id: 'todayBookings',
    scope: 'branch',
    sizes: ['m', 'xl'],
    defaultSize: 'm',
    atBranch: ['VIEW_BOOKINGS'],
    requires: (account) => canAnywhere(account, 'VIEW_BOOKINGS'),
  },
  {
    id: 'inService',
    scope: 'branch',
    sizes: ['m', 'xl'],
    defaultSize: 'm',
    atBranch: ['VIEW_BOOKINGS'],
    requires: (account) => canAnywhere(account, 'VIEW_BOOKINGS'),
  },
  {
    id: 'waiting',
    scope: 'branch',
    sizes: ['s', 'm'],
    defaultSize: 's',
    atBranch: ['VIEW_BOOKINGS'],
    requires: (account) => canAnywhere(account, 'VIEW_BOOKINGS'),
  },
  {
    id: 'awaitingInvoice',
    scope: 'branch',
    sizes: ['s', 'm'],
    defaultSize: 's',
    atBranch: ['VIEW_INVOICES'],
    requires: (account) => canAnywhere(account, 'VIEW_INVOICES'),
  },
  {
    id: 'paymentAlerts',
    scope: 'branch',
    sizes: ['s', 'm'],
    defaultSize: 's',
    atBranch: ['CORRECT_PAYMENTS'],
    requires: (account) => canAnywhere(account, 'CORRECT_PAYMENTS'),
  },
  {
    id: 'pendingLeave',
    scope: 'global',
    sizes: ['s', 'm'],
    defaultSize: 's',
    requires: (account) => canAnywhere(account, 'APPROVE_LEAVE'),
  },
  {
    id: 'myAttendance',
    scope: 'self',
    sizes: ['m', 'xl'],
    defaultSize: 'm',
    // The same rule as the attendance page in `navigationFor`.
    requires: (account) => employeeOnly(account) && account.attendanceRequired !== false,
  },
  {
    id: 'myLeave',
    scope: 'self',
    sizes: ['s', 'm'],
    defaultSize: 'm',
    requires: employeeOnly,
  },
  {
    id: 'paidInvoices',
    scope: 'branch',
    sizes: ['m', 'xl'],
    defaultSize: 'xl',
    atBranch: ['VIEW_INVOICES', 'VIEW_REVENUE'],
    requires: (account) =>
      canAnywhere(account, 'VIEW_INVOICES') && canAnywhere(account, 'VIEW_REVENUE'),
  },
  {
    id: 'notifications',
    scope: 'self',
    sizes: ['m', 'xl'],
    defaultSize: 'm',
    requires: () => true,
  },
  {
    id: 'quickLinks',
    scope: 'global',
    sizes: ['m', 'xl'],
    defaultSize: 'm',
    requires: () => true,
  },
];

/** Widgets this account may be offered, in default order. */
export function availableWidgets(account: Account): WidgetMeta[] {
  return WIDGETS.filter((widget) => widget.requires(account));
}

/** Whether a branch widget's permissions hold at this branch (a hint; a 403 shows the same state). */
export function allowedAtBranch(account: Account, widget: WidgetMeta, branchId: string): boolean {
  return (widget.atBranch ?? []).every((permission) => canAt(account, permission, branchId));
}

/** Branches where at least one branch widget may show data: the choices of the scope selector. */
export function widgetBranchIds(account: Account, branchIds: readonly string[]): string[] {
  const widgets = availableWidgets(account).filter((widget) => widget.scope === 'branch');
  return branchIds.filter((id) => widgets.some((widget) => allowedAtBranch(account, widget, id)));
}
