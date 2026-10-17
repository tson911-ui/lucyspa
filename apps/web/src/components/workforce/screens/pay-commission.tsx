'use client';

import {
  COMMISSION_KINDS,
  COMMISSION_SCOPES,
  type CommissionKindNameValue,
  type CommissionProductOption,
  type CommissionRuleItem,
  type CommissionRuleResponse,
  type CommissionRulesResponse,
  type CommissionScopeNameValue,
  type CommissionTargetsResponse,
} from '@lucy-spa/contracts';
import {
  Combobox,
  DataTable,
  DateTextInput,
  FacetedFilter,
  Field,
  FormDialog,
  FormGrid,
  ListToolbar,
  MoneyInput,
  Select,
  TextInput,
  Textarea,
  type DataTableColumn,
} from '@lucy-spa/ui';
import { useEffect, useState } from 'react';
import { payDictionary } from '../../../i18n/pay';
import { fill } from '../../../i18n/workforce';
import { formatDate, formatVnd } from '../../../lib/workforce/format';
import { formOverlayLabels } from '../../../lib/workforce/form-labels';
import { toolbarLabels } from '../../../lib/workforce/list-view';
import { useUrlPaging } from '../../../lib/workforce/use-url-paging';
import {
  commissionBody,
  commissionProblems,
  commissionScopeText,
  commissionValueText,
  startWindow,
  type CommissionDraft,
  type PayPageState,
} from '../../../lib/workforce/pay';
import { useWorkforce } from '../session';
import { Badge, Button, Empty, ErrorState, Notice, useResource } from '../ui';
import { usePayCommand } from './pay-command';

const STATE_TONE = { CURRENT: 'success', UPCOMING: 'info', REPLACED: 'neutral' } as const;

/**
 * The header action of the commission tab: "Thêm quy tắc" (the page's one primary action while this tab is open). The rules
 * themselves are listed by `PayCommission`; the dialog is opened by the screen so the action sits in the page header.
 */
export function PayCommission({
  state,
  update,
  adding,
  onAdded,
  onCloseAdd,
  bump,
  onLoaded,
}: {
  state: PayPageState;
  update: (patch: Partial<PayPageState>) => void;
  adding: boolean;
  onAdded: () => void;
  onCloseAdd: () => void;
  bump: number;
  /** Tells the page whether the signed-in person may add rules (decides if the header action shows). */
  onLoaded: (canManage: boolean) => void;
}) {
  const { api, t, locale } = useWorkforce();
  const p = payDictionary(locale);
  const c = p.commission;
  const data = useResource(
    () => api.get<CommissionRulesResponse>('/api/v1/pay/commission-rules'),
    [api, bump],
  );
  useEffect(() => {
    if (data.data) onLoaded(data.data.canManage);
  }, [data.data, onLoaded]);
  const money = (amount: string) => formatVnd(amount, locale);
  const all = data.data?.items ?? [];
  const rows = all.filter(
    (item) =>
      (state.scope === '' || item.scope === state.scope) &&
      (state.state === '' || item.state === state.state),
  );
  const filtered = (state.scope ? 1 : 0) + (state.state ? 1 : 0);
  const columns: DataTableColumn<CommissionRuleItem>[] = [
    {
      key: 'scope',
      header: c.columns.scope,
      mobileTitle: true,
      wrap: true,
      width: 'lg',
      // On a phone the "paid to" column is hidden, so a rule for one person names them here.
      cell: (item) =>
        item.employee ? (
          <>
            {commissionScopeText(item, locale)}
            <span className="ls-adminb-sub">{item.employee.name}</span>
          </>
        ) : (
          commissionScopeText(item, locale)
        ),
    },
    {
      key: 'who',
      header: c.columns.who,
      wrap: true,
      hidePhone: true,
      cell: (item) => item.employee?.name ?? c.everyone,
    },
    {
      key: 'value',
      header: c.columns.value,
      numeric: true,
      cell: (item) => commissionValueText(item, locale, money),
    },
    {
      key: 'from',
      header: c.columns.from,
      hideBelow: 'md',
      hidePhone: true,
      cell: (item) => formatDate(item.effectiveFrom, locale),
    },
    {
      key: 'state',
      header: c.columns.state,
      cell: (item) => <Badge tone={STATE_TONE[item.state]}>{p.states[item.state]}</Badge>,
    },
    {
      key: 'by',
      header: c.columns.by,
      hideBelow: 'xl',
      hidePhone: true,
      wrap: true,
      width: 'sm',
      cell: (item) => item.createdBy.name,
    },
  ];
  const paging1 = useUrlPaging('cmp', t, c.title);
  return (
    <>
      {/* The tab already names the list: no h2 repeating it (FR "a heading never repeats its control"). */}
      <div className="ls-list-section">
        <ListToolbar
          labels={toolbarLabels(t)}
          activeFilters={filtered}
          onReset={() => update({ scope: '', state: '' })}
          reload={{ label: t.common.reload, onClick: () => void data.reload() }}
          resultCount={data.data ? fill(t.common.list.results, { count: rows.length }) : undefined}
          filters={
            <>
              <FacetedFilter
                label={c.filterScope}
                clearLabel={t.common.list.clearChoice}
                options={COMMISSION_SCOPES.map((value) => ({ value, label: p.scopes[value] }))}
                selected={state.scope ? [state.scope] : []}
                onChange={([value]) => update({ scope: value ?? '' })}
              />
              <FacetedFilter
                label={c.filterState}
                clearLabel={t.common.list.clearChoice}
                options={(['CURRENT', 'UPCOMING', 'REPLACED'] as const).map((value) => ({
                  value,
                  label: p.states[value],
                }))}
                selected={state.state ? [state.state] : []}
                onChange={([value]) => update({ state: value ?? '' })}
              />
            </>
          }
        />
        <DataTable
          mode="client"
          caption={fill(t.common.list.table, { list: c.title })}
          columns={columns}
          rows={rows}
          rowKey={(item) => item.id}
          loading={data.loading && !data.data}
          loadingLabel={t.common.loading}
          error={
            data.error ? (
              <ErrorState error={data.error} t={t} onRetry={() => void data.reload()} />
            ) : undefined
          }
          empty={data.data ? <Empty>{filtered > 0 ? c.noneFiltered : c.none}</Empty> : undefined}
          paging={paging1}
        />
        <p className="ls-hint">{p.common.appendOnly}</p>
      </div>
      {adding && data.data ? (
        <CommissionDialog data={data.data} onDone={onAdded} onClose={onCloseAdd} />
      ) : null}
    </>
  );
}

