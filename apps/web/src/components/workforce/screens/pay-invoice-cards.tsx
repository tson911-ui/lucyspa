'use client';

import type {
  CommissionRulesResponse,
  InvoiceEarningLine,
  InvoiceEarningsResponse,
  InvoiceTipsResponse,
  PayEarningItem,
  TipItem,
  TipMethodName,
} from '@lucy-spa/contracts';
import { TIP_METHODS } from '@lucy-spa/contracts';
import {
  Card,
  CardHeader,
  DataTable,
  Field,
  FormDialog,
  FormGrid,
  MoneyInput,
  RowActions,
  Select,
  Textarea,
  type DataTableColumn,
} from '@lucy-spa/ui';
import { useState } from 'react';
import { payDictionary } from '../../../i18n/pay';
import { fill } from '../../../i18n/workforce';
import { signedVnd, vndNumber } from '../../../lib/workforce/cash';
import { formatDate, formatDateTime } from '../../../lib/workforce/format';
import { formOverlayLabels } from '../../../lib/workforce/form-labels';
import { canGlobal } from '../../../lib/workforce/permissions';
import { reasonProblem, tipBody, tipProblems, type TipDraft } from '../../../lib/workforce/pay';
import { useAccount, useWorkforce } from '../session';
import { Badge, Button, Empty, ErrorState, Notice, useResource, useSuccessToast } from '../ui';
import { usePayCommand } from './pay-command';

const ZONE = 'Asia/Ho_Chi_Minh';

/**
 * "Tip của khách" on a PAID invoice (Phase 7 P7-11): the tips recorded for the KTVs who served, and the button to record one. A tip is
 * a separate record (not revenue, no points); it goes into the cash book at once and is paid out with the payslip. The card is left
 * out when there is nothing to show and nothing the person could do (no KTV service, the book not started, no permission).
 */
export function InvoiceTipsCard({ invoiceId }: { invoiceId: string }) {
  const { api, t, locale } = useWorkforce();
  const p = payDictionary(locale);
  const c = p.tips;
  const [bump, setBump] = useState(0);
  const data = useResource(
    () => api.get<InvoiceTipsResponse>(`/api/v1/pay/invoices/${invoiceId}/tips`),
    [api, invoiceId, bump],
  );
  const [recording, setRecording] = useState(false);
  const [reversing, setReversing] = useState<TipItem | null>(null);
  const notify = useSuccessToast();
  const view = data.data;
  if (data.error && !view) {
    // A person who cannot see tips (no invoice or pay access) simply does not get the card.
    return null;
  }
  if (!view) return null;
  const hidden =
    view.items.length === 0 &&
    !view.canRecord &&
    ['NO_SERVICE', 'NOT_LIVE', 'NO_PERMISSION', 'NOT_PAID'].includes(view.blockedBy ?? '');
  if (hidden) return null;
  const columns: DataTableColumn<TipItem>[] = [
    {
      key: 'employee',
      header: c.columns.employee,
      mobileTitle: true,
      truncate: true,
      cell: (row) => row.employee.name,
    },
    {
      key: 'amount',
      header: c.columns.amount,
      numeric: true,
      cell: (row) => (
        <span title={formatDateTime(row.recordedAt, ZONE, locale)}>
          {signedVnd(vndNumber(row.amountVnd), locale)}
        </span>
      ),
    },
    {
      key: 'method',
      header: c.columns.method,
      hidePhone: true,
      cell: (row) => c.methods[row.method],
    },
    {
      key: 'date',
      header: c.columns.date,
      hideBelow: 'md',
      hidePhone: true,
      cell: (row) => formatDate(row.businessDate, locale),
    },
    {
      key: 'state',
      header: t.common.status,
      cell: (row) =>
        row.reversesId ? (
          <Badge tone="neutral">{c.reversalOf}</Badge>
        ) : row.claimed ? (
          <Badge tone="info">{c.claimed}</Badge>
        ) : view.items.some((other) => other.reversesId === row.id) ? (
          <Badge tone="neutral">{c.reversed}</Badge>
        ) : null,
    },
    {
      key: 'actions',
      header: t.common.actions,
      actions: true,
      cell: (row) =>
        row.canReverse ? (
          <RowActions
            menuLabel={fill(t.common.list.actionsFor, { name: row.employee.name })}
            items={[
              {
                id: 'reverse',
                label: c.reverse,
                icon: 'refresh',
                onSelect: () => setReversing(row),
              },
            ]}
          />
        ) : null,
    },
  ];
  return (
    <>
      <Card as="section" aria-label={c.title}>
        <CardHeader
          title={c.title}
          actions={
            view.canRecord ? (
              <Button variant="secondary" icon="plus" onClick={() => setRecording(true)}>
                {c.record}
              </Button>
            ) : undefined
          }
        />
        <p className="ls-hint">{c.intro}</p>
        {!view.canRecord && view.blockedBy ? (
          <Notice tone="info">{c.blocked[view.blockedBy]}</Notice>
        ) : view.windowEndsAt ? (
          <p className="ls-hint">
            {fill(c.windowNote, { date: formatDateTime(view.windowEndsAt, ZONE, locale) })}
          </p>
        ) : null}
        <DataTable
          mode="client"
          caption={fill(t.common.list.table, { list: c.title })}
          columns={columns}
          rows={view.items}
          rowKey={(row) => row.id}
          empty={<Empty>{c.none}</Empty>}
          paging={{ off: 'the tips of one invoice' }}
        />
      </Card>
      {recording ? (
        <TipDialog
          view={view}
          onDone={() => {
            setRecording(false);
            notify(c.done);
            setBump((value) => value + 1);
          }}
          onClose={() => setRecording(false)}
        />
      ) : null}
      {reversing ? (
        <ReverseTipDialog
          tip={reversing}
          onDone={() => {
            setReversing(null);
            notify(c.reverseDone);
            setBump((value) => value + 1);
          }}
          onClose={() => setReversing(null)}
        />
      ) : null}
    </>
  );
}

