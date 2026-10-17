'use client';

import type {
  MyPayslipsResponse,
  PayRunItemView,
  PayslipSummary,
  PayslipView,
} from '@lucy-spa/contracts';
import {
  Breadcrumbs,
  Card,
  CardHeader,
  DataTable,
  DEFAULT_PAGE_SIZE,
  DescriptionList,
  EmptyState,
  ListToolbar,
  PageHeader as KitPageHeader,
  useUrlState,
  type DataTableColumn,
} from '@lucy-spa/ui';
import { payrollDictionary } from '../../../i18n/payroll';
import { fill } from '../../../i18n/workforce';
import { signedVnd, vndNumber } from '../../../lib/workforce/cash';
import { formatDate, formatDateTime, formatVnd } from '../../../lib/workforce/format';
import { normalizePage, normalizePageSize, toolbarLabels } from '../../../lib/workforce/list-view';
import { monthLabel } from '../../../lib/workforce/payroll';
import { urlPaging } from '../../../lib/workforce/url-paging';
import { useClientPaging } from '../../../lib/workforce/use-client-paging';
import { ListCrumbLink, PrefetchLink as Link } from '../link';
import { useWorkforce } from '../session';
import { Badge, Button, ErrorState, Loading, PageHeader, useResource } from '../ui';

const SLIP_TONE = { PENDING: 'warning', PAID: 'success', REVERSED: 'neutral' } as const;
const ZONE = 'Asia/Ho_Chi_Minh';

/**
 * A payslip (Phase 7 P7-15): the person, the month, the items as they were when the payroll was closed, net pay, and the tips shown apart (they
 * are not part of net pay). It prints on its own: the app around it is hidden by the print rules, and the page header's actions with it.
 */
export function PayslipDocument({ slip }: { slip: PayslipView }) {
  const { t, locale } = useWorkforce();
  const p = payrollDictionary(locale);
  const x = p.slip;
  const paging = useClientPaging(t, x.items);
  const pay = slip.items.filter((item) => item.kind !== 'TIP');
  const tips = slip.items.filter((item) => item.kind === 'TIP');
  const columns: DataTableColumn<PayRunItemView>[] = [
    {
      key: 'kind',
      header: p.run.itemColumns.kind,
      mobileTitle: true,
      cell: (item) => (
        <>
          {p.kinds[item.kind]}
          {item.quantity ? (
            <span className="ls-adminb-sub">{fill(p.run.qty, { count: item.quantity })}</span>
          ) : null}
        </>
      ),
    },
    {
      key: 'note',
      header: p.run.itemColumns.note,
      wrap: true,
      hidePhone: true,
      cell: (item) => {
        const parts = [
          item.reason,
          item.lateVnd !== '0'
            ? fill(p.run.lateNote, { amount: signedVnd(vndNumber(item.lateVnd), locale) })
            : null,
        ].filter(Boolean);
        return parts.length > 0 ? parts.join('; ') : '—';
      },
    },
    {
      key: 'amount',
      header: p.run.itemColumns.amount,
      numeric: true,
      cell: (item) => signedVnd(vndNumber(item.amountVnd), locale),
    },
  ];
  return (
    <>
      <Card as="section" aria-label={x.heading}>
        {/* The printed slip carries the shop's text logo and the month; on screen the page header names the month and shows the
            status, so the card does not repeat the h1. */}
        <div className="ls-print-only">
          <p className="ls-adminb-slip-brand" translate="no">
            LUCY SPA
          </p>
          <p className="ls-adminb-heading">{fill(x.title, { month: monthLabel(slip.month) })}</p>
        </div>
        <CardHeader title={slip.employee.name} />
        <DescriptionList
          columns={2}
          items={[
            {
              label: x.employeeCode,
              value: <span translate="no">{slip.employee.code}</span>,
            },
            {
              label: x.period,
              value: `${formatDate(slip.periodFrom, locale)} – ${formatDate(slip.periodTo, locale)}`,
            },
            {
              label: x.paymentDay,
              value: slip.paymentDay ? formatDate(slip.paymentDay, locale) : '—',
            },
            ...(slip.paidAt
              ? [
                  {
                    label: x.status,
                    value: fill(x.paidAt, { time: formatDateTime(slip.paidAt, ZONE, locale) }),
                  },
                ]
              : []),
          ]}
        />
        <DataTable
          mode="client"
          caption={fill(t.common.list.table, { list: x.items })}
          columns={columns}
          rows={pay}
          rowKey={(item) => item.id}
          paging={paging}
        />
        <DescriptionList
          layout="totals"
          items={[{ label: x.net, value: signedVnd(vndNumber(slip.netVnd), locale), strong: true }]}
        />
        {tips.length > 0 ? (
          <DescriptionList
            layout="totals"
            items={[{ label: x.tips, value: signedVnd(vndNumber(slip.tipsVnd), locale) }]}
          />
        ) : null}
        {slip.status === 'REVERSED' && slip.reversalReason ? (
          <p className="ls-hint">{fill(x.reversedNote, { reason: slip.reversalReason })}</p>
        ) : null}
        <p className="ls-hint">{x.footnote}</p>
      </Card>
    </>
  );
}

