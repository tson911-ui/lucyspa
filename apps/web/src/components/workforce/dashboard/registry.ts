import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { WidgetId, WidgetProps } from '../../../lib/workforce/dashboard/widgets';

// The component of every widget, loaded on demand so the chart kit only ships when a chart widget shows
// (docs/UXUI_REDESIGN_DESIGN.md 14.1). The metadata (id, sizes, permissions) is `lib/workforce/dashboard/widgets.ts`;
// a new widget is one entry there and one entry here. The `Record` type makes a missing entry a compile error.

type WidgetComponent = LazyExoticComponent<ComponentType<WidgetProps>>;

export const WIDGET_COMPONENTS: Record<WidgetId, WidgetComponent> = {
  todayBookings: lazy(() =>
    import('./booking-widgets').then((m) => ({ default: m.TodayBookingsWidget })),
  ),
  inService: lazy(() => import('./booking-widgets').then((m) => ({ default: m.InServiceWidget }))),
  waiting: lazy(() => import('./booking-widgets').then((m) => ({ default: m.WaitingWidget }))),
  awaitingInvoice: lazy(() =>
    import('./invoice-widgets').then((m) => ({ default: m.AwaitingInvoiceWidget })),
  ),
  paymentAlerts: lazy(() =>
    import('./invoice-widgets').then((m) => ({ default: m.PaymentAlertsWidget })),
  ),
  revenue: lazy(() => import('./revenue-widget').then((m) => ({ default: m.RevenueWidget }))),
  stockAlerts: lazy(() =>
    import('./report-widgets').then((m) => ({ default: m.StockAlertsWidget })),
  ),
  refundsToday: lazy(() =>
    import('./report-widgets').then((m) => ({ default: m.RefundsTodayWidget })),
  ),
  onlineOrders: lazy(() =>
    import('./report-widgets').then((m) => ({ default: m.OnlineOrdersWidget })),
  ),
  pendingLeave: lazy(() =>
    import('./personal-widgets').then((m) => ({ default: m.PendingLeaveWidget })),
  ),
  myAttendance: lazy(() =>
    import('./personal-widgets').then((m) => ({ default: m.MyAttendanceWidget })),
  ),
  myLeave: lazy(() => import('./personal-widgets').then((m) => ({ default: m.MyLeaveWidget }))),
  notifications: lazy(() =>
    import('./personal-widgets').then((m) => ({ default: m.NotificationsWidget })),
  ),
  quickLinks: lazy(() =>
    import('./personal-widgets').then((m) => ({ default: m.QuickLinksWidget })),
  ),
};
