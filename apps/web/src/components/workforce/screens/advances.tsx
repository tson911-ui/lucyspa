'use client';

import type { SalaryAdvanceItem, SalaryAdvancesResponse } from '@lucy-spa/contracts';
import { SALARY_ADVANCE_STATUSES } from '@lucy-spa/contracts';
import {
  DataTable,
  DEFAULT_PAGE_SIZE,
  FacetedFilter,
  Field,
  FormDialog,
  FormGrid,
  focusFirstInvalid,
  ListToolbar,
  MoneyInput,
  RowActions,
  Select,
  Textarea,
  useUrlState,
  type DataTableColumn,
} from '@lucy-spa/ui';
import { useState } from 'react';
import { payrollDictionary } from '../../../i18n/payroll';
import { fill } from '../../../i18n/workforce';
import type { Locale } from '../../../i18n/locales';
import { formatDate, zonedLocal } from '../../../lib/workforce/format';
import { formOverlayLabels } from '../../../lib/workforce/form-labels';
import { normalizePage, normalizePageSize, toolbarLabels } from '../../../lib/workforce/list-view';
import {
  advanceBody,
  advanceCan,
  advanceProblems,
  payrollErrorMessage,
  reasonMissing,
  type AdvanceDraft,
} from '../../../lib/workforce/payroll';
import { urlPaging } from '../../../lib/workforce/url-paging';
import { opensInput } from '../../../lib/workforce/opens-input';
import { useWorkforce } from '../session';
import {
  Badge,
  Button,
  Empty,
  ErrorState,
  Loading,
  Notice,
  PageHeader,
  useResource,
  useSuccessToast,
} from '../ui';
import { usePayrollCommand } from './payroll-command';

/** Pay runs in the shop's zone (as the payslips do). */
const ZONE = 'Asia/Ho_Chi_Minh';

/** Address-bar state of the list (Back/Forward and a shared link restore the view); a filter change returns to page 1. */
const ADVANCE_LIST_DEFAULTS = { status: '', page: 1, pageSize: DEFAULT_PAGE_SIZE };
const ADVANCE_LIST_OPTIONS = {
  normalize: (state: typeof ADVANCE_LIST_DEFAULTS) => ({
    status: (SALARY_ADVANCE_STATUSES as readonly string[]).includes(state.status)
      ? state.status
      : '',
    page: normalizePage(state.page),
    pageSize: normalizePageSize(state.pageSize),
  }),
  resetOnChange: ['page'],
};

/** VND from the API's integer string with Intl (true minus sign for a negative fund balance), never through a float. */
const vndFormats = new Map<string, Intl.NumberFormat>();
function money(value: string, locale: Locale): string {
  if (!/^-?(?:0|[1-9][0-9]*)$/.test(value)) return value;
  let format = vndFormats.get(locale);
  if (!format) {
    format = new Intl.NumberFormat(locale === 'vi' ? 'vi-VN' : 'en-US', {
      signDisplay: 'negative',
    });
    vndFormats.set(locale, format);
  }
  return `${format.format(BigInt(value)).replace('-', '\u2212')}\u00a0₫`;
}

/** After a failed submit the errors render on the next frame; the first field with an error then takes focus. */
function focusInvalid(): void {
  requestAnimationFrame(() => focusFirstInvalid(document));
}

const TONE = {
  REQUESTED: 'info',
  APPROVED: 'info',
  PAID: 'warning',
  RECOVERED: 'success',
  WRITTEN_OFF: 'neutral',
  CANCELLED: 'neutral',
} as const;

type Overlay =
  | { kind: 'request' }
  | { kind: 'cancel'; item: SalaryAdvanceItem }
  | { kind: 'pay'; item: SalaryAdvanceItem }
  | { kind: 'writeOff'; item: SalaryAdvanceItem };

/**
 * "Tạm ứng lương" (Phase 7 P7-15): salary advances. The page's one primary action requests an advance; approving, cancelling, paying out and
 * writing off are row actions that only show when the stage and the person's permissions allow them (the API decides again). Paying out and
 * writing off ask for the person's password.
 */
export function AdvancesScreen() {
  const { api, t, locale } = useWorkforce();
  const p = payrollDictionary(locale);
  const [bump, setBump] = useState(0);
  const data = useResource(
    () => api.get<SalaryAdvancesResponse>('/api/v1/pay/advances'),
    [api, bump],
  );
  if (data.error && !data.data) {
    return (
      <>
        <PageHeader title={p.advances.title} intro={p.advances.intro} />
        <ErrorState error={data.error} t={t} onRetry={() => void data.reload()} />
      </>
    );
  }
  if (!data.data) return <Loading t={t} page />;
  return <AdvancesView data={data.data} reload={() => setBump((value) => value + 1)} />;
}

