'use client';

import type {
  CashBranchAccess,
  CashEntryItem,
  CashEntryListResponse,
  CashEntryResponse,
  CashFundItem,
  CashManualKind,
  CashTransferResponse,
} from '@lucy-spa/contracts';
import { CASH_MANUAL_KINDS, FUND_ENTRY_CATEGORIES } from '@lucy-spa/contracts';
import {
  DataTable,
  DateTextInput,
  FacetedFilter,
  Field,
  FormDialog,
  FormGrid,
  ListSection,
  ListToolbar,
  MoneyInput,
  RowActions,
  Select,
  Textarea,
  type DataTableColumn,
} from '@lucy-spa/ui';
import { useRef, useState } from 'react';
import { cashDictionary } from '../../../i18n/cash';
import { fill } from '../../../i18n/workforce';
import {
  cashErrorMessage,
  entryBody,
  entryKinds,
  entryProblems,
  fundCan,
  signedVnd,
  transferBody,
  transferProblems,
  transferTargets,
  vndNumber,
  writableFunds,
  type CashPageState,
  type EntryDraft,
  type TransferDraft,
} from '../../../lib/workforce/cash';
import { formatDate, formatDateTime } from '../../../lib/workforce/format';
import { formOverlayLabels } from '../../../lib/workforce/form-labels';
import { paginationLabels, toolbarLabels } from '../../../lib/workforce/list-view';
import { ReauthenticationCancelled, withReauthentication } from '../../../lib/workforce/reauth';
import { useReauthentication } from '../reauth-dialog';
import { useWorkforce } from '../session';
import { Badge, Button, Empty, ErrorState, Notice, useResource, useSuccessToast } from '../ui';

const ZONE = 'Asia/Ho_Chi_Minh';

/**
 * The book of one fund (Phase 7 P7-6): its entries, 20 a page, newest day first, with the filters and the totals of the filter. Money
 * in is green, money out is neutral; an entry corrected by another says so; a posted entry names its invoice, refund or exchange. The
 * secondary action ("Chuyển quỹ") sits in the list toolbar; the page's primary action ("Ghi sổ quỹ") is in the page header.
 */
