'use client';

import type {
  DiscountDetailResponse,
  DiscountVersionResponse,
  ServiceCategoryListResponse,
  ServiceListResponse,
  VoucherResponse,
} from '@lucy-spa/contracts';
import {
  Breadcrumbs,
  ButtonLink,
  ConfirmDialog,
  Cluster,
  DataTable,
  DescriptionList,
  EmptyState,
  Field,
  FormDialog,
  FormGrid,
  ListSection,
  PageHeader as UiPageHeader,
  RowActions,
  Tabs,
  TextInput,
  useUrlState,
  type DataTableColumn,
  type MenuItem,
} from '@lucy-spa/ui';
import { ListCrumbLink } from '../link';
import { useEffect, useRef, useState } from 'react';
import { organizationDictionary } from '../../../i18n/organization';
import { fill } from '../../../i18n/workforce';
import { ApiError } from '../../../lib/workforce/api';
import {
  benefitLabel,
  discountErrorMessage,
  formatVnInstant,
  statusTone,
} from '../../../lib/workforce/discounts';
import { discountName } from '../../../lib/workforce/discounts-list';
import { formatVnd } from '../../../lib/workforce/format';
import { formOverlayLabels } from '../../../lib/workforce/form-labels';
import {
  normalizePage,
  normalizePageSize,
  paginationLabels,
} from '../../../lib/workforce/list-view';
import { opensInput } from '../../../lib/workforce/opens-input';
import { useWorkforce } from '../session';
import {
  Badge,
  Button,
  ErrorState,
  Loading,
  Notice,
  Section,
  useResource,
  useSuccessToast,
} from '../ui';
import { orderedCategories, useProductCatalog } from './discount-targets';
import { AdminButtonLink } from './admin-button-link';

type TabId = 'current' | 'versions' | 'vouchers';
type Overlay = 'terminate' | 'voucher';
const TAB_IDS: readonly TabId[] = ['current', 'versions', 'vouchers'];
const TAB_DEFAULTS = { tab: 'current' };
const normalizeTab = (state: typeof TAB_DEFAULTS) => ({
  tab: (TAB_IDS as readonly string[]).includes(state.tab) ? state.tab : 'current',
});
const TAB_OPTIONS = { normalize: normalizeTab };
// The pagers of the two lists live in the address bar too (distinct keys; a new page size goes back to page 1).
const VERSIONS_DEFAULTS = { vpage: 1, vsize: 20 };
const VERSIONS_OPTIONS = {
  normalize: (state: typeof VERSIONS_DEFAULTS) => ({
    vpage: normalizePage(state.vpage),
    vsize: normalizePageSize(state.vsize),
  }),
  resetOnChange: ['vpage'],
};
const VOUCHERS_DEFAULTS = { cpage: 1, csize: 20 };
const VOUCHERS_OPTIONS = {
  normalize: (state: typeof VOUCHERS_DEFAULTS) => ({
    cpage: normalizePage(state.cpage),
    csize: normalizePageSize(state.csize),
  }),
  resetOnChange: ['cpage'],
};
/** '1 use' / '2 uses' (English plural; Vietnamese has one form). */
const plurals = new Map<string, Intl.PluralRules>();
function pluralOf(locale: string, n: number): string {
  let rules = plurals.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(locale);
    plurals.set(locale, rules);
  }
  return rules.select(n);
}

/**
 * One discount program (Phase 4 Step 6): what is in force now, its immutable version history, pause/resume,
 * permanent early termination and its voucher codes. Every command carries the program `version`; the
 * server's answer replaces the page and a failure reloads it. A new version is a drawer, ending the
 * program a confirmation with a required reason, a new code a dialog.
 */
export function DiscountDetailScreen({ id }: { id: string }) {
  const { api, t } = useWorkforce();
  const [program, setProgram] = useState<DiscountDetailResponse | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    api
      .get<DiscountDetailResponse>(`/api/v1/discounts/${id}`)
      .then((data) => active && setProgram(data))
      .catch((error: unknown) => active && setLoadError(error));
    return () => {
      active = false;
    };
  }, [api, id, attempt]);

  if (loadError && !program) {
    return (
      <ErrorState
        error={loadError}
        t={t}
        onRetry={() => {
          setLoadError(null);
          setAttempt((count) => count + 1);
        }}
      />
    );
  }
  if (!program) return <Loading t={t} page />;
  return <DiscountDetail program={program} onChange={setProgram} />;
}

