'use client';

import type {
  ProductExchangeSummaryResponse,
  ProductRefundSummaryResponse,
  ProductReturnCaseResponse,
  ProductReturnContextResponse,
  ProductReturnListItem,
  ProductReturnListResponse,
  ProductReturnLookupLine,
  ProductReturnLookupResponse,
} from '@lucy-spa/contracts';
import {
  Breadcrumbs,
  Card,
  ConfirmDialog,
  DataTable,
  DescriptionList,
  FacetedFilter,
  Field,
  FormActions,
  FormDialog,
  FormGrid,
  ListToolbar,
  MediaGrid,
  MediaPreview,
  MediaTile,
  NumberInput,
  Dialog,
  Page,
  RadioGroup,
  RowActions,
  SearchInput,
  Select,
  Stack,
  Textarea,
  TextInput,
  CheckField,
  useUrlState,
  type DataTableColumn,
} from '@lucy-spa/ui';
import { useRef, useState, type FormEvent } from 'react';
import { productExchangesDictionary } from '../../../i18n/product-exchanges';
import { productRefundsDictionary } from '../../../i18n/product-refunds';
import { productReturnsDictionary } from '../../../i18n/product-returns';
import { fill } from '../../../i18n/workforce';
import { ApiError } from '../../../lib/workforce/api';
import { formatDateTime, formatVnd } from '../../../lib/workforce/format';
import { formOverlayLabels } from '../../../lib/workforce/form-labels';
import { paginationLabels, resultsText, toolbarLabels } from '../../../lib/workforce/list-view';
import {
  emptyReturnDraft,
  isReturnConflict,
  needsQualifyingPhoto,
  newClientRequestId,
  normalizeReturnList,
  photoProblemText,
  precheckReturnPhoto,
  presentPhotos,
  reasonOpen,
  reasonPastWindow,
  removedPhotoCount,
  returnDraftValid,
  returnErrorText,
  returnOpenRequest,
  returnPhotoUrl,
  returnProductName,
  returnStatusTone,
  RETURN_LIST_DEFAULTS,
  RETURN_NOTE_MAX,
  RETURN_PHOTO_TYPES,
  RETURN_OUTCOMES,
  RETURN_PAGE_KEYS,
  RETURN_REASONS,
  RETURN_STATUSES,
  validateReturnDraft,
  type ReturnDraft,
  type ReturnListState,
} from '../../../lib/workforce/product-returns';
import { isExchangeConflict } from '../../../lib/workforce/product-exchanges';
import { isRefundConflict } from '../../../lib/workforce/product-refunds';
import { errorMessage } from '../../../lib/workforce/workflows';
import { PrefetchLink as Link } from '../link';
import {
  CompleteExchangeDialog,
  ExchangeCorrectionDialog,
  ExchangeDrawer,
  ExchangesPending,
  ExchangesSection,
} from './product-exchanges';
import { CorrectionDialog, RefundDialog, RefundsPending, RefundsSection } from './product-refunds';
import { useWorkforce } from '../session';
import {
  Badge,
  Button,
  Empty,
  ErrorState,
  Loading,
  Notice,
  PageHeader,
  Section,
  useResource,
  useSuccessToast,
  type Resource,
} from '../ui';

const ZONE = 'Asia/Ho_Chi_Minh';
const PAGE_SIZE = 20;

/** What the signed-in person may do with return cases: the branches and powers the API reports (it decides again on every request). */
function useReturnContext() {
  const { api } = useWorkforce();
  return useResource(
    () => api.get<ProductReturnContextResponse>('/api/v1/product-returns/context'),
    [api],
  );
}

/** The chosen branch when the person works there, else the first branch they work at (null when none). */
function resolveBranch(context: ProductReturnContextResponse, chosen: string) {
  return context.branches.find((branch) => branch.id === chosen) ?? context.branches[0] ?? null;
}

// ----------------------------------------------------------------------------------------------------- the list

export function ProductReturnsScreen() {
  const { t } = useWorkforce();
  const context = useReturnContext();
  if (context.error && !context.data) {
    return <ErrorState error={context.error} t={t} onRetry={() => void context.reload()} />;
  }
  if (!context.data) return <Loading t={t} page />;
  return <ProductReturnsView context={context.data} />;
}

/** The page: it fetches the branch's page of cases and hands it to the list (which a test renders with data). */
export function ProductReturnsView({ context }: { context: ProductReturnContextResponse }) {
  const { api } = useWorkforce();
  const [list, updateList] = useUrlState(RETURN_LIST_DEFAULTS, {
    normalize: normalizeReturnList,
    resetOnChange: RETURN_PAGE_KEYS,
  });
  const branch = resolveBranch(context, list.branch);
  const cases = useResource(
    () =>
      branch
        ? api.get<ProductReturnListResponse>('/api/v1/product-returns/cases', {
            branchId: branch.id,
            status: list.status,
            reason: list.reason,
            q: list.q,
            page: list.page,
          })
        : Promise.resolve(null),
    [api, branch?.id, list.status, list.reason, list.q, list.page],
  );
  return <ProductReturnsList context={context} list={list} updateList={updateList} cases={cases} />;
}