export function CashBook({
  fund,
  branches,
  state,
  update,
  reloadToken,
  onTransfer,
  onChanged,
}: {
  fund: CashFundItem;
  branches: readonly CashBranchAccess[];
  state: CashPageState;
  update: (patch: Partial<CashPageState>) => void;
  /** Bumped by the page after a command so the list reloads. */
  reloadToken: number;
  onTransfer: () => void;
  onChanged: () => void;
}) {
  const { api, t, locale } = useWorkforce();
  const c = cashDictionary(locale);
  const can = fundCan(fund, branches);
  const list = useResource(
    () =>
      api.get<CashEntryListResponse>(`/api/v1/cash/funds/${fund.id}/entries`, {
        page: state.page,
        category: state.category || undefined,
        direction: state.direction || undefined,
        from: state.from || undefined,
        to: state.to || undefined,
      }),
    [api, fund.id, state.page, state.category, state.direction, state.from, state.to, reloadToken],
  );
  const [reversing, setReversing] = useState<CashEntryItem | null>(null);
  const notify = useSuccessToast();
  const rows = list.data?.items ?? [];
  const filtered =
    (state.category ? 1 : 0) +
    (state.direction ? 1 : 0) +
    (state.from ? 1 : 0) +
    (state.to ? 1 : 0);
  return (
    <>
      <ListSection title={c.book.title}>
        <ListToolbar
          labels={toolbarLabels(t)}
          activeFilters={filtered}
          onReset={() => update({ category: '', direction: '', from: '', to: '' })}
          reload={{ label: t.common.reload, onClick: () => void list.reload() }}
          resultCount={
            list.data
              ? fill(c.book.totals, {
                  in: signedVnd(list.data.inVnd, locale),
                  out: signedVnd(list.data.outVnd, locale),
                })
              : undefined
          }
          filters={
            <>
              <FacetedFilter
                label={c.book.filterCategory}
                clearLabel={t.common.list.clearChoice}
                options={FUND_ENTRY_CATEGORIES.map((value) => ({
                  value,
                  label: c.categories[value],
                }))}
                selected={state.category ? [state.category] : []}
                onChange={([value]) => update({ category: value ?? '' })}
              />
              <FacetedFilter
                label={c.book.filterDirection}
                clearLabel={t.common.list.clearChoice}
                options={(['IN', 'OUT'] as const).map((value) => ({
                  value,
                  label: c.directions[value],
                }))}
                selected={state.direction ? [state.direction] : []}
                onChange={([value]) => update({ direction: value ?? '' })}
              />
              <DateTextInput
                aria-label={c.book.filterFrom}
                value={state.from}
                {...(state.to ? { max: state.to } : {})}
                onChange={(event) => update({ from: event.target.value })}
              />
              <DateTextInput
                aria-label={c.book.filterTo}
                value={state.to}
                {...(state.from ? { min: state.from } : {})}
                onChange={(event) => update({ to: event.target.value })}
              />
            </>
          }
          actions={
            can.transfer ? (
              <Button variant="secondary" onClick={onTransfer}>
                {c.actions.transfer}
              </Button>
            ) : undefined
          }
        />
        <DataTable
          mode="server"
          caption={fill(t.common.list.table, { list: c.book.title })}
          columns={bookColumns({ c, t, locale, can: can.record, onReverse: setReversing })}
          rows={rows}
          rowKey={(row) => row.id}
          loading={list.loading && !list.data}
          loadingLabel={t.common.loading}
          error={
            list.error ? (
              <ErrorState error={list.error} t={t} onRetry={() => void list.reload()} />
            ) : undefined
          }
          empty={
            list.data ? (
              <Empty>{filtered > 0 ? c.book.noneFiltered : c.book.none}</Empty>
            ) : undefined
          }
          paging={{
            page: state.page,
            pageSize: list.data?.pageSize ?? 20,
            total: list.data?.total ?? rows.length,
            onPageChange: (page) => update({ page }),
            labels: paginationLabels(t, c.book.title),
          }}
        />
      </ListSection>
      {reversing ? (
        <ReverseDialog
          entry={reversing}
          onDone={() => {
            setReversing(null);
            notify(c.reverse.done);
            onChanged();
          }}
          onClose={() => setReversing(null)}
        />
      ) : null}
    </>
  );
}

function bookColumns({
  c,
  t,
  locale,
  can,
  onReverse,
}: {
  c: ReturnType<typeof cashDictionary>;
  t: ReturnType<typeof useWorkforce>['t'];
  locale: ReturnType<typeof useWorkforce>['locale'];
  can: boolean;
  onReverse: (entry: CashEntryItem) => void;
}): DataTableColumn<CashEntryItem>[] {
  return [
    {
      key: 'date',
      header: c.book.columns.date,
      cell: (row) => formatDate(row.businessDate, locale),
    },
    {
      key: 'kind',
      header: c.book.columns.kind,
      mobileTitle: true,
      truncate: true,
      width: 'md',
      cell: (row) => c.categories[row.category],
    },
    {
      key: 'detail',
      header: c.book.columns.detail,
      truncate: true,
      width: 'lg',
      hideBelow: 'md',
      hidePhone: true,
      cell: (row) => (
        <>
          {row.reference ?? row.reason ?? '—'}
          {row.reversedByEntryId ? (
            <>
              {' '}
              <Badge tone="neutral">{c.book.reversed}</Badge>
            </>
          ) : null}
        </>
      ),
    },
    {
      key: 'by',
      header: c.book.columns.by,
      hideBelow: 'xl',
      hidePhone: true,
      truncate: true,
      width: 'sm',
      cell: (row) => row.actor?.name ?? c.book.auto,
      // The instant is the cell's title: when it was written, in the shop's clock.
    },
    {
      key: 'amount',
      header: c.book.columns.amount,
      numeric: true,
      cell: (row) => (
        <span title={formatDateTime(row.occurredAt, ZONE, locale)}>
          {row.direction === 'IN' ? '+' : '−'}
          {signedVnd(vndNumber(row.amountVnd), locale)}
        </span>
      ),
    },
    {
      key: 'actions',
      header: t.common.actions,
      actions: true,
      cell: (row) =>
        can && row.canReverse ? (
          <RowActions
            menuLabel={fill(t.common.list.actionsFor, { name: c.categories[row.category] })}
            items={[
              {
                id: 'reverse',
                label: c.book.reverse,
                icon: 'refresh',
                onSelect: () => onReverse(row),
              },
            ]}
          />
        ) : null,
    },
  ];
}