function TipDialog({
  view,
  onDone,
  onClose,
}: {
  view: InvoiceTipsResponse;
  onDone: () => void;
  onClose: () => void;
}) {
  const { t, locale } = useWorkforce();
  const c = payDictionary(locale).tips;
  // Only a KTV without a live tip on this invoice can be chosen (the API refuses a second one).
  const choices = view.served.filter((item) => item.netVnd === '0');
  const [draft, setDraft] = useState<TipDraft>({
    employeeUserId: choices.length === 1 ? choices[0]!.employee.id : '',
    amount: null,
    method: 'CASH',
  });
  const [checked, setChecked] = useState(false);
  const command = usePayCommand();
  const problems = tipProblems(draft);
  const invalid = (name: string) =>
    checked && problems.includes(name) ? t.errors.validation : undefined;

  async function submit() {
    setChecked(true);
    const body = tipBody(view.invoiceId, draft, command.requestId);
    if (!body) return;
    await command.run<InvoiceTipsResponse>('/api/v1/pay/tips', body, onDone);
  }

  return (
    <FormDialog
      title={c.recordTitle}
      description={c.recordDescription}
      labels={{ ...formOverlayLabels(t, c.submit), submitting: c.submitting }}
      busy={command.pending}
      dirty={draft.amount !== null}
      error={command.error ? <Notice tone="error">{command.error}</Notice> : undefined}
      onClose={onClose}
      onSubmit={submit}
    >
      <FormGrid>
        <Field label={c.employee} error={invalid('employee')} required full>
          {(control) => (
            <Select
              {...control}
              value={draft.employeeUserId}
              placeholder={payDictionary(locale).common.choose}
              options={choices.map((item) => ({
                value: item.employee.id,
                label: item.employee.name,
              }))}
              onChange={(event) => setDraft({ ...draft, employeeUserId: event.target.value })}
            />
          )}
        </Field>
        <Field label={c.amount} error={invalid('amount')} required full>
          {(control) => (
            <MoneyInput
              {...control}
              unit="₫"
              separator={locale === 'vi' ? '.' : ','}
              value={draft.amount}
              onValueChange={(amount) => setDraft({ ...draft, amount })}
            />
          )}
        </Field>
        <Field label={c.method} required full>
          {(control) => (
            <Select
              {...control}
              value={draft.method}
              options={TIP_METHODS.map((method) => ({ value: method, label: c.methods[method] }))}
              onChange={(event) =>
                setDraft({ ...draft, method: event.target.value as TipMethodName })
              }
            />
          )}
        </Field>
      </FormGrid>
    </FormDialog>
  );
}