/** "Trả hàng": the cases of one branch, newest first, 20 per page; filters and the page live in the address bar. */
export function ProductReturnsList({
  context,
  list,
  updateList,
  cases,
}: {
  context: ProductReturnContextResponse;
  list: ReturnListState;
  updateList: (patch: Partial<ReturnListState>, change?: { replace?: boolean }) => void;
  cases: Resource<ProductReturnListResponse | null>;
}) {
  const { t, locale, base, navigate } = useWorkforce();
  const text = productReturnsDictionary(locale);
  const l = text.list;
  const branch = resolveBranch(context, list.branch);
  if (!branch) {
    return (
      <>
        <PageHeader title={text.title} />
        <Notice tone="info">{text.noAccess}</Notice>
      </>
    );
  }
  const rows = cases.data?.items ?? [];
  const active = (list.q ? 1 : 0) + (list.status ? 1 : 0) + (list.reason ? 1 : 0);
  const open = (item: ProductReturnListItem) => `${base}/product-returns/${item.id}`;

  const columns: DataTableColumn<ProductReturnListItem>[] = [
    {
      key: 'code',
      header: l.columns.code,
      mobileTitle: true,
      cell: (item) => (
        <Link className="ls-link" href={open(item)}>
          {item.code}
        </Link>
      ),
    },
    {
      key: 'product',
      header: l.columns.product,
      phoneEmphasis: true,
      truncate: true,
      width: 'md',
      cell: (item) => returnProductName(item, locale),
    },
    {
      key: 'invoice',
      header: l.columns.invoice,
      hideBelow: 'md',
      hidePhone: true,
      cell: (item) => item.invoiceCode,
    },
    {
      key: 'quantity',
      header: l.columns.quantity,
      numeric: true,
      hideBelow: 'md',
      hidePhone: true,
      cell: (item) => item.quantity,
    },
    {
      key: 'wanted',
      header: l.columns.wanted,
      hideBelow: '2xl',
      hidePhone: true,
      cell: (item) => text.outcomes[item.requestedOutcome],
    },
    {
      key: 'status',
      header: l.columns.status,
      cell: (item) => (
        <Badge tone={returnStatusTone(item.status)}>{text.statuses[item.status]}</Badge>
      ),
    },
    {
      key: 'openedAt',
      header: l.columns.openedAt,
      hideBelow: 'xl',
      cell: (item) => formatDateTime(item.openedAt, ZONE, locale),
    },
    {
      key: 'reason',
      header: l.columns.reason,
      truncate: true,
      width: 'md',
      hideBelow: '2xl',
      hidePhone: true,
      cell: (item) => text.reasons[item.reason],
    },
    {
      key: 'openedBy',
      header: l.columns.openedBy,
      truncate: true,
      width: 'sm',
      hideBelow: '2xl',
      hidePhone: true,
      cell: (item) => item.openedByName,
    },
    {
      key: 'photos',
      header: l.columns.photos,
      numeric: true,
      hideBelow: '2xl',
      hidePhone: true,
      cell: (item) => item.photoCount,
    },
    {
      key: 'actions',
      header: t.common.actions,
      actions: true,
      cell: (item) => (
        <RowActions
          menuLabel={fill(t.common.list.actionsFor, { name: item.code })}
          items={[
            { id: 'open', label: l.open, icon: 'eye', onSelect: () => navigate?.(open(item)) },
          ]}
        />
      ),
    },
  ];

  const branchControl =
    context.branches.length > 1 ? (
      <Select
        aria-label={text.branch}
        value={branch.id}
        options={context.branches.map((entry) => ({ value: entry.id, label: entry.name }))}
        onChange={(event) => updateList({ branch: event.target.value })}
      />
    ) : null;

  return (
    <>
      <PageHeader title={text.title} intro={text.intro}>
        {branch.manage ? (
          <Button
            variant="primary"
            icon="plus"
            onClick={() =>
              navigate?.(`${base}/product-returns/new?branch=${encodeURIComponent(branch.id)}`)
            }
          >
            {l.add}
          </Button>
        ) : null}
      </PageHeader>
      <>
        <ListToolbar
          labels={toolbarLabels(t)}
          activeFilters={active}
          resultCount={cases.data ? resultsText(t, cases.data.total) : undefined}
          onReset={() => updateList({ q: '', status: '', reason: '' })}
          reload={{ label: t.common.reload, onClick: () => void cases.reload() }}
          search={
            <SearchInput
              id="return-q"
              value={list.q}
              label={l.search}
              placeholder={l.search}
              clearLabel={t.common.list.clearSearch}
              onSearch={(q) => updateList({ q }, { replace: true })}
            />
          }
          filters={
            <>
              {branchControl}
              <FacetedFilter
                label={l.status}
                clearLabel={t.common.list.clearChoice}
                options={RETURN_STATUSES.map((status) => ({
                  value: status,
                  label: text.statuses[status],
                }))}
                selected={list.status ? [list.status] : []}
                onChange={([status]) => updateList({ status: status ?? '' })}
              />
              <FacetedFilter
                label={l.reason}
                clearLabel={t.common.list.clearChoice}
                options={RETURN_REASONS.map((reason) => ({
                  value: reason,
                  label: text.reasons[reason],
                }))}
                selected={list.reason ? [list.reason] : []}
                onChange={([reason]) => updateList({ reason: reason ?? '' })}
              />
            </>
          }
        />
        <DataTable
          mode="server"
          phoneRows="compact"
          caption={fill(t.common.list.table, { list: text.title })}
          columns={columns}
          rows={rows}
          rowKey={(item) => `${item.id}:${item.status}`}
          loading={cases.loading && !cases.data}
          loadingLabel={t.common.loading}
          error={
            cases.error ? (
              <ErrorState error={cases.error} t={t} onRetry={() => void cases.reload()} />
            ) : undefined
          }
          empty={cases.data ? <Empty>{active > 0 ? l.noMatch : l.empty}</Empty> : undefined}
          paging={{
            page: list.page,
            pageSize: PAGE_SIZE,
            total: cases.data?.total ?? rows.length,
            onPageChange: (page) => updateList({ page }),
            labels: paginationLabels(t, text.title),
          }}
        />
      </>
    </>
  );
}

// ------------------------------------------------------------------------------------------------- a new case

export function ProductReturnNewScreen() {
  const { t } = useWorkforce();
  const context = useReturnContext();
  if (context.error && !context.data) {
    return <ErrorState error={context.error} t={t} onRetry={() => void context.reload()} />;
  }
  if (!context.data) return <Loading t={t} page />;
  return <ProductReturnForm context={context.data} />;
}