function PrintButton() {
  const { locale } = useWorkforce();
  return (
    <Button variant="secondary" icon="receipt" onClick={() => window.print()}>
      {payrollDictionary(locale).slip.print}
    </Button>
  );
}

/** One payslip for the people who run payroll (`/payroll/slip/:id`). */
export function PayslipScreen({ id }: { id: string }) {
  const { api, t, locale, base } = useWorkforce();
  const p = payrollDictionary(locale);
  const data = useResource(() => api.get<PayslipView>(`/api/v1/pay/payslips/${id}`), [api, id]);
  if (data.error && !data.data) {
    return (
      <>
        <PageHeader title={p.slip.heading} />
        <ErrorState error={data.error} t={t} onRetry={() => void data.reload()} />
      </>
    );
  }
  if (!data.data) return <Loading t={t} page />;
  const slip = data.data;
  return (
    <>
      <KitPageHeader
        title={fill(p.slip.title, { month: monthLabel(slip.month) })}
        status={<Badge tone={SLIP_TONE[slip.status]}>{p.slipStatuses[slip.status]}</Badge>}
        actions={<PrintButton />}
        breadcrumbs={
          <Breadcrumbs
            label={p.common.breadcrumbs}
            LinkComponent={ListCrumbLink}
            items={[
              { label: p.title, href: `${base}/payroll` },
              { label: monthLabel(slip.month), href: `${base}/payroll/${slip.runId}` },
              { label: slip.employee.name },
            ]}
          />
        }
      />
      <PayslipDocument slip={slip} />
    </>
  );
}

const MY_PAYSLIPS_DEFAULTS = { page: 1, size: DEFAULT_PAGE_SIZE };
const MY_PAYSLIPS_OPTIONS = {
  normalize: (state: typeof MY_PAYSLIPS_DEFAULTS) => ({
    page: normalizePage(state.page),
    size: normalizePageSize(state.size),
  }),
};

