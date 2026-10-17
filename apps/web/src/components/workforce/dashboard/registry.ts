import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { WidgetId, WidgetProps } from '../../../lib/workforce/dashboard/widgets';

// The component of every widget, loaded on demand so the chart kit only ships when a chart widget shows
// (docs/UXUI_REDESIGN_DESIGN.md 14.1). The metadata (id, sizes, permissions) is `lib/workforce/dashboard/widgets.ts`;
// a new widget is one entry there and one entry here. The `Record` type makes a missing entry a compile error.

type WidgetModule = { default: ComponentType<WidgetProps> };
type WidgetComponent = LazyExoticComponent<ComponentType<WidgetProps>>;

const WIDGET_LOADERS: Record<WidgetId, () => Promise<WidgetModule>> = {
  todayBookings: () =>
    import('./booking-widgets').then((m) => ({ default: m.TodayBookingsWidget })),
  inService: () => import('./booking-widgets').then((m) => ({ default: m.InServiceWidget })),
  waiting: () => import('./booking-widgets').then((m) => ({ default: m.WaitingWidget })),
  awaitingInvoice: () =>
    import('./invoice-widgets').then((m) => ({ default: m.AwaitingInvoiceWidget })),
  paymentAlerts: () =>
    import('./invoice-widgets').then((m) => ({ default: m.PaymentAlertsWidget })),
  revenue: () => import('./revenue-widget').then((m) => ({ default: m.RevenueWidget })),
  stockAlerts: () => import('./report-widgets').then((m) => ({ default: m.StockAlertsWidget })),
  refundsToday: () => import('./report-widgets').then((m) => ({ default: m.RefundsTodayWidget })),
  onlineOrders: () => import('./report-widgets').then((m) => ({ default: m.OnlineOrdersWidget })),
  cashAlerts: () => import('./money-widgets').then((m) => ({ default: m.CashAlertsWidget })),
  payrollAlerts: () => import('./money-widgets').then((m) => ({ default: m.PayrollAlertsWidget })),
  pendingLeave: () => import('./personal-widgets').then((m) => ({ default: m.PendingLeaveWidget })),
  myAttendance: () => import('./personal-widgets').then((m) => ({ default: m.MyAttendanceWidget })),
  myLeave: () => import('./personal-widgets').then((m) => ({ default: m.MyLeaveWidget })),
  notifications: () =>
    import('./personal-widgets').then((m) => ({ default: m.NotificationsWidget })),
  quickLinks: () => import('./personal-widgets').then((m) => ({ default: m.QuickLinksWidget })),
};

export const WIDGET_COMPONENTS = Object.fromEntries(
  Object.entries(WIDGET_LOADERS).map(([id, load]) => [id, lazy(load)]),
) as Record<WidgetId, WidgetComponent>;

/**
 * Starts loading the chunks of the widgets on screen as soon as the layout is known (rbp bundle-preload), instead of when each
 * host first renders (a branch widget waits for the branch list). The module cache makes the later `lazy` load instant.
 */
export function preloadWidgets(ids: readonly WidgetId[]): void {
  for (const id of ids) void WIDGET_LOADERS[id]().catch(() => undefined);
}