type Lookup =
  | { state: 'idle' }
  | { state: 'busy' }
  | { state: 'found'; found: ProductReturnLookupResponse }
  | { state: 'failed'; message: string };

/**
 * "Mở hồ sơ trả hàng": a long form, so its own page. Find the paid invoice by its code, choose the product line, then give the
 * reason, what the customer wants, the quantity, the seal check and the notes. The reasons whose window is over are shown but cannot
 * be chosen (there is no override); the API decides again.
 */
export function ProductReturnForm({
  context,
  preset,
}: {
  context: ProductReturnContextResponse;
  /** A looked-up invoice and a draft to start from (the tests render the form with data; the page never passes it). */
  preset?: { found: ProductReturnLookupResponse; draft?: Partial<ReturnDraft> };
}) {
  const { api, t, locale, base, navigate } = useWorkforce();
  const text = productReturnsDictionary(locale);
  const f = text.form;
  const notify = useSuccessToast();
  const [{ branch: chosen }] = useUrlState({ branch: '' });
  const branches = context.branches.filter((entry) => entry.manage);
  const [branchId, setBranchId] = useState(
    branches.find((entry) => entry.id === chosen)?.id ?? branches[0]?.id ?? '',
  );
  const [draft, setDraft] = useState<ReturnDraft>(() => ({
    ...emptyReturnDraft(),
    ...preset?.draft,
  }));
  const [lookup, setLookup] = useState<Lookup>(
    preset ? { state: 'found', found: preset.found } : { state: 'idle' },
  );
  const [checked, setChecked] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attempt = useRef(newClientRequestId());
  const set = (patch: Partial<ReturnDraft>) => setDraft((state) => ({ ...state, ...patch }));
  const back = `${base}/product-returns${branchId ? `?branch=${encodeURIComponent(branchId)}` : ''}`;

  const found = lookup.state === 'found' ? lookup.found : null;
  const line: ProductReturnLookupLine | null =
    found?.lines.find((entry) => entry.lineId === draft.lineId) ?? null;
  // Only the Owner may take a product back after its window, with a written reason (P6-12 follow-up, 2026-10-08).
  const canException = context.owner;
  const errors = validateReturnDraft(draft, line, canException);

  async function find(event?: FormEvent) {
    event?.preventDefault();
    const code = draft.invoiceCode.trim();
    if (code === '' || !branchId) {
      setLookup({ state: 'failed', message: text.errors.fields.invoiceCode });
      return;
    }
    setLookup({ state: 'busy' });
    setError(null);
    try {
      const result = await api.get<ProductReturnLookupResponse>('/api/v1/product-returns/lookup', {
        branchId,
        invoiceCode: code,
      });
      const only = result.lines.length === 1 ? result.lines[0]! : null;
      setLookup({ state: 'found', found: result });
      set({
        lineId: only && only.availableQuantity > 0 ? only.lineId : '',
        reason: '',
        quantity: '1',
      });
    } catch (failure) {
      const message =
        failure instanceof ApiError && failure.code === 'NOT_FOUND'
          ? f.notFound
          : failure instanceof ApiError && failure.code === 'RETURN_NOT_ELIGIBLE'
            ? f.notEligible
            : returnErrorText(failure, locale, (cause) => errorMessage(cause, t));
      setLookup({ state: 'failed', message });
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setChecked(true);
    setError(null);
    const body = returnOpenRequest(draft, line, branchId, attempt.current, canException);
    if (!body) return;
    setPending(true);
    try {
      const created = await api.post<ProductReturnCaseResponse>(
        '/api/v1/product-returns/cases',
        body,
      );
      notify(
        fill(created.reason === 'WRONG_OR_DAMAGED' ? f.createdPhoto : f.created, {
          code: created.code,
        }),
      );
      navigate?.(`${base}/product-returns/${created.id}`);
    } catch (failure) {
      setError(returnErrorText(failure, locale, (cause) => errorMessage(cause, t)));
      setPending(false);
    }
  }

  const shown = (key: keyof typeof errors, invalid?: string) =>
    checked && errors[key]
      ? errors[key] === 'required'
        ? text.required
        : (invalid ?? text.invalid)
      : undefined;

  return (
    <Page width="form">
      <PageHeader
        title={f.title}
        breadcrumbs={
          <Breadcrumbs
            label={text.breadcrumbs}
            LinkComponent={Link}
            items={[{ label: text.title, href: back }, { label: f.title }]}
          />
        }
      />
      {branches.length === 0 ? (
        <Notice tone="info">{f.noBranch}</Notice>
      ) : (
        <form noValidate onSubmit={(event) => void submit(event)} aria-label={f.title}>
          <Stack gap="block">
            <Card as="section" aria-label={f.invoiceTitle}>
              <Stack gap="page">
                <FormGrid cols={2}>
                  {branches.length > 1 ? (
                    <Field label={text.branch}>
                      {(control) => (
                        <Select
                          {...control}
                          value={branchId}
                          options={branches.map((entry) => ({
                            value: entry.id,
                            label: entry.name,
                          }))}
                          onChange={(event) => {
                            setBranchId(event.target.value);
                            setLookup({ state: 'idle' });
                            set({ lineId: '', reason: '' });
                          }}
                        />
                      )}
                    </Field>
                  ) : null}
                  <Field
                    label={f.invoiceCode}
                    required
                    hint={f.invoiceHint}
                    full={branches.length < 2}
                  >
                    {(control) => (
                      <TextInput
                        {...control}
                        autoComplete="off"
                        maxLength={40}
                        value={draft.invoiceCode}
                        onChange={(event) => set({ invoiceCode: event.target.value })}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') void find(event);
                        }}
                      />
                    )}
                  </Field>
                </FormGrid>
                <div>
                  <Button
                    variant="secondary"
                    icon="search"
                    loading={lookup.state === 'busy'}
                    onClick={() => void find()}
                  >
                    {lookup.state === 'busy' ? f.finding : f.find}
                  </Button>
                </div>
                {lookup.state === 'failed' ? <Notice tone="error">{lookup.message}</Notice> : null}
                {found ? (
                  <p className="ls-hint">
                    {found.invoice.code} ·{' '}
                    {fill(f.paidAt, { time: formatDateTime(found.invoice.paidAt, ZONE, locale) })} ·{' '}
                    {found.invoice.customerName
                      ? fill(f.customer, { name: found.invoice.customerName })
                      : f.guest}
                  </p>
                ) : null}
              </Stack>
            </Card>
            {found && found.lines.length === 0 ? <Notice tone="info">{f.noProducts}</Notice> : null}
            {found && found.lines.length > 0 ? (
              <Card as="section" aria-label={f.linesTitle}>
                <Stack gap="page">
                  <RadioGroup
                    legend={f.linesTitle}
                    name="return-line"
                    value={draft.lineId || null}
                    invalid={checked && errors.line !== undefined}
                    onValueChange={(lineId) => set({ lineId, reason: '', quantity: '1' })}
                    options={found.lines.map((entry) => ({
                      value: entry.lineId,
                      label: `${returnProductName(entry, locale)} (${entry.sku})`,
                      hint: fill(entry.availableQuantity > 0 ? f.lineBought : f.lineNothingLeft, {
                        bought: entry.quantity,
                        left: entry.availableQuantity,
                      }),
                      disabled: entry.availableQuantity === 0,
                    }))}
                  />
                  {checked && errors.line ? <Notice tone="error">{f.chooseLine}</Notice> : null}
                </Stack>
              </Card>
            ) : null}
            {line ? (
              <Card as="section" aria-label={f.detailsTitle}>
                <Stack gap="page">
                  <RadioGroup
                    legend={f.reason}
                    name="return-reason"
                    value={draft.reason || null}
                    required
                    invalid={checked && errors.reason !== undefined}
                    onValueChange={(reason) =>
                      set({ reason: reason as ReturnDraft['reason'], seal: false })
                    }
                    options={RETURN_REASONS.map((reason) => {
                      const status = line.reasons[reason];
                      const closed = !reasonOpen(line, reason);
                      const owner = canException && reasonPastWindow(line, reason);
                      return {
                        value: reason,
                        label: text.reasons[reason],
                        hint:
                          closed && status.endsAt
                            ? fill(owner ? f.reasonOverOwner : f.reasonOver, {
                                time: formatDateTime(status.endsAt, ZONE, locale),
                              })
                            : text.reasonHints[reason],
                        disabled: closed && !owner,
                      };
                    })}
                  />
                  {checked && errors.reason ? (
                    <Notice tone="error">
                      {errors.reason === 'required' ? f.chooseReason : f.reasonClosed}
                    </Notice>
                  ) : null}
                  {draft.reason !== '' && canException && reasonPastWindow(line, draft.reason) ? (
                    <>
                      <Notice tone="warning">{f.exceptionBody}</Notice>
                      <Field
                        label={f.exceptionReason}
                        hint={f.exceptionReasonHint}
                        required
                        full
                        error={shown('exception', text.errors.fields.windowExceptionReason)}
                      >
                        {(control) => (
                          <Textarea
                            {...control}
                            rows={3}
                            maxLength={RETURN_NOTE_MAX}
                            value={draft.exceptionReason}
                            onChange={(event) => set({ exceptionReason: event.target.value })}
                          />
                        )}
                      </Field>
                    </>
                  ) : null}
                  <FormGrid cols={2}>
                    <Field label={f.wanted} required>
                      {(control) => (
                        <Select
                          {...control}
                          value={draft.outcome}
                          options={RETURN_OUTCOMES.map((outcome) => ({
                            value: outcome,
                            label: text.outcomes[outcome],
                          }))}
                          onChange={(event) =>
                            set({ outcome: event.target.value as ReturnDraft['outcome'] })
                          }
                        />
                      )}
                    </Field>
                    <Field
                      label={f.quantity}
                      required
                      error={shown('quantity', text.errors.fields.quantity)}
                    >
                      {(control) => (
                        <NumberInput
                          {...control}
                          min={1}
                          max={line.availableQuantity}
                          step={1}
                          value={draft.quantity}
                          onChange={(event) => set({ quantity: event.target.value })}
                        />
                      )}
                    </Field>
                  </FormGrid>
                  {draft.reason === 'PERSONAL_PREFERENCE' || draft.reason === 'WRONG_OR_DAMAGED' ? (
                    <CheckField
                      label={f.seal}
                      {...(draft.reason === 'PERSONAL_PREFERENCE' ? { hint: f.sealHint } : {})}
                      checked={draft.seal}
                      onChange={(event) => set({ seal: event.target.checked })}
                    />
                  ) : null}
                  {checked && errors.seal ? (
                    <Notice tone="error">{text.errors.RETURN_SEAL_REQUIRED}</Notice>
                  ) : null}
                  <Field
                    label={f.notes}
                    hint={f.notesHint}
                    full
                    error={shown('notes', text.errors.fields.notes)}
                  >
                    {(control) => (
                      <Textarea
                        {...control}
                        rows={4}
                        maxLength={RETURN_NOTE_MAX}
                        value={draft.notes}
                        onChange={(event) => set({ notes: event.target.value })}
                      />
                    )}
                  </Field>
                </Stack>
              </Card>
            ) : null}
            {error ? <Notice tone="error">{error}</Notice> : null}
            {line ? (
              <FormActions
                cancel={
                  <Button variant="secondary" onClick={() => navigate?.(back)}>
                    {t.common.cancel}
                  </Button>
                }
                primary={
                  <Button
                    type="submit"
                    variant="primary"
                    loading={pending}
                    disabled={checked && !returnDraftValid(errors)}
                  >
                    {pending ? f.submitting : f.submit}
                  </Button>
                }
              />
            ) : null}
          </Stack>
        </form>
      )}
    </Page>
  );
}