function DiscountDetail({
  program,
  onChange,
}: {
  program: DiscountDetailResponse;
  onChange: (program: DiscountDetailResponse) => void;
}) {
  const { api, t, locale, base } = useWorkforce();
  const notify = useSuccessToast();
  const text = organizationDictionary(locale);
  const d = t.discounts;
  // The open tab lives in the address bar (reload, back and a shared link keep it).
  const [view, updateView] = useUrlState(TAB_DEFAULTS, TAB_OPTIONS);
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const busy = useRef(false);

  const terminated = program.status === 'TERMINATED';
  const manage = program.permissions.manage && !terminated;
  const vouchers = program.permissions.createVouchers && program.requiresCode && !terminated;
  const title = discountName(program, locale);

  /**
   * One command at a time. The answer replaces the page; a failure reloads it (a version conflict shows the
   * newer state) and is thrown again so the dialog that sent it can explain.
   */
  async function run(work: () => Promise<DiscountDetailResponse>): Promise<void> {
    if (busy.current) return;
    busy.current = true;
    setWorking(true);
    try {
      onChange(await work());
    } catch (failure) {
      try {
        onChange(await api.get<DiscountDetailResponse>(`/api/v1/discounts/${program.id}`));
      } catch {
        // The failure below is already shown.
      }
      throw failure;
    } finally {
      busy.current = false;
      setWorking(false);
    }
  }

  /** A command without a dialog (pause, resume, voucher switch): success is a toast, a failure a notice. */
  async function quick(work: () => Promise<DiscountDetailResponse>, success: string) {
    setError(null);
    try {
      await run(work);
      notify(success);
    } catch (failure) {
      setError(discountErrorMessage(failure, t));
    }
  }

  const finish = (message: string) => {
    setOverlay(null);
    notify(message);
  };

  const menu: MenuItem[] = manage
    ? [
        {
          id: 'active',
          label: program.isActive ? d.pause : d.resume,
          disabled: working,
          onSelect: () =>
            void quick(
              () =>
                api.post<DiscountDetailResponse>(`/api/v1/discounts/${program.id}/active`, {
                  expectedVersion: program.version,
                  isActive: !program.isActive,
                }),
              program.isActive ? d.paused : d.resumed,
            ),
        },
        ...(program.requiresCode
          ? []
          : [
              {
                id: 'bot',
                label: program.botVisible ? d.botStop : d.botAllow,
                disabled: working,
                onSelect: () =>
                  void quick(
                    () =>
                      api.post<DiscountDetailResponse>(
                        `/api/v1/discounts/${program.id}/bot-visible`,
                        { expectedVersion: program.version, botVisible: !program.botVisible },
                      ),
                    program.botVisible ? d.botStopped : d.botAllowed,
                  ),
              },
            ]),
        {
          id: 'terminate',
          label: opensInput(d.terminate),
          tone: 'danger',
          onSelect: () => setOverlay('terminate'),
        },
      ]
    : [];

  return (
    <>
      {/* Subtitle = the program code only (no "code · kind" meta string); the status, the kind and the bot flag are badges
          in the kit header's status slot, under the title and never inside the heading. */}
      <UiPageHeader
        title={title}
        description={program.code}
        status={
          <Cluster gap="inline">
            <Badge tone={statusTone(program.status)}>{d.statuses[program.status]}</Badge>
            <Badge tone="neutral">{program.requiresCode ? d.codeProgram : d.autoProgram}</Badge>
            {program.botVisible ? <Badge tone="info">{d.botBadge}</Badge> : null}
          </Cluster>
        }
        breadcrumbs={
          <Breadcrumbs
            label={text.breadcrumbs}
            LinkComponent={ListCrumbLink}
            items={[{ label: d.title, href: `${base}/discounts` }, { label: title }]}
          />
        }
        actions={
          menu.length > 0 || manage ? (
            <>
              {menu.length > 0 ? <RowActions menuLabel={text.moreActions} items={menu} /> : null}
              {/* A new version opens its own page: a real link styled as the one primary. */}
              {manage ? (
                <ButtonLink
                  LinkComponent={AdminButtonLink}
                  variant="primary"
                  icon="plus"
                  href={`${base}/discounts/${program.id}/versions/new`}
                >
                  {d.newVersion}
                </ButtonLink>
              ) : null}
            </>
          ) : undefined
        }
      />
      {error ? <Notice tone="error">{error}</Notice> : null}
      {terminated ? (
        <Notice tone="info">
          {fill(d.terminatedInfo, { reason: program.terminatedReason ?? '—' })}
        </Notice>
      ) : null}
      <Tabs
        label={d.tabsLabel}
        value={view.tab}
        onChange={(id) => updateView({ tab: id })}
        tabs={[
          {
            id: 'current',
            label: d.tabCurrent,
            panel: <CurrentVersion program={program} />,
          },
          {
            id: 'versions',
            label: d.tabVersions,
            panel: <Versions program={program} />,
          },
          ...(program.requiresCode
            ? [
                {
                  id: 'vouchers',
                  label: d.vouchersTitle,
                  panel: (
                    <Vouchers
                      program={program}
                      editable={vouchers}
                      busy={working}
                      onAdd={() => setOverlay('voucher')}
                      onSwitch={(voucher) =>
                        void quick(
                          () =>
                            api.post<DiscountDetailResponse>(
                              `/api/v1/discounts/${program.id}/vouchers/${voucher.id}/active`,
                              { expectedVersion: voucher.version, isActive: !voucher.isActive },
                            ),
                          d.voucherSaved,
                        )
                      }
                    />
                  ),
                },
              ]
            : []),
        ]}
      />
      {overlay === 'terminate' && manage ? (
        <ConfirmDialog
          title={d.terminateTitle}
          description={d.terminateBody}
          facts={[
            { label: d.colProgram, value: title },
            { label: d.code, value: program.code },
          ]}
          tone="danger"
          confirmLabel={d.terminateConfirm}
          busyLabel={d.saving}
          cancelLabel={t.common.cancel}
          referenceLabel={t.errors.reference}
          reasonField={{
            label: d.terminateReason,
            required: true,
            requiredLabel: t.common.required,
            requiredMessage: t.common.form.reasonRequired,
            hint: d.terminateHint,
          }}
          describeError={(failure) => ({
            message: discountErrorMessage(failure, t),
            reference: failure instanceof ApiError ? failure.requestId : null,
          })}
          onCancel={() => setOverlay(null)}
          onConfirm={async (reason) => {
            await run(() =>
              api.post<DiscountDetailResponse>(`/api/v1/discounts/${program.id}/terminate`, {
                expectedVersion: program.version,
                reason: (reason ?? '').normalize('NFC').trim(),
              }),
            );
            finish(d.terminated);
          }}
        />
      ) : null}
      {overlay === 'voucher' && vouchers ? (
        <VoucherDialog
          program={program}
          run={run}
          onClose={() => setOverlay(null)}
          onDone={() => finish(d.voucherAdded)}
        />
      ) : null}
    </>
  );
}