function ReverseTipDialog({
  tip,
  onDone,
  onClose,
}: {
  tip: TipItem;
  onDone: () => void;
  onClose: () => void;
}) {
  const { t, locale } = useWorkforce();
  const c = payDictionary(locale).tips;
  const [reason, setReason] = useState('');
  const [checked, setChecked] = useState(false);
  const command = usePayCommand();
  const missing = checked && reasonProblem(reason);

  async function submit() {
    setChecked(true);
    if (reasonProblem(reason)) return;
    await command.run<InvoiceTipsResponse>(
      `/api/v1/pay/tips/${tip.id}/reverse`,
      { reason: reason.trim(), clientRequestId: command.requestId },
      onDone,
    );
  }

  return (
    <FormDialog
      title={c.reverseTitle}
      description={fill(c.reverseDescription, {
        amount: signedVnd(vndNumber(tip.amountVnd), locale),
        name: tip.employee.name,
      })}
      labels={{ ...formOverlayLabels(t, c.reverseSubmit), submitting: c.reverseSubmitting }}
      busy={command.pending}
      dirty={reason !== ''}
      error={command.error ? <Notice tone="error">{command.error}</Notice> : undefined}
      onClose={onClose}
      onSubmit={submit}
    >
      <FormGrid>
        <Field
          label={c.reverseReason}
          error={missing ? t.errors.validation : undefined}
          required
          full
        >
          {(control) => (
            <Textarea
              {...control}
              rows={3}
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          )}
        </Field>
      </FormGrid>
    </FormDialog>
  );
}

// ------------------------------------------------------------------------------------------------ earnings
/**
 * "Tiền tour và hoa hồng" on a paid invoice (Phase 7 P7-11): who earned what from this invoice, including the reversals a refund or a
 * reversed payment caused, and (for the payroll manager) the correction of who sold a product line. Shown only to people who hold a
 * shop-wide payroll permission; nobody else's pay is displayed next to an invoice.
 */
export function InvoiceEarningsCard({ invoiceId }: { invoiceId: string }) {
  const { account } = useAccount();
  const allowed = canGlobal(account, 'MANAGE_PAYROLL') || canGlobal(account, 'APPROVE_PAYROLL');
  if (!allowed) return null;
  return <EarningsBody invoiceId={invoiceId} />;
}

function EarningsBody({ invoiceId }: { invoiceId: string }) {
  const { api, t, locale } = useWorkforce();
  const c = payDictionary(locale).earnings;
  const [bump, setBump] = useState(0);
  const data = useResource(
    () => api.get<InvoiceEarningsResponse>(`/api/v1/pay/invoices/${invoiceId}/earnings`),
    [api, invoiceId, bump],
  );
  const [changing, setChanging] = useState<InvoiceEarningLine | null>(null);
  const notify = useSuccessToast();
  const view = data.data;
  if (data.error && !view) {
    return (
      <Card as="section" aria-label={c.title}>
        <CardHeader title={c.title} />
        <ErrorState error={data.error} t={t} onRetry={() => void data.reload()} />
      </Card>
    );
  }
  if (!view) return null;
  const lineName = (item: PayEarningItem) =>
    view.lines.find((line) => line.lineId === item.invoiceLineId)?.name ?? '—';
  const itemColumns: DataTableColumn<PayEarningItem>[] = [
    {
      key: 'kind',
      header: c.columns.kind,
      mobileTitle: true,
      truncate: true,
      cell: (item) => (
        <>
          {c.kinds[item.kind]}
          <span className="ls-hint"> · {lineName(item)}</span>
        </>
      ),
    },
    {
      key: 'employee',
      header: c.columns.employee,
      truncate: true,
      hidePhone: true,
      cell: (item) => item.employee.name,
    },
    {
      key: 'amount',
      header: c.columns.amount,
      numeric: true,
      cell: (item) => signedVnd(vndNumber(item.amountVnd), locale),
    },
    {
      key: 'base',
      header: c.columns.base,
      numeric: true,
      hideBelow: 'md',
      hidePhone: true,
      cell: (item) => (item.baseVnd ? signedVnd(vndNumber(item.baseVnd), locale) : '—'),
    },
    {
      key: 'date',
      header: c.columns.date,
      hideBelow: 'lg',
      hidePhone: true,
      cell: (item) => formatDate(item.businessDate, locale),
    },
    {
      key: 'note',
      header: c.columns.note,
      cell: (item) => (
        <>
          {item.reason ? (c.reasons[item.reason] ?? item.reason) : null}
          {item.claimed ? <Badge tone="info">{c.claimed}</Badge> : null}
        </>
      ),
    },
  ];
  const lineColumns: DataTableColumn<InvoiceEarningLine>[] = [
    {
      key: 'line',
      header: c.lineColumns.line,
      mobileTitle: true,
      truncate: true,
      cell: (line) => line.name,
    },
    {
      key: 'person',
      header: c.lineColumns.person,
      truncate: true,
      cell: (line) =>
        line.person ? (
          <>
            {line.person.name}
            {line.originalSeller ? (
              <span className="ls-hint"> ({line.originalSeller.name})</span>
            ) : null}
          </>
        ) : (
          '—'
        ),
    },
    {
      key: 'actions',
      header: t.common.actions,
      actions: true,
      cell: (line) =>
        view.canCorrectSeller && line.kind === 'PRODUCT' ? (
          <RowActions
            menuLabel={fill(t.common.list.actionsFor, { name: line.name })}
            items={[
              {
                id: 'seller',
                label: c.changeSeller,
                icon: 'swap',
                onSelect: () => setChanging(line),
              },
            ]}
          />
        ) : null,
    },
  ];
  return (
    <>
      <Card as="section" aria-label={c.title}>
        <CardHeader title={c.title} />
        <p className="ls-hint">{c.intro}</p>
        <DataTable
          mode="client"
          caption={fill(t.common.list.table, { list: c.title })}
          columns={itemColumns}
          rows={view.items}
          rowKey={(item) => item.id}
          empty={<Empty>{c.none}</Empty>}
          paging={{ off: 'the earnings of one invoice' }}
        />
        {view.canCorrectSeller && view.lines.some((line) => line.kind === 'PRODUCT') ? (
          <DataTable
            mode="client"
            caption={fill(t.common.list.table, { list: c.lines })}
            columns={lineColumns}
            rows={view.lines.filter((line) => line.kind === 'PRODUCT')}
            rowKey={(line) => line.lineId}
            paging={{ off: 'the product lines of one invoice' }}
          />
        ) : null}
      </Card>
      {changing ? (
        <SellerDialog
          line={changing}
          onDone={() => {
            setChanging(null);
            notify(c.sellerDone);
            setBump((value) => value + 1);
          }}
          onClose={() => setChanging(null)}
        />
      ) : null}
    </>
  );
}