// -------------------------------------------------------------------------------------------------- one case

export function ProductReturnCaseScreen({ id }: { id: string }) {
  const { api, t } = useWorkforce();
  const found = useResource(
    () =>
      api.get<ProductReturnCaseResponse>(`/api/v1/product-returns/cases/${encodeURIComponent(id)}`),
    [api, id],
  );
  // The money of a case is shown to the people who hold REFUND_PRODUCTS at its branch (the API decides again).
  const showRefunds =
    found.data?.can.refunds === true &&
    found.data.status === 'ACCEPTED' &&
    found.data.decidedOutcome === 'REFUND';
  const refunds = useResource(
    () =>
      showRefunds
        ? api.get<ProductRefundSummaryResponse>(
            `/api/v1/product-returns/cases/${encodeURIComponent(id)}/refunds`,
          )
        : Promise.resolve(null),
    [api, id, showRefunds],
  );
  // The same for an accepted exchange case (P6-14): its card, its figures and its commands.
  const showExchanges =
    found.data?.can.refunds === true &&
    found.data.status === 'ACCEPTED' &&
    found.data.decidedOutcome === 'EXCHANGE';
  const exchanges = useResource(
    () =>
      showExchanges
        ? api.get<ProductExchangeSummaryResponse>(
            `/api/v1/product-returns/cases/${encodeURIComponent(id)}/exchanges`,
          )
        : Promise.resolve(null),
    [api, id, showExchanges],
  );
  if (found.error && !found.data) {
    return <ErrorState error={found.error} t={t} onRetry={() => void found.reload()} />;
  }
  if (!found.data) return <Loading t={t} page />;
  return (
    <ProductReturnCaseView
      item={found.data}
      reload={found.reload}
      refunds={
        showRefunds ? { summary: refunds.data, error: refunds.error, reload: refunds.reload } : null
      }
      exchanges={
        showExchanges
          ? { summary: exchanges.data, error: exchanges.error, reload: exchanges.reload }
          : null
      }
    />
  );
}