/**
 * The targets of the version in force, by name (the lists are read only for the kinds of target the version has). A list that cannot
 * be read (no permission, or a failure) falls back to the number of items, never to an id.
 */
function useTargetNames(current: DiscountVersionResponse) {
  const { api, locale } = useWorkforce();
  const name = (entry: { nameVi: string; nameEn: string }) =>
    locale === 'vi' ? entry.nameVi : entry.nameEn;
  const brandIds = current.brandIds ?? [];
  const productCategoryIds = current.productCategoryIds ?? [];
  const productIds = current.productIds ?? [];
  const wantServices = current.serviceIds.length + current.categoryIds.length > 0;
  const wantProducts = brandIds.length + productCategoryIds.length + productIds.length > 0;
  const services = useResource(
    () => (wantServices ? api.get<ServiceListResponse>('/api/v1/services') : Promise.resolve(null)),
    [api, wantServices],
  );
  const serviceCategories = useResource(
    () =>
      wantServices
        ? api.get<ServiceCategoryListResponse>('/api/v1/service-categories')
        : Promise.resolve(null),
    [api, wantServices],
  );
  const catalog = useProductCatalog(wantProducts);
  const pick = (
    ids: readonly string[],
    list: readonly { id: string; label: string }[] | null,
  ): string[] | null => {
    if (!list) return null;
    const labels = new Map(list.map((entry) => [entry.id, entry.label]));
    const found = ids.map((id) => labels.get(id));
    return found.every((label): label is string => label !== undefined) ? found : null;
  };
  return {
    loading: services.loading || serviceCategories.loading || catalog.loading,
    services: pick(
      current.serviceIds,
      services.data?.services.map((service) => ({ id: service.id, label: name(service) })) ?? null,
    ),
    categories: pick(
      current.categoryIds,
      serviceCategories.data?.categories.map((category) => ({
        id: category.id,
        label: name(category),
      })) ?? null,
    ),
    brands: pick(
      brandIds,
      catalog.ready ? catalog.brands.map((brand) => ({ id: brand.id, label: name(brand) })) : null,
    ),
    productCategories: pick(
      productCategoryIds,
      catalog.ready ? orderedCategories(catalog.categories, name) : null,
    ),
    products: pick(
      productIds,
      catalog.ready
        ? catalog.products.map((product) => ({ id: product.id, label: name(product) }))
        : null,
    ),
  };
}