export function AdvancesView({
  data,
  reload,
}: {
  data: SalaryAdvancesResponse;
  reload: () => void;
}) {
  const { t, locale } = useWorkforce();
  const p = payrollDictionary(locale);
  const a = p.advances;
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  // Filter and pager in the address bar (?status=PAID&page=2): Back/Forward and a shared link restore the list.
  const [list, updateList] = useUrlState(ADVANCE_LIST_DEFAULTS, ADVANCE_LIST_OPTIONS);
  const status = list.status;
  const setStatus = (value: string) => updateList({ status: value });
  const paging = urlPaging(list.page, list.pageSize, updateList, t, a.title);
  const notify = useSuccessToast();
  const [working, setWorking] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const { api } = useWorkforce();
  const rows = status ? data.items.filter((item) => item.status === status) : data.items;
  const done = (message: string) => {
    setOverlay(null);
    notify(message);
    reload();
  };
  async function approve(item: SalaryAdvanceItem) {
    if (working) return;
    setWorking(item.id);
    setFailure(null);
    try {
      await api.post(`/api/v1/pay/advances/${item.id}/approve`, { expectedVersion: item.version });
      done(a.approved);
    } catch (error) {
      setFailure(payrollErrorMessage(error, t, locale));
    } finally {
      setWorking(null);
    }
  }
  const columns: DataTableColumn<SalaryAdvanceItem>[] = [
    {
      key: 'employee',
      header: a.columns.employee,
      mobileTitle: true,
      wrap: true,
      width: 'lg',
      // Name, then the code on a second muted line (no middle-dot meta string).
      cell: (item) => (
        <span className="ls-cell-stack">
          <span className="ls-cell-main">{item.employee.name}</span>
          <span className="ls-cell-sub" translate="no">
            {item.employee.code}
          </span>
        </span>
      ),
    },
    {
      key: 'amount',
      header: a.columns.amount,
      numeric: true,
      cell: (item) => money(item.amountVnd, locale),
    },
    {
      key: 'status',
      header: a.columns.status,
      cell: (item) => <Badge tone={TONE[item.status]}>{a.status[item.status]}</Badge>,
    },
    {
      key: 'owed',
      header: a.columns.owed,
      numeric: true,
      cell: (item) => (item.status === 'PAID' ? money(item.outstandingVnd, locale) : '—'),
    },
    {
      key: 'date',
      header: a.columns.date,
      hideBelow: 'lg',
      hidePhone: true,
      // The request's day in the shop's zone (Vietnam), not the UTC day of the instant (wig advances.tsx:162).
      cell: (item) => formatDate(zonedLocal(item.requestedAt, ZONE).slice(0, 10), locale),
    },
    {
      key: 'actions',
      header: t.common.actions,
      actions: true,
      cell: (item) => {
        const can = advanceCan(item, data);
        const items = [
          ...(can.approve
            ? [
                {
                  id: 'approve',
                  label: a.approve,
                  icon: 'check' as const,
                  onSelect: () => void approve(item),
                },
              ]
            : []),
          ...(can.pay
            ? [
                {
                  id: 'pay',
                  label: opensInput(a.pay),
                  icon: 'wallet' as const,
                  onSelect: () => setOverlay({ kind: 'pay', item }),
                },
              ]
            : []),
          ...(can.writeOff
            ? [
                {
                  id: 'writeOff',
                  label: opensInput(a.writeOff),
                  icon: 'x-circle' as const,
                  tone: 'danger' as const,
                  onSelect: () => setOverlay({ kind: 'writeOff', item }),
                },
              ]
            : []),
          ...(can.cancel
            ? [
                {
                  id: 'cancel',
                  label: opensInput(a.cancel),
                  icon: 'close' as const,
                  tone: 'danger' as const,
                  onSelect: () => setOverlay({ kind: 'cancel', item }),
                },
              ]
            : []),
        ];
        return items.length > 0 ? (
          <RowActions
            menuLabel={fill(t.common.list.actionsFor, { name: item.employee.name })}
            items={items}
          />
        ) : null;
      },
    },
  ];
  return (
    <>
      <PageHeader title={a.title} intro={a.intro}>
        {data.canRequest ? (
          <Button variant="primary" icon="plus" onClick={() => setOverlay({ kind: 'request' })}>
            {opensInput(a.request)}
          </Button>
        ) : null}
      </PageHeader>
      {/* One list on the page: no h2 repeating the h1 ("Các khoản tạm ứng"); the table caption keeps the name. */}
      <div className="ls-self-list">
        <ListToolbar
          labels={toolbarLabels(t)}
          activeFilters={status ? 1 : 0}
          onReset={() => setStatus('')}
          reload={{ label: t.common.reload, onClick: reload }}
          resultCount={fill(t.common.list.results, { count: rows.length })}
          filters={
            <FacetedFilter
              label={a.filterStatus}
              clearLabel={t.common.list.clearChoice}
              options={SALARY_ADVANCE_STATUSES.map((value) => ({ value, label: a.status[value] }))}
              selected={status ? [status] : []}
              onChange={([value]) => setStatus(value ?? '')}
            />
          }
        />
        {failure ? <Notice tone="error">{failure}</Notice> : null}
        <DataTable
          mode="client"
          caption={fill(t.common.list.table, { list: a.section })}
          columns={columns}
          rows={rows}
          rowKey={(item) => item.id}
          empty={
            status ? (
              <Empty
                title={a.noneFilteredTitle}
                action={
                  <Button variant="secondary" onClick={() => setStatus('')}>
                    {a.showAll}
                  </Button>
                }
              >
                {a.noneFiltered}
              </Empty>
            ) : (
              <Empty title={a.noneTitle}>{a.none}</Empty>
            )
          }
          paging={paging}
        />
      </div>
      {overlay?.kind === 'request' ? (
        <RequestDialog
          data={data}
          onDone={() => done(a.requested)}
          onClose={() => setOverlay(null)}
        />
      ) : null}
      {overlay?.kind === 'cancel' ? (
        <ReasonDialog
          item={overlay.item}
          path={`/api/v1/pay/advances/${overlay.item.id}/cancel`}
          title={a.cancelTitle}
          description={fill(a.cancelDescription, {
            amount: money(overlay.item.amountVnd, locale),
            name: overlay.item.employee.name,
          })}
          reasonLabel={a.cancelReason}
          submit={a.cancelSubmit}
          submitting={a.cancelSubmitting}
          reauth={false}
          onDone={() => done(a.cancelled)}
          onClose={() => setOverlay(null)}
        />
      ) : null}
      {overlay?.kind === 'writeOff' ? (
        <ReasonDialog
          item={overlay.item}
          path={`/api/v1/pay/advances/${overlay.item.id}/write-off`}
          title={a.writeOffTitle}
          description={fill(a.writeOffDescription, {
            amount: money(overlay.item.outstandingVnd, locale),
            name: overlay.item.employee.name,
          })}
          reasonLabel={a.writeOffReason}
          submit={a.writeOffSubmit}
          submitting={a.writeOffSubmitting}
          reauth
          onDone={() => done(a.writtenOff)}
          onClose={() => setOverlay(null)}
        />
      ) : null}
      {overlay?.kind === 'pay' ? (
        <PayDialog
          item={overlay.item}
          data={data}
          onDone={() => done(a.paid)}
          onClose={() => setOverlay(null)}
        />
      ) : null}
    </>
  );
}