type Overlay =
  | 'accept'
  | 'decline'
  | 'cancel'
  | 'note'
  | 'refund'
  | 'correct'
  | 'exchange'
  | 'complete'
  | 'exchange-correct'
  | null;

/**
 * One case. An open case the person may decide carries the page's one primary action ("Chấp nhận"); "Từ chối" and "Hủy hồ sơ" sit in
 * the information card's menu. The evidence photos are private: they are shown only here, through the permission-checked endpoint.
 * A closed case is read-only; anything new is only added to the history.
 */
export function ProductReturnCaseView({
  item,
  reload,
  refunds = null,
  exchanges = null,
}: {
  item: ProductReturnCaseResponse;
  reload: () => Promise<void>;
  /**
   * The refunds of an accepted refund case, for the people who may see them (P6-13); absent for everyone else. The place of the card is
   * known from the case itself (`can.refunds`), so it shows a loading card, then the refunds or a retry, and nothing jumps in later.
   */
  refunds?: {
    summary: ProductRefundSummaryResponse | null;
    error?: unknown;
    reload: () => Promise<void>;
  } | null;
  /** The exchanges of an accepted exchange case (P6-14), the same way as the refunds above. */
  exchanges?: {
    summary: ProductExchangeSummaryResponse | null;
    error?: unknown;
    reload: () => Promise<void>;
  } | null;
}) {
  const { api, t, locale, base } = useWorkforce();
  const text = productReturnsDictionary(locale);
  const v = text.view;
  const notify = useSuccessToast();
  const [overlay, setOverlay] = useState<Overlay>(null);
  const refundSlot =
    item.can.refunds && item.status === 'ACCEPTED' && item.decidedOutcome === 'REFUND';
  const refundSummary = refunds?.summary ?? null;
  const exchangeSlot =
    item.can.refunds && item.status === 'ACCEPTED' && item.decidedOutcome === 'EXCHANGE';
  const exchangeSummary = exchanges?.summary ?? null;
  const path = `/api/v1/product-returns/cases/${item.id}`;
  const describeError = (error: unknown) => ({
    message: returnErrorText(error, locale, (cause) => errorMessage(cause, t)),
    reference: error instanceof ApiError ? error.requestId : null,
  });
  const when = (instant: string) => formatDateTime(instant, ZONE, locale);
  const settle = async (error: unknown) => {
    if (isReturnConflict(error)) await reload();
  };

  return (
    <>
      <PageHeader
        title={item.code}
        breadcrumbs={
          <Breadcrumbs
            label={text.breadcrumbs}
            LinkComponent={Link}
            items={[
              {
                label: text.title,
                href: `${base}/product-returns?branch=${encodeURIComponent(item.branchId)}`,
              },
              { label: item.code },
            ]}
          />
        }
      >
        {item.can.decide ? (
          <Button variant="primary" onClick={() => setOverlay('accept')}>
            {v.accept}
          </Button>
        ) : refundSummary?.can.refund ? (
          <Button variant="primary" onClick={() => setOverlay('refund')}>
            {productRefundsDictionary(locale).action}
          </Button>
        ) : exchangeSummary?.can.exchange ? (
          <Button variant="primary" onClick={() => setOverlay('exchange')}>
            {productExchangesDictionary(locale).action}
          </Button>
        ) : null}
      </PageHeader>
      <Stack gap="page">
        {item.status === 'ACCEPTED' && !refundSlot && !exchangeSlot ? (
          <Notice tone="info">{v.acceptedNotice}</Notice>
        ) : null}
        {item.status === 'DECLINED' || item.status === 'CANCELLED' ? (
          <Notice tone="info">{v.closedNotice}</Notice>
        ) : null}
        {needsQualifyingPhoto(item) ? (
          <Notice tone="warning">
            {item.windowException ? v.photoNeededException : v.photoNeeded}
          </Notice>
        ) : null}
        <Section
          title={v.info}
          actions={
            item.can.decide || item.can.cancel ? (
              <RowActions
                menuLabel={v.moreActions}
                items={[
                  ...(item.can.decide
                    ? [
                        {
                          id: 'decline',
                          label: v.decline,
                          tone: 'danger' as const,
                          onSelect: () => setOverlay('decline'),
                        },
                      ]
                    : []),
                  ...(item.can.cancel
                    ? [
                        {
                          id: 'cancel',
                          label: v.cancel,
                          tone: 'danger' as const,
                          onSelect: () => setOverlay('cancel'),
                        },
                      ]
                    : []),
                ]}
              />
            ) : undefined
          }
        >
          <DescriptionList
            columns={2}
            items={[
              {
                label: v.fields.status,
                value: (
                  <Badge tone={returnStatusTone(item.status)}>{text.statuses[item.status]}</Badge>
                ),
              },
              { label: v.fields.reason, value: text.reasons[item.reason] },
              { label: v.fields.wanted, value: text.outcomes[item.requestedOutcome] },
              ...(item.decidedOutcome
                ? [{ label: v.fields.decided, value: text.outcomes[item.decidedOutcome] }]
                : []),
              {
                label: v.fields.product,
                value: `${returnProductName(item.line, locale)} (${item.line.sku})`,
              },
              {
                label: v.fields.quantity,
                value: fill(v.quantityOf, {
                  quantity: item.quantity,
                  sold: item.line.soldQuantity,
                }),
              },
              { label: v.fields.invoice, value: item.invoice.code },
              { label: v.fields.customer, value: item.invoice.customerName ?? v.guest },
              {
                label: v.fields.seal,
                value:
                  item.sealIntact === null ? v.sealUnknown : item.sealIntact ? v.sealYes : v.sealNo,
              },
              { label: v.fields.handover, value: when(item.handoverAt) },
              {
                label: v.fields.window,
                value: item.windowEndsAt
                  ? fill(v.windowEnds, { time: when(item.windowEndsAt) })
                  : v.windowNone,
              },
              ...(item.windowException
                ? [
                    {
                      label: v.fields.exception,
                      value: (
                        <>
                          <span className="ls-hint">
                            {fill(v.exceptionBy, {
                              name: item.windowException.byName,
                              time: when(item.windowException.at),
                            })}
                          </span>
                          <p>{item.windowException.reason}</p>
                        </>
                      ),
                    },
                  ]
                : []),
              { label: v.fields.branch, value: item.branchName },
              {
                label: v.fields.openedBy,
                value: `${item.openedByName} · ${when(item.openedAt)}`,
              },
              ...(item.closedAt
                ? [
                    {
                      label: v.fields.closedBy,
                      value: `${item.closedByName ?? text.none} · ${when(item.closedAt)}`,
                    },
                  ]
                : []),
              ...(item.closingNote
                ? [{ label: v.fields.closingNote, value: item.closingNote }]
                : []),
              { label: v.fields.notes, value: item.notes ?? text.none },
            ]}
          />
        </Section>
        {refundSlot ? (
          refundSummary ? (
            <RefundsSection summary={refundSummary} onCorrect={() => setOverlay('correct')} />
          ) : (
            <RefundsPending error={refunds?.error ?? null} onRetry={refunds?.reload} />
          )
        ) : null}
        {exchangeSlot ? (
          exchangeSummary ? (
            <ExchangesSection
              summary={exchangeSummary}
              onComplete={() => setOverlay('complete')}
              onCorrect={() => setOverlay('exchange-correct')}
            />
          ) : (
            <ExchangesPending error={exchanges?.error ?? null} onRetry={exchanges?.reload} />
          )
        ) : null}
        <PhotosSection item={item} reload={reload} />
        <Section
          title={v.history}
          actions={
            item.can.note ? (
              <Button variant="secondary" icon="plus" onClick={() => setOverlay('note')}>
                {v.addNote}
              </Button>
            ) : undefined
          }
        >
          {item.events.length === 0 ? (
            <p className="ls-hint">{v.historyEmpty}</p>
          ) : (
            <DescriptionList
              columns={1}
              items={item.events.map((event) => ({
                label: text.events[event.kind],
                value: (
                  <>
                    <span className="ls-hint">
                      {fill(v.historyBy, { name: event.actorName, time: when(event.occurredAt) })}
                    </span>
                    {event.note ? <p>{event.note}</p> : null}
                  </>
                ),
              }))}
            />
          )}
        </Section>
      </Stack>
      {overlay === 'accept' ? (
        <AcceptDialog
          item={item}
          onClose={() => setOverlay(null)}
          onDone={async () => {
            setOverlay(null);
            await reload();
            notify(v.acceptDone);
          }}
          onFail={settle}
        />
      ) : null}
      {overlay === 'refund' && refunds && refundSummary ? (
        <RefundDialog
          item={item}
          summary={refundSummary}
          onClose={() => setOverlay(null)}
          onDone={async (code, amount) => {
            setOverlay(null);
            await refunds.reload();
            notify(
              fill(productRefundsDictionary(locale).form.done, {
                code,
                amount: formatVnd(amount, locale),
              }),
            );
          }}
          onFail={async (error) => {
            if (isRefundConflict(error)) await refunds.reload();
          }}
        />
      ) : null}
      {overlay === 'correct' && refunds && refundSummary ? (
        <CorrectionDialog
          item={item}
          summary={refundSummary}
          onClose={() => setOverlay(null)}
          onDone={async () => {
            setOverlay(null);
            await refunds.reload();
            notify(productRefundsDictionary(locale).correct.done);
          }}
          onFail={async (error) => {
            if (isRefundConflict(error)) await refunds.reload();
          }}
        />
      ) : null}
      {overlay === 'exchange' && exchanges ? (
        <ExchangeDrawer
          item={item}
          onClose={() => setOverlay(null)}
          onDone={async (code) => {
            setOverlay(null);
            await exchanges.reload();
            notify(fill(productExchangesDictionary(locale).form.done, { code }));
          }}
          onFail={async (error) => {
            if (isExchangeConflict(error)) await exchanges.reload();
          }}
        />
      ) : null}
      {overlay === 'complete' && exchanges && exchangeSummary ? (
        <CompleteExchangeDialog
          item={item}
          summary={exchangeSummary}
          onClose={() => setOverlay(null)}
          onDone={async () => {
            setOverlay(null);
            await exchanges.reload();
            notify(productExchangesDictionary(locale).complete.done);
          }}
          onFail={async (error) => {
            if (isExchangeConflict(error)) await exchanges.reload();
          }}
        />
      ) : null}
      {overlay === 'exchange-correct' && exchanges && exchangeSummary ? (
        <ExchangeCorrectionDialog
          item={item}
          summary={exchangeSummary}
          onClose={() => setOverlay(null)}
          onDone={async () => {
            setOverlay(null);
            await exchanges.reload();
            notify(productExchangesDictionary(locale).correct.done);
          }}
          onFail={async (error) => {
            if (isExchangeConflict(error)) await exchanges.reload();
          }}
        />
      ) : null}
      {overlay === 'note' ? (
        <NoteDialog
          path={path}
          onClose={() => setOverlay(null)}
          onDone={async () => {
            setOverlay(null);
            await reload();
            notify(v.noteDone);
          }}
        />
      ) : null}
      {overlay === 'decline' || overlay === 'cancel' ? (
        <ConfirmDialog
          title={overlay === 'decline' ? v.declineTitle : v.cancelTitle}
          description={overlay === 'decline' ? v.declineBody : v.cancelBody}
          facts={[{ label: v.codeFact, value: item.code }]}
          tone="warning"
          confirmLabel={overlay === 'decline' ? v.decline : v.cancel}
          busyLabel={text.working}
          cancelLabel={v.keep}
          referenceLabel={t.errors.reference}
          reasonField={{
            label: overlay === 'decline' ? v.declineReason : v.cancelReason,
            required: true,
            requiredLabel: t.common.required,
            requiredMessage: t.common.form.reasonRequired,
          }}
          describeError={describeError}
          onCancel={() => setOverlay(null)}
          onConfirm={async (reason) => {
            try {
              await api.post(`${path}/${overlay}`, {
                expectedRowVersion: item.rowVersion,
                note: reason ?? '',
              });
            } catch (error) {
              await settle(error);
              throw error;
            }
            const done = overlay === 'decline' ? v.declineDone : v.cancelDone;
            setOverlay(null);
            await reload();
            notify(done);
          }}
        />
      ) : null}
    </>
  );
}