/** "Phiếu lương của tôi": the signed-in employee's own payslips. */
export function MyPayslipsScreen() {
  const { api, t, locale, base } = useWorkforce();
  const p = payrollDictionary(locale);
  const data = useResource(() => api.get<MyPayslipsResponse>('/api/v1/me/payslips'), [api]);
  // The pager in the address bar (?page=2): Back/Forward and a shared link restore it.
  const [pager, updatePager] = useUrlState(MY_PAYSLIPS_DEFAULTS, MY_PAYSLIPS_OPTIONS);
  const paging = urlPaging(
    pager.page,
    pager.size,
    ({ page, pageSize }) =>
      updatePager({
        ...(page !== undefined ? { page } : {}),
        ...(pageSize !== undefined ? { size: pageSize } : {}),
      }),
    t,
    p.mine.title,
  );
  if (data.error && !data.data) {
    return (
      <>
        <PageHeader title={p.mine.title} intro={p.mine.intro} />
        <ErrorState error={data.error} t={t} onRetry={() => void data.reload()} />
      </>
    );
  }
  if (!data.data) return <Loading t={t} page />;
  const columns: DataTableColumn<PayslipSummary>[] = [
    {
      key: 'month',
      header: p.mine.columns.month,
      mobileTitle: true,
      cell: (slip) => (
        <Link className="ls-link" href={`${base}/my-payslips/${slip.id}`}>
          {monthLabel(slip.month)}
        </Link>
      ),
    },
    {
      key: 'net',
      header: p.mine.columns.net,
      numeric: true,
      // Intl grouping from the integer string (wig Locale & i18n), never through a float.
      cell: (slip) => formatVnd(slip.netVnd, locale),
    },
    {
      key: 'tips',
      header: p.mine.columns.tips,
      numeric: true,
      hideBelow: 'md',
      hidePhone: true,
      cell: (slip) => (slip.tipsVnd !== '0' ? formatVnd(slip.tipsVnd, locale) : '—'),
    },
    {
      key: 'status',
      header: p.mine.columns.status,
      cell: (slip) => <Badge tone={SLIP_TONE[slip.status]}>{p.slipStatuses[slip.status]}</Badge>,
    },
    {
      key: 'day',
      header: p.mine.columns.paymentDay,
      hideBelow: 'lg',
      hidePhone: true,
      cell: (slip) => (slip.paymentDay ? formatDate(slip.paymentDay, locale) : '—'),
    },
  ];
  return (
    <>
      <PageHeader title={p.mine.title} intro={p.mine.intro} />
      {/* The page's one list: no "Các tháng" h2 repeating the page, no count line for an empty list. */}
      <div className="ls-self-list">
        <ListToolbar
          labels={toolbarLabels(t)}
          reload={{ label: t.common.reload, onClick: () => void data.reload() }}
          resultCount={
            data.data.items.length > 0
              ? fill(t.common.list.results, { count: data.data.items.length })
              : undefined
          }
        />
        <DataTable
          drillDown
          mode="client"
          caption={fill(t.common.list.table, { list: p.mine.title })}
          columns={columns}
          rows={data.data.items}
          rowKey={(slip) => slip.id}
          empty={
            <EmptyState icon="receipt" title={p.mine.noneTitle}>
              {p.mine.none}
            </EmptyState>
          }
          paging={paging}
        />
      </div>
    </>
  );
}

/** One of the signed-in employee's own payslips (`/my-payslips/:id`). */
export function MyPayslipScreen({ id }: { id: string }) {
  const { api, t, locale, base } = useWorkforce();
  const p = payrollDictionary(locale);
  const data = useResource(() => api.get<PayslipView>(`/api/v1/me/payslips/${id}`), [api, id]);
  if (data.error && !data.data) {
    return (
      <>
        <PageHeader title={p.slip.heading} />
        <ErrorState error={data.error} t={t} onRetry={() => void data.reload()} />
      </>
    );
  }
  if (!data.data) return <Loading t={t} page />;
  const slip = data.data;
  return (
    <>
      <KitPageHeader
        title={fill(p.slip.title, { month: monthLabel(slip.month) })}
        status={<Badge tone={SLIP_TONE[slip.status]}>{p.slipStatuses[slip.status]}</Badge>}
        actions={<PrintButton />}
        breadcrumbs={
          <Breadcrumbs
            label={p.common.breadcrumbs}
            LinkComponent={ListCrumbLink}
            items={[
              { label: p.mine.title, href: `${base}/my-payslips` },
              { label: monthLabel(slip.month) },
            ]}
          />
        }
      />
      <PayslipDocument slip={slip} />
    </>
  );
}