// ------------------------------------------------------------------------------------------------ dialogs
/** A reason is always asked in the person's words; the request id is made once per dialog so a retry never writes twice. */
function useCommand() {
  const { api, t, locale } = useWorkforce();
  const { confirm, dialog } = useReauthentication();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(globalThis.crypto.randomUUID());
  async function run<T>(path: string, body: object, done: (result: T) => void) {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      done(await withReauthentication(() => api.post<T>(path, body), confirm));
    } catch (failure) {
      // Closing the password prompt is not an error: nothing was saved.
      if (!(failure instanceof ReauthenticationCancelled)) {
        setError(cashErrorMessage(failure, t, locale));
      }
      setPending(false);
    }
  }
  return { run, pending, error, requestId: requestId.current, dialog };
}

export function EntryDialog({
  fund,
  branches,
  onDone,
  onClose,
}: {
  fund: CashFundItem;
  branches: readonly CashBranchAccess[];
  onDone: () => void;
  onClose: () => void;
}) {
  const { t, locale } = useWorkforce();
  const c = cashDictionary(locale);
  const e = c.entry;
  const can = fundCan(fund, branches);
  const kinds = entryKinds({ fund, canRecord: can.record, canDeposit: can.deposit });
  const bank = fund.kind === 'BANK';
  const managed = branches.filter((entry) => entry.manage);
  const [draft, setDraft] = useState<EntryDraft>({
    kind: kinds[0] ?? CASH_MANUAL_KINDS[0],
    amount: null,
    reason: '',
    branchId: managed[0]?.branch.id ?? '',
  });
  const [checked, setChecked] = useState(false);
  const command = useCommand();
  const problems = entryProblems(draft, bank);
  const invalid = (name: string) =>
    checked && problems.includes(name) ? t.errors.validation : undefined;
  const dirty = draft.amount !== null || draft.reason !== '';

  async function submit() {
    setChecked(true);
    const body = entryBody(fund.id, draft, bank, command.requestId);
    if (!body) return;
    await command.run<CashEntryResponse>('/api/v1/cash/entries', body, onDone);
  }

  return (
    <>
      <FormDialog
        title={e.title}
        description={`${fund.name}. ${e.description}`}
        labels={{ ...formOverlayLabels(t, e.submit), submitting: e.submitting }}
        busy={command.pending}
        dirty={dirty}
        error={command.error ? <Notice tone="error">{command.error}</Notice> : undefined}
        onClose={onClose}
        onSubmit={submit}
      >
        <FormGrid>
          <Field label={e.kind} full>
            {(control) => (
              <Select
                {...control}
                value={draft.kind}
                options={kinds.map((kind) => ({ value: kind, label: e.kinds[kind] }))}
                onChange={(event) =>
                  setDraft({ ...draft, kind: event.target.value as CashManualKind })
                }
              />
            )}
          </Field>
          {bank ? (
            <Field label={e.branch} error={invalid('branch')} required full>
              {(control) => (
                <Select
                  {...control}
                  value={draft.branchId}
                  options={managed.map((entry) => ({
                    value: entry.branch.id,
                    label: entry.branch.name,
                  }))}
                  onChange={(event) => setDraft({ ...draft, branchId: event.target.value })}
                />
              )}
            </Field>
          ) : null}
          <Field label={e.amount} hint={e.amountHint} error={invalid('amount')} required full>
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
          <Field label={e.reason} hint={e.reasonHint} error={invalid('reason')} required full>
            {(control) => (
              <Textarea
                {...control}
                rows={3}
                maxLength={500}
                value={draft.reason}
                onChange={(event) => setDraft({ ...draft, reason: event.target.value })}
              />
            )}
          </Field>
        </FormGrid>
      </FormDialog>
      {command.dialog}
    </>
  );
}