function AcceptDialog({
  item,
  onClose,
  onDone,
  onFail,
}: {
  item: ProductReturnCaseResponse;
  onClose: () => void;
  onDone: () => Promise<void>;
  onFail: (error: unknown) => Promise<void>;
}) {
  const { api, t, locale } = useWorkforce();
  const text = productReturnsDictionary(locale);
  const v = text.view;
  const [outcome, setOutcome] = useState<ReturnDraftOutcome>(item.requestedOutcome);
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await api.post(`/api/v1/product-returns/cases/${item.id}/accept`, {
        expectedRowVersion: item.rowVersion,
        outcome,
        note: note.trim() === '' ? null : note.trim(),
      });
      await onDone();
    } catch (failure) {
      await onFail(failure);
      setError(returnErrorText(failure, locale, (cause) => errorMessage(cause, t)));
      setPending(false);
    }
  }
  return (
    <FormDialog
      title={v.acceptTitle}
      description={v.acceptBody}
      labels={{ ...formOverlayLabels(t, v.accept), submitting: text.working }}
      busy={pending}
      dirty={note !== '' || outcome !== item.requestedOutcome}
      error={error ? <Notice tone="error">{error}</Notice> : undefined}
      onClose={onClose}
      onSubmit={submit}
    >
      <FormGrid cols={1}>
        <Field label={v.acceptOutcome} required>
          {(control) => (
            <Select
              {...control}
              value={outcome}
              options={RETURN_OUTCOMES.map((value) => ({ value, label: text.outcomes[value] }))}
              onChange={(event) => setOutcome(event.target.value as ReturnDraftOutcome)}
            />
          )}
        </Field>
        <Field label={v.acceptNote} full>
          {(control) => (
            <Textarea
              {...control}
              rows={3}
              maxLength={RETURN_NOTE_MAX}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          )}
        </Field>
      </FormGrid>
    </FormDialog>
  );
}