function SellerDialog({
  line,
  onDone,
  onClose,
}: {
  line: InvoiceEarningLine;
  onDone: () => void;
  onClose: () => void;
}) {
  const { api, t, locale } = useWorkforce();
  const c = payDictionary(locale).earnings;
  // The official employees who can earn commission are the ones the rule screen lists.
  const people = useResource(
    () => api.get<CommissionRulesResponse>('/api/v1/pay/commission-rules'),
    [api],
  );
  const [employeeUserId, setEmployeeUserId] = useState('');
  const [reason, setReason] = useState('');
  const [checked, setChecked] = useState(false);
  const command = usePayCommand();
  const noPerson = checked && employeeUserId === '';
  const noReason = checked && reasonProblem(reason);

  async function submit() {
    setChecked(true);
    if (employeeUserId === '' || reasonProblem(reason)) return;
    await command.run<InvoiceEarningsResponse>(
      `/api/v1/pay/product-lines/${line.lineId}/seller`,
      { employeeUserId, reason: reason.trim() },
      onDone,
    );
  }

  return (
    <FormDialog
      title={c.sellerTitle}
      description={`${line.name}. ${c.sellerDescription}`}
      labels={{ ...formOverlayLabels(t, c.sellerSubmit), submitting: c.sellerSubmitting }}
      busy={command.pending}
      dirty={employeeUserId !== '' || reason !== ''}
      error={command.error ? <Notice tone="error">{command.error}</Notice> : undefined}
      onClose={onClose}
      onSubmit={submit}
    >
      <FormGrid>
        <Field label={c.seller} error={noPerson ? t.errors.validation : undefined} required full>
          {(control) => (
            <Select
              {...control}
              value={employeeUserId}
              placeholder={payDictionary(locale).common.choose}
              options={(people.data?.employees ?? [])
                .filter((person) => person.id !== line.person?.id)
                .map((person) => ({ value: person.id, label: person.name }))}
              onChange={(event) => setEmployeeUserId(event.target.value)}
            />
          )}
        </Field>
        <Field
          label={c.sellerReason}
          error={noReason ? t.errors.validation : undefined}
          required
          full
        >
          {(control) => (
            <Textarea
              {...control}
              rows={3}
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          )}
        </Field>
      </FormGrid>
    </FormDialog>
  );
}