function CurrentVersion({ program }: { program: DiscountDetailResponse }) {
  const { t, locale } = useWorkforce();
  const d = t.discounts;
  const current = program.current;
  const scope = current.scope ?? 'SERVICES';
  const names = useTargetNames(current);
  const targets: { label: string; ids: readonly string[]; names: string[] | null }[] = [
    { label: d.categories, ids: current.categoryIds, names: names.categories },
    { label: d.services, ids: current.serviceIds, names: names.services },
    { label: d.brands, ids: current.brandIds ?? [], names: names.brands },
    {
      label: d.productCategories,
      ids: current.productCategoryIds ?? [],
      names: names.productCategories,
    },
    { label: d.products, ids: current.productIds ?? [], names: names.products },
  ];
  const limits = [
    current.usageLimitTotal === null ? null : fill(d.totalShort, { n: current.usageLimitTotal }),
    current.usageLimitPerCustomer === null
      ? null
      : fill(d.perCustomerShort, { n: current.usageLimitPerCustomer }),
  ].filter((entry): entry is string => entry !== null);
  return (
    // The card title is text only; the version number is a fact. The validity is two facts (from, until): no "→" glyph.
    <Section title={d.currentTitle}>
      <DescriptionList
        columns={2}
        items={[
          { label: d.colVersion, value: fill(d.versionN, { n: current.versionNo }) },
          { label: d.colBenefit, value: benefitLabel(current, locale) },
          { label: d.validFrom, value: formatVnInstant(current.validFrom, locale) },
          { label: d.validUntil, value: formatVnInstant(current.validUntil, locale) },
          { label: d.minSpend, value: formatVnd(current.minSpendVnd, locale) },
          { label: d.scope, value: d.scopeKinds[scope] },
          {
            label: d.selection,
            value: current.scopeMode === 'SELECTED' ? d.selectedOnly : d.allOf[scope],
          },
          ...targets
            .filter((target) => target.ids.length > 0)
            .map((target) => ({
              label: target.label,
              value: names.loading
                ? '…'
                : target.names
                  ? target.names.join(', ')
                  : fill(d.targetsCount, { n: target.ids.length }),
            })),
          { label: d.limits, value: limits.length > 0 ? limits.join(', ') : d.unlimited },
          {
            label: d.colUsed,
            value: fill(
              pluralOf(locale, program.redemptions) === 'one' ? d.usedTimeOne : d.usedTimes,
              {
                n: program.redemptions,
              },
            ),
          },
        ]}
      />
    </Section>
  );
}

/** The immutable history, newest first as the API sends it. */
function Versions({ program }: { program: DiscountDetailResponse }) {
  const { t, locale } = useWorkforce();
  const d = t.discounts;
  const [{ vpage: page, vsize: pageSize }, update] = useUrlState(
    VERSIONS_DEFAULTS,
    VERSIONS_OPTIONS,
  );
  const columns: DataTableColumn<DiscountVersionResponse>[] = [
    {
      key: 'version',
      header: d.colVersion,
      mobileTitle: true,
      numeric: true,
      cell: (version) => fill(d.versionN, { n: version.versionNo }),
    },
    { key: 'benefit', header: d.colBenefit, numeric: true, cell: (v) => benefitLabel(v, locale) },
    {
      key: 'window',
      header: d.colWindow,
      // Start, then "đến <end>" on a second line: no "→" glyph and a range never breaks inside a date.
      cell: (version) => (
        <span className="ls-cell-stack ls-cat-window">
          <span className="ls-cell-main">{formatVnInstant(version.validFrom, locale)}</span>
          <span className="ls-cell-sub">
            {fill(d.untilShort, { date: formatVnInstant(version.validUntil, locale) })}
          </span>
        </span>
      ),
    },
    {
      key: 'minSpend',
      header: d.minSpend,
      numeric: true,
      hideBelow: 'md',
      cell: (version) => formatVnd(version.minSpendVnd, locale),
    },
  ];
  return (
    <ListSection title={d.history}>
      <DataTable
        mode="client"
        caption={fill(t.common.list.table, { list: d.history })}
        columns={columns}
        rows={program.versions}
        rowKey={(version) => version.id}
        paging={{
          page,
          pageSize,
          onPageChange: (vpage) => update({ vpage }),
          onPageSizeChange: (vsize) => update({ vsize }),
          labels: paginationLabels(t, d.history),
        }}
      />
    </ListSection>
  );
}

