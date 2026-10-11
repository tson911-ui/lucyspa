'use client';

import type { PayRunListResponse, PayRunSummary } from '@lucy-spa/contracts';
import {
  DataTable,
  Field,
  FormDialog,
  FormGrid,
  ListSection,
  ListToolbar,
  Select,
  type DataTableColumn,
} from '@lucy-spa/ui';
import { useState } from 'react';
import { payrollDictionary } from '../../../i18n/payroll';
import { fill } from '../../../i18n/workforce';
import { signedVnd, vndNumber } from '../../../lib/workforce/cash';
import { formatDate } from '../../../lib/workforce/format';
import { formOverlayLabels } from '../../../lib/workforce/form-labels';
import { toolbarLabels } from '../../../lib/workforce/list-view';
import { monthLabel, monthsToCreate } from '../../../lib/workforce/payroll';
import { useClientPaging } from '../../../lib/workforce/use-client-paging';
import { PrefetchLink as Link } from '../link';
import { useWorkforce } from '../session';
import { Badge, Button, Empty, ErrorState, Loading, Notice, PageHeader, useResource } from '../ui';
import { usePayrollCommand } from './payroll-command';

const STATUS_TONE = { DRAFT: 'info', CLOSED: 'warning', PAID: 'success' } as const;

/**
 * "Bảng lương" (Phase 7 P7-15): the monthly payroll runs, newest first. The page's one primary action creates the draft of a month; a row opens
 * the run. Before the Owner starts the cash book and payroll the page only says so.
 */
export function PayrollScreen() {
  const { api, t, locale } = useWorkforce();
  const p = payrollDictionary(locale);
  const [bump, setBump] = useState(0);
  const data = useResource(() => api.get<PayRunListResponse>('/api/v1/pay/runs'), [api, bump]);
  if (data.error && !data.data) {
    return (
      <>
        <PageHeader title={p.title} intro={p.intro} />
        <ErrorState error={data.error} t={t} onRetry={() => void data.reload()} />
      </>
    );
  }
  if (!data.data) return <Loading t={t} page />;
  return <PayrollList list={data.data} reload={() => setBump((value) => value + 1)} />;
}

export function PayrollList({ list, reload }: { list: PayRunListResponse; reload: () => void }) {
  const { t, locale, base, navigate } = useWorkforce();
  const p = payrollDictionary(locale);
  const [creating, setCreating] = useState(false);
  const paging = useClientPaging(t, p.title);
  const months = monthsToCreate(list);
  const columns: DataTableColumn<PayRunSummary>[] = [
    {
      key: 'month',
      header: p.list.columns.month,
      mobileTitle: true,
      cell: (item) => (
        <Link className="ls-link" href={`${base}/payroll/${item.id}`}>
          {monthLabel(item.month)}
        </Link>
      ),
    },
    {
      key: 'status',
      header: p.list.columns.status,
      cell: (item) => <Badge tone={STATUS_TONE[item.status]}>{p.runStatuses[item.status]}</Badge>,
    },
    { key: 'people', header: p.list.columns.people, numeric: true, cell: (item) => item.people },
    {
      key: 'net',
      header: p.list.columns.net,
      numeric: true,
      cell: (item) => signedVnd(vndNumber(item.payVnd), locale),
    },
    {
      key: 'tips',
      header: p.list.columns.tips,
      numeric: true,
      hideBelow: 'md',
      hidePhone: true,
      cell: (item) => signedVnd(vndNumber(item.tipsVnd), locale),
    },
    {
      key: 'day',
      header: p.list.columns.paymentDay,
      hideBelow: 'lg',
      hidePhone: true,
      cell: (item) => (item.paymentDay ? formatDate(item.paymentDay, locale) : '—'),
    },
  ];
  const live = list.firstMonth !== null;
  return (
    <>
      <PageHeader title={p.title} intro={p.intro}>
        {list.canManage && live && months.length > 0 ? (
          <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
            {p.list.create}
          </Button>
        ) : null}
      </PageHeader>
      {!live ? (
        <Notice tone="info">{p.list.notLive}</Notice>
      ) : (
        <ListSection title={p.list.section}>
          <ListToolbar
            labels={toolbarLabels(t)}
            reload={{ label: t.common.reload, onClick: reload }}
            resultCount={fill(t.common.list.results, { count: list.items.length })}
          />
          <DataTable
            mode="client"
            caption={fill(t.common.list.table, { list: p.list.section })}
            columns={columns}
            rows={list.items}
            rowKey={(item) => item.id}
            empty={<Empty>{p.list.none}</Empty>}
            paging={paging}
          />
        </ListSection>
      )}
      {creating ? (
        <CreateRunDialog
          months={months}
          onDone={(id) => {
            setCreating(false);
            reload();
            navigate?.(`${base}/payroll/${id}`);
          }}
          onClose={() => setCreating(false)}
        />
      ) : null}
    </>
  );
}

function CreateRunDialog({
  months,
  onDone,
  onClose,
}: {
  months: readonly string[];
  onDone: (runId: string) => void;
  onClose: () => void;
}) {
  const { t, locale } = useWorkforce();
  const p = payrollDictionary(locale);
  const [month, setMonth] = useState(months[0] ?? '');
  const command = usePayrollCommand();
  async function submit() {
    if (month === '') return;
    await command.run<{ run: { id: string } }>('/api/v1/pay/runs', { month }, (result) =>
      onDone(result.run.id),
    );
  }
  return (
    <FormDialog
      title={p.list.createTitle}
      description={p.list.createDescription}
      labels={{ ...formOverlayLabels(t, p.list.createSubmit), submitting: p.list.createSubmitting }}
      busy={command.pending}
      dirty={false}
      error={command.error ? <Notice tone="error">{command.error}</Notice> : undefined}
      onClose={onClose}
      onSubmit={submit}
    >
      <FormGrid>
        <Field label={p.list.createMonth} required full>
          {(control) => (
            <Select
              {...control}
              value={month}
              options={months.map((value) => ({ value, label: monthLabel(value) }))}
              onChange={(event) => setMonth(event.target.value)}
            />
          )}
        </Field>
      </FormGrid>
    </FormDialog>
  );
}