export function TransferDialog({
  fund,
  funds,
  branches,
  onDone,
  onClose,
}: {
  fund: CashFundItem;
  funds: readonly CashFundItem[];
  branches: readonly CashBranchAccess[];
  onDone: () => void;
  onClose: () => void;
}) {
  const { t, locale } = useWorkforce();
  const c = cashDictionary(locale);
  const x = c.transfer;
  const mine = writableFunds(funds, branches);
  const [draft, setDraft] = useState<TransferDraft>({
    fromFundId: fund.id,
    toFundId: transferTargets(mine, fund.id)[0]?.id ?? '',
    amount: null,
    reason: '',
  });
  const [checked, setChecked] = useState(false);
  const command = useCommand();
  const problems = transferProblems(draft);
  const invalid = (name: string) =>
    checked && problems.includes(name) ? t.errors.validation : undefined;
  const targets = transferTargets(mine, draft.fromFundId);

  async function submit() {
    setChecked(true);
    const body = transferBody(draft, command.requestId);
    if (!body) return;
    await command.run<CashTransferResponse>('/api/v1/cash/transfers', body, onDone);
  }

  return (
    <>
      <FormDialog
        title={x.title}
        description={x.description}
        labels={{ ...formOverlayLabels(t, x.submit), submitting: x.submitting }}
        busy={command.pending}
        dirty={draft.amount !== null || draft.reason !== ''}
        error={command.error ? <Notice tone="error">{command.error}</Notice> : undefined}
        onClose={onClose}
        onSubmit={submit}
      >
        <FormGrid>
          <Field label={x.from} error={invalid('from')} required full>
            {(control) => (
              <Select
                {...control}
                value={draft.fromFundId}
                options={mine.map((item) => ({ value: item.id, label: item.name }))}
                onChange={(event) => {
                  const fromFundId = event.target.value;
                  setDraft({
                    ...draft,
                    fromFundId,
                    toFundId: transferTargets(mine, fromFundId)[0]?.id ?? '',
                  });
                }}
              />
            )}
          </Field>
          <Field label={x.to} error={invalid('to')} required full>
            {(control) => (
              <Select
                {...control}
                value={draft.toFundId}
                options={targets.map((item) => ({ value: item.id, label: item.name }))}
                onChange={(event) => setDraft({ ...draft, toFundId: event.target.value })}
              />
            )}
          </Field>
          <Field label={x.amount} error={invalid('amount')} required full>
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
          <Field label={x.reason} hint={x.reasonHint} error={invalid('reason')} required full>
            {(control) => (
              <Textarea
                {...control}
                rows={3}
                maxLength={500}
                value={draft.reason}
                onChange={(event) => setDraft({ ...draft, reason: event.target.value })}
              />
            )}
          </Field>
        </FormGrid>
      </FormDialog>
      {command.dialog}
    </>
  );
}

function ReverseDialog({
  entry,
  onDone,
  onClose,
}: {
  entry: CashEntryItem;
  onDone: () => void;
  onClose: () => void;
}) {
  const { t, locale } = useWorkforce();
  const c = cashDictionary(locale);
  const r = c.reverse;
  const [reason, setReason] = useState('');
  const [checked, setChecked] = useState(false);
  const command = useCommand();
  const missing = checked && (reason.trim().length === 0 || reason.trim().length > 500);

  async function submit() {
    setChecked(true);
    if (reason.trim().length === 0 || reason.trim().length > 500) return;
    await command.run<CashEntryResponse>(
      `/api/v1/cash/entries/${entry.id}/reverse`,
      { reason: reason.trim(), clientRequestId: command.requestId },
      onDone,
    );
  }

  return (
    <>
      <FormDialog
        title={r.title}
        description={`${c.categories[entry.category]}: ${signedVnd(vndNumber(entry.amountVnd), locale)}. ${r.description}`}
        labels={{ ...formOverlayLabels(t, r.submit), submitting: r.submitting }}
        busy={command.pending}
        dirty={reason !== ''}
        error={command.error ? <Notice tone="error">{command.error}</Notice> : undefined}
        onClose={onClose}
        onSubmit={submit}
      >
        <FormGrid>
          <Field label={r.reason} error={missing ? t.errors.validation : undefined} required full>
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
      {command.dialog}
    </>
  );
}

export { useCommand };