function CommissionDialog({
  data,
  onDone,
  onClose,
}: {
  data: CommissionRulesResponse;
  onDone: () => void;
  onClose: () => void;
}) {
  const { api, t, locale } = useWorkforce();
  const p = payDictionary(locale);
  const c = p.commission;
  const window = startWindow(data.today, true);
  const [draft, setDraft] = useState<CommissionDraft>({
    scope: 'SHOP',
    targetId: '',
    employeeUserId: '',
    kind: 'PERCENT',
    percent: '',
    amount: null,
    from: data.today,
    reason: '',
  });
  const [checked, setChecked] = useState(false);
  const command = usePayCommand();
  const problems = commissionProblems(draft, data.today);
  // A value error names the rule the kind needs (a percentage or an amount).
  const invalid = (name: 'target' | 'value' | 'from' | 'reason') =>
    checked && problems.includes(name)
      ? p.common.fieldErrors[
          name === 'value' ? (draft.kind === 'PERCENT' ? 'percent' : 'amount') : name
        ]
      : undefined;

  // The product picker searches the catalog as the person types (at least two letters, twenty results).
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<CommissionProductOption[]>([]);
  const [chosen, setChosen] = useState<CommissionProductOption | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  useEffect(() => {
    if (draft.scope !== 'PRODUCT' || query.trim().length < 2) {
      setFound([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(() => {
      api
        .get<CommissionTargetsResponse>('/api/v1/pay/commission-rules/products', {
          q: query.trim(),
        })
        .then((result) => {
          if (!cancelled) {
            setFound(result.items);
            setSearchFailed(false);
          }
        })
        .catch(() => {
          // A failed search says so (not "no product"); the next keystroke tries again.
          if (!cancelled) {
            setFound([]);
            setSearchFailed(true);
          }
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [api, draft.scope, query]);

  const targetOptions: { value: string; label: string }[] =
    draft.scope === 'BRAND'
      ? data.brands.map((brand) => ({ value: brand.id, label: brand.name }))
      : draft.scope === 'CATEGORY'
        ? data.categories.map((category) => ({ value: category.id, label: category.name }))
        : [];
  const productOptions = [
    ...(chosen ? [chosen] : []),
    ...found.filter((item) => item.id !== chosen?.id),
  ].map((item) => ({ value: item.id, label: item.sku ? `${item.name} (${item.sku})` : item.name }));

  async function submit() {
    setChecked(true);
    const body = commissionBody(draft, data.today);
    if (!body) return;
    await command.run<CommissionRuleResponse>('/api/v1/pay/commission-rules', body, onDone);
  }

  const targetLabel = fill(c.target, {
    scope: (draft.scope === 'BRAND'
      ? c.targetBrand
      : draft.scope === 'CATEGORY'
        ? c.targetCategory
        : c.targetProduct
    ).toLocaleLowerCase(locale),
  });
  return (
    <FormDialog
      title={c.addTitle}
      description={c.addDescription}
      labels={{ ...formOverlayLabels(t, c.submit), submitting: c.submitting }}
      busy={command.pending}
      dirty={
        draft.percent !== '' ||
        draft.amount !== null ||
        draft.reason !== '' ||
        draft.targetId !== ''
      }
      error={command.error ? <Notice tone="error">{command.error}</Notice> : undefined}
      onClose={onClose}
      onSubmit={submit}
    >
      <FormGrid>
        <Field label={c.scope} required full>
          {(control) => (
            <Select
              {...control}
              value={draft.scope}
              options={COMMISSION_SCOPES.map((value) => ({ value, label: p.scopes[value] }))}
              onChange={(event) => {
                setDraft({
                  ...draft,
                  scope: event.target.value as CommissionScopeNameValue,
                  targetId: '',
                });
                setChosen(null);
                setQuery('');
              }}
            />
          )}
        </Field>
        {draft.scope === 'BRAND' || draft.scope === 'CATEGORY' ? (
          <Field label={targetLabel} error={invalid('target')} required full>
            {(control) => (
              <Select
                {...control}
                value={draft.targetId}
                placeholder={p.common.choose}
                options={targetOptions}
                onChange={(event) => setDraft({ ...draft, targetId: event.target.value })}
              />
            )}
          </Field>
        ) : null}
        {draft.scope === 'PRODUCT' ? (
          <Field label={targetLabel} error={invalid('target')} required full>
            {(control) => (
              <Combobox
                {...control}
                options={productOptions}
                value={draft.targetId === '' ? null : draft.targetId}
                onValueChange={(value) => {
                  setChosen(found.find((item) => item.id === value) ?? chosen);
                  setDraft({ ...draft, targetId: value ?? '' });
                }}
                onQueryChange={setQuery}
                loading={searching}
                loadingLabel={t.common.loading}
                emptyLabel={
                  query.trim().length < 2
                    ? c.productSearch
                    : searchFailed
                      ? c.productSearchFailed
                      : c.productNone
                }
                placeholder={c.productSearch}
              />
            )}
          </Field>
        ) : null}
        <Field label={c.employee} hint={c.employeeHint} full>
          {(control) => (
            <Select
              {...control}
              value={draft.employeeUserId}
              placeholder={c.everyone}
              options={[
                { value: '', label: c.everyone },
                ...data.employees.map((person) => ({ value: person.id, label: person.name })),
              ]}
              onChange={(event) => setDraft({ ...draft, employeeUserId: event.target.value })}
            />
          )}
        </Field>
        <Field label={c.kind} required full>
          {(control) => (
            <Select
              {...control}
              value={draft.kind}
              options={COMMISSION_KINDS.map((value) => ({ value, label: p.kinds[value] }))}
              onChange={(event) =>
                setDraft({ ...draft, kind: event.target.value as CommissionKindNameValue })
              }
            />
          )}
        </Field>
        {draft.kind === 'PERCENT' ? (
          <Field
            label={c.valuePercent}
            hint={c.valuePercentHint}
            error={invalid('value')}
            required
            full
          >
            {(control) => (
              <TextInput
                {...control}
                name="percent"
                inputMode="decimal"
                autoComplete="off"
                maxLength={6}
                value={draft.percent}
                onChange={(event) => setDraft({ ...draft, percent: event.target.value })}
              />
            )}
          </Field>
        ) : (
          <Field label={c.valueFixed} error={invalid('value')} required full>
            {(control) => (
              <MoneyInput
                {...control}
                name="amount"
                unit="₫"
                locale={locale}
                value={draft.amount}
                onValueChange={(amount) => setDraft({ ...draft, amount })}
              />
            )}
          </Field>
        )}
        <Field label={p.common.from} hint={p.common.fromHint} error={invalid('from')} required full>
          {(control) => (
            <DateTextInput
              {...control}
              name="from"
              min={window.min}
              max={window.max}
              value={draft.from}
              onChange={(event) => setDraft({ ...draft, from: event.target.value })}
            />
          )}
        </Field>
        <Field label={p.common.reason} hint={p.common.reasonHint} error={invalid('reason')} full>
          {(control) => (
            <Textarea
              {...control}
              name="reason"
              autoComplete="off"
              rows={3}
              maxLength={500}
              value={draft.reason}
              onChange={(event) => setDraft({ ...draft, reason: event.target.value })}
            />
          )}
        </Field>
      </FormGrid>
    </FormDialog>
  );
}

/** The page-header button that opens the new-rule dialog. */
export function AddRuleButton({ onClick }: { onClick: () => void }) {
  const { locale } = useWorkforce();
  return (
    <Button variant="primary" icon="plus" onClick={onClick}>
      {payDictionary(locale).commission.add}
    </Button>
  );
}