function RequestDialog({
  data,
  onDone,
  onClose,
}: {
  data: SalaryAdvancesResponse;
  onDone: () => void;
  onClose: () => void;
}) {
  const { t, locale } = useWorkforce();
  const a = payrollDictionary(locale).advances;
  const [draft, setDraft] = useState<AdvanceDraft>({ employeeUserId: '', amount: '', reason: '' });
  const [checked, setChecked] = useState(false);
  const command = usePayrollCommand();
  const limit =
    data.eligible.find((entry) => entry.employee.id === draft.employeeUserId)?.limitVnd ?? null;
  const problems = advanceProblems(draft, limit);
  const errorText: Record<string, string> = {
    employee: a.errorEmployee,
    amount: a.errorAmount,
    reason: a.errorReason,
  };
  const invalid = (name: string) =>
    checked && problems.includes(name) ? errorText[name] : undefined;
  async function submit() {
    setChecked(true);
    const body = advanceBody(draft, limit, command.requestId);
    if (!body) return focusInvalid();
    await command.run('/api/v1/pay/advances', body, onDone);
  }
  return (
    <FormDialog
      title={a.requestTitle}
      description={data.eligible.length === 0 ? undefined : a.requestDescription}
      labels={{ ...formOverlayLabels(t, a.requestSubmit), submitting: a.requestSubmitting }}
      busy={command.pending}
      dirty={draft.amount !== '' || draft.reason !== ''}
      error={command.error ? <Notice tone="error">{command.error}</Notice> : undefined}
      onClose={onClose}
      onSubmit={submit}
    >
      {data.eligible.length === 0 ? (
        <Notice tone="info">{a.noEligible}</Notice>
      ) : (
        <FormGrid>
          <Field label={a.requestEmployee} error={invalid('employee')} required full>
            {(control) => (
              <Select
                {...control}
                value={draft.employeeUserId}
                placeholder={t.common.form.choose}
                options={data.eligible.map((entry) => ({
                  value: entry.employee.id,
                  label: fill(a.requestLimit, {
                    name: entry.employee.name,
                    limit: money(entry.limitVnd, locale),
                  }),
                }))}
                onChange={(event) => setDraft({ ...draft, employeeUserId: event.target.value })}
              />
            )}
          </Field>
          <Field label={a.requestAmount} error={invalid('amount')} required full>
            {(control) => (
              // Grouped money with the ₫ unit (wig advances.tsx:372); the draft keeps the digits the payroll rules parse.
              <MoneyInput
                {...control}
                name="amount"
                unit="₫"
                separator={locale === 'vi' ? '.' : ','}
                maxLength={20}
                value={/^\d+$/.test(draft.amount) ? Number(draft.amount) : null}
                onValueChange={(value) =>
                  setDraft({ ...draft, amount: value === null ? '' : String(value) })
                }
              />
            )}
          </Field>
          <Field label={a.requestReason} error={invalid('reason')} required full>
            {(control) => (
              <Textarea
                {...control}
                name="reason"
                rows={3}
                maxLength={500}
                value={draft.reason}
                onChange={(event) => setDraft({ ...draft, reason: event.target.value })}
              />
            )}
          </Field>
        </FormGrid>
      )}
    </FormDialog>
  );
}