type ReturnDraftOutcome = ReturnDraft['outcome'];

function NoteDialog({
  path,
  onClose,
  onDone,
}: {
  path: string;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const { api, t, locale } = useWorkforce();
  const text = productReturnsDictionary(locale);
  const v = text.view;
  const [note, setNote] = useState('');
  const [checked, setChecked] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    setChecked(true);
    if (pending || note.trim() === '') return;
    setPending(true);
    setError(null);
    try {
      await api.post(`${path}/notes`, { note: note.trim() });
      await onDone();
    } catch (failure) {
      setError(returnErrorText(failure, locale, (cause) => errorMessage(cause, t)));
      setPending(false);
    }
  }
  return (
    <FormDialog
      title={v.noteTitle}
      labels={{ ...formOverlayLabels(t, text.save), submitting: text.saving }}
      busy={pending}
      dirty={note !== ''}
      error={error ? <Notice tone="error">{error}</Notice> : undefined}
      onClose={onClose}
      onSubmit={submit}
    >
      <Field
        label={v.noteField}
        required
        error={checked && note.trim() === '' ? text.required : undefined}
      >
        {(control) => (
          <Textarea
            {...control}
            rows={4}
            maxLength={RETURN_NOTE_MAX}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        )}
      </Field>
    </FormDialog>
  );
}