/** Voucher codes of a code program: new codes from the section action, a `⋮` switch per code. */
function Vouchers({
  program,
  editable,
  busy,
  onAdd,
  onSwitch,
}: {
  program: DiscountDetailResponse;
  editable: boolean;
  busy: boolean;
  onAdd: () => void;
  onSwitch: (voucher: VoucherResponse) => void;
}) {
  const { t } = useWorkforce();
  const d = t.discounts;
  const [{ cpage: page, csize: pageSize }, update] = useUrlState(
    VOUCHERS_DEFAULTS,
    VOUCHERS_OPTIONS,
  );
  const columns: DataTableColumn<VoucherResponse>[] = [
    {
      key: 'code',
      header: d.vouchersTitle,
      mobileTitle: true,
      cell: (voucher) => <code translate="no">{voucher.code}</code>,
    },
    {
      key: 'status',
      header: d.colStatus,
      cell: (voucher) => (
        <Badge tone={voucher.isActive ? 'success' : 'neutral'}>
          {voucher.isActive ? d.voucherOn : d.voucherOff}
        </Badge>
      ),
    },
    { key: 'used', header: d.colUsed, numeric: true, cell: (voucher) => voucher.redemptions },
    ...(editable
      ? [
          {
            key: 'actions',
            header: t.common.actions,
            actions: true,
            cell: (voucher: VoucherResponse) => (
              <RowActions
                menuLabel={fill(t.common.list.actionsFor, { name: voucher.code })}
                items={[
                  {
                    id: 'switch',
                    label: voucher.isActive ? d.deactivate : d.activate,
                    disabled: busy,
                    onSelect: () => onSwitch(voucher),
                  },
                ]}
              />
            ),
          },
        ]
      : []),
  ];
  return (
    <ListSection
      title={d.vouchersTitle}
      actions={
        editable ? (
          <Button variant="secondary" icon="plus" onClick={onAdd}>
            {opensInput(d.addVoucher)}
          </Button>
        ) : undefined
      }
    >
      <DataTable
        mode="client"
        caption={fill(t.common.list.table, { list: d.vouchersTitle })}
        columns={columns}
        rows={program.vouchers}
        rowKey={(voucher) => voucher.id}
        empty={
          <EmptyState icon={false} title={d.noVouchersTitle}>
            {d.noVouchers}
          </EmptyState>
        }
        paging={{
          page,
          pageSize,
          onPageChange: (cpage) => update({ cpage }),
          onPageSizeChange: (csize) => update({ csize }),
          labels: paginationLabels(t, d.vouchersTitle),
        }}
      />
    </ListSection>
  );
}

type Run = (work: () => Promise<DiscountDetailResponse>) => Promise<void>;

/** One optional field: the code, or empty for a random one. */
function VoucherDialog({
  program,
  run,
  onClose,
  onDone,
}: {
  program: DiscountDetailResponse;
  run: Run;
  onClose: () => void;
  onDone: () => void;
}) {
  const { api, t } = useWorkforce();
  const d = t.discounts;
  const [code, setCode] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function save() {
    const trimmed = code.trim();
    setPending(true);
    setMessage(null);
    try {
      await run(() =>
        api.post<DiscountDetailResponse>(
          `/api/v1/discounts/${program.id}/vouchers`,
          trimmed ? { code: trimmed } : {},
        ),
      );
      onDone();
    } catch (failure) {
      setMessage(discountErrorMessage(failure, t));
    } finally {
      setPending(false);
    }
  }

  return (
    <FormDialog
      title={d.addVoucher}
      labels={formOverlayLabels(t, d.addVoucher)}
      busy={pending}
      dirty={code !== ''}
      error={message ? <Notice tone="error">{message}</Notice> : undefined}
      onClose={onClose}
      onSubmit={save}
    >
      <FormGrid>
        <Field label={d.voucherCodeLabel}>
          {(control) => (
            <TextInput
              {...control}
              name="voucher-code"
              maxLength={64}
              autoComplete="off"
              spellCheck={false}
              autoCapitalize="characters"
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
            />
          )}
        </Field>
      </FormGrid>
    </FormDialog>
  );
}