function ReasonDialog({
  item,
  path,
  title,
  description,
  reasonLabel,
  submit,
  submitting,
  reauth,
  onDone,
  onClose,
}: {
  item: SalaryAdvanceItem;
  path: string;
  title: string;
  description: string;
  reasonLabel: string;
  submit: string;
  submitting: string;
  reauth: boolean;
  onDone: () => void;
  onClose: () => void;
}) {
  const { t, locale } = useWorkforce();
  const a = payrollDictionary(locale).advances;
  const [reason, setReason] = useState('');
  const [checked, setChecked] = useState(false);
  const command = usePayrollCommand({ reauth });
  async function send() {
    setChecked(true);
    if (reasonMissing(reason)) return focusInvalid();
    await command.run(path, { expectedVersion: item.version, reason: reason.trim() }, onDone);
  }
  return (
    <>
      <FormDialog
        suspended={command.asking}
        title={title}
        description={description}
        labels={{ ...formOverlayLabels(t, submit), submitting }}
        busy={command.pending}
        dirty={reason !== ''}
        error={command.error ? <Notice tone="error">{command.error}</Notice> : undefined}
        onClose={onClose}
        onSubmit={send}
      >
        <FormGrid>
          <Field
            label={reasonLabel}
            error={checked && reasonMissing(reason) ? a.errorReason : undefined}
            required
            full
          >
            {(control) => (
              <Textarea
                {...control}
                name="reason"
                rows={3}
                maxLength={500}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            )}
          </Field>
        </FormGrid>
      </FormDialog>
      {command.dialog}
    </>
  );
}

function PayDialog({
  item,
  data,
  onDone,
  onClose,
}: {
  item: SalaryAdvanceItem;
  data: SalaryAdvancesResponse;
  onDone: () => void;
  onClose: () => void;
}) {
  const { t, locale } = useWorkforce();
  const a = payrollDictionary(locale).advances;
  const [fundId, setFundId] = useState(data.funds[0]?.id ?? '');
  const [checked, setChecked] = useState(false);
  const command = usePayrollCommand({ reauth: true });
  async function submit() {
    setChecked(true);
    if (fundId === '') return focusInvalid();
    await command.run(
      `/api/v1/pay/advances/${item.id}/pay`,
      { expectedVersion: item.version, fundId, clientRequestId: command.requestId },
      onDone,
    );
  }
  return (
    <>
      <FormDialog
        suspended={command.asking}
        title={a.payTitle}
        description={fill(a.payDescription, {
          amount: money(item.amountVnd, locale),
          name: item.employee.name,
        })}
        labels={{ ...formOverlayLabels(t, a.paySubmit), submitting: a.paySubmitting }}
        busy={command.pending}
        dirty={false}
        error={command.error ? <Notice tone="error">{command.error}</Notice> : undefined}
        onClose={onClose}
        onSubmit={submit}
      >
        <FormGrid>
          <Field
            label={a.payFund}
            error={checked && fundId === '' ? a.errorFund : undefined}
            required
            full
          >
            {(control) => (
              <Select
                {...control}
                value={fundId}
                placeholder={t.common.form.choose}
                options={data.funds.map((fund) => ({
                  value: fund.id,
                  label: fill(a.payFundOption, {
                    name: fund.name,
                    balance: money(fund.balanceVnd, locale),
                  }),
                }))}
                onChange={(event) => setFundId(event.target.value)}
              />
            )}
          </Field>
        </FormGrid>
        <p className="ls-hint">{payrollDictionary(locale).common.password}</p>
      </FormDialog>
      {command.dialog}
    </>
  );
}