// ------------------------------------------------------------------------------------------------- the photos

function PhotosSection({
  item,
  reload,
}: {
  item: ProductReturnCaseResponse;
  reload: () => Promise<void>;
}) {
  const { api, t, locale } = useWorkforce();
  const text = productReturnsDictionary(locale);
  const v = text.view;
  const notify = useSuccessToast();
  const photos = presentPhotos(item);
  const removed = removedPhotoCount(item);
  const [viewing, setViewing] = useState<number | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const picker = useRef<HTMLInputElement | null>(null);
  const [problems, setProblems] = useState<string[]>([]);

  async function upload(files: File[]) {
    if (uploading) return;
    setUploading(true);
    const failed: string[] = [];
    for (const file of files) {
      const problem = precheckReturnPhoto(file);
      if (problem) {
        failed.push(`${file.name}: ${photoProblemText(problem, locale)}`);
        continue;
      }
      try {
        const form = new FormData();
        form.append('file', file, file.name);
        await api.upload<ProductReturnCaseResponse>(
          `/api/v1/product-returns/cases/${item.id}/photos`,
          form,
        );
      } catch (failure) {
        failed.push(
          `${file.name}: ${returnErrorText(failure, locale, (cause) => errorMessage(cause, t))}`,
        );
        if (isReturnConflict(failure)) break;
      }
    }
    setProblems(failed);
    setUploading(false);
    await reload();
  }

  return (
    <Section
      title={v.photos}
      actions={
        item.can.addPhoto ? (
          <>
            <input
              ref={picker}
              type="file"
              hidden
              tabIndex={-1}
              multiple
              accept={RETURN_PHOTO_TYPES.join(',')}
              aria-label={v.addPhoto}
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                event.target.value = '';
                if (files.length > 0) void upload(files);
              }}
            />
            <Button
              variant="secondary"
              icon="upload"
              loading={uploading}
              onClick={() => picker.current?.click()}
            >
              {uploading ? v.addingPhoto : v.addPhoto}
            </Button>
          </>
        ) : undefined
      }
    >
      <Stack gap="block">
        <p className="ls-hint">{v.privateNote}</p>
        {item.can.addPhoto ? <p className="ls-hint">{v.dropHint}</p> : null}
        {problems.length > 0 ? (
          <Notice tone="error">
            <ul>
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          </Notice>
        ) : null}
        {photos.length === 0 ? (
          <p className="ls-hint">{v.photosEmpty}</p>
        ) : (
          <MediaGrid label={v.photos}>
            {photos.map((photo, index) => (
              <MediaTile
                key={photo.id}
                src={returnPhotoUrl(item.id, photo.id, 'thumb')}
                title={fill(v.photoTitle, { n: index + 1 })}
                meta={formatDateTime(photo.uploadedAt, ZONE, locale)}
                actionLabel={fill(v.photoOpen, { n: index + 1 })}
                onSelect={() => setViewing(index)}
                {...(item.can.removePhoto
                  ? {
                      actions: (
                        <RowActions
                          menuLabel={fill(t.common.list.actionsFor, {
                            name: fill(v.photoTitle, { n: index + 1 }),
                          })}
                          items={[
                            {
                              id: 'remove',
                              label: v.removePhoto,
                              tone: 'danger' as const,
                              onSelect: () => setRemoving(photo.id),
                            },
                          ]}
                        />
                      ),
                    }
                  : {})}
              />
            ))}
          </MediaGrid>
        )}
        {removed > 0 ? (
          <p className="ls-hint">{fill(v.photosRemoved, { count: removed })}</p>
        ) : null}
        {item.status === 'OPEN' && photos.length >= 8 ? (
          <p className="ls-hint">{v.photoLimit}</p>
        ) : null}
      </Stack>
      {viewing !== null && photos[viewing] ? (
        <Dialog
          open
          size="lg"
          title={fill(v.photoTitle, { n: viewing + 1 })}
          closeLabel={t.common.close}
          onClose={() => setViewing(null)}
        >
          <MediaPreview
            src={returnPhotoUrl(item.id, photos[viewing]!.id, 'lg')}
            alt={fill(v.photoAlt, { n: viewing + 1, code: item.code })}
          />
        </Dialog>
      ) : null}
      {removing ? (
        <ConfirmDialog
          title={v.removePhotoTitle}
          description={v.removePhotoBody}
          facts={[{ label: v.codeFact, value: item.code }]}
          tone="danger"
          confirmLabel={v.removePhoto}
          busyLabel={text.working}
          cancelLabel={t.common.cancel}
          referenceLabel={t.errors.reference}
          reasonField={{
            label: v.removePhotoReason,
            required: true,
            requiredLabel: t.common.required,
            requiredMessage: t.common.form.reasonRequired,
          }}
          describeError={(error) => ({
            message: returnErrorText(error, locale, (cause) => errorMessage(cause, t)),
            reference: error instanceof ApiError ? error.requestId : null,
          })}
          onCancel={() => setRemoving(null)}
          onConfirm={async (reason) => {
            await api.post(`/api/v1/product-returns/cases/${item.id}/photos/${removing}/remove`, {
              note: reason ?? '',
            });
            setRemoving(null);
            setViewing(null);
            await reload();
            notify(v.removePhotoDone);
          }}
        />
      ) : null}
    </Section>
  );
}
