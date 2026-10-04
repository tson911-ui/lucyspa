'use client';

import type {
  DiscountDetailResponse,
  DiscountVersionResponse,
  VoucherResponse,
} from '@lucy-spa/contracts';
import {
  Breadcrumbs,
  ConfirmDialog,
  Cluster,
  DataTable,
  DescriptionList,
  Field,
  FormDialog,
  FormGrid,
  ListSection,
  RowActions,
  Tabs,
  TextInput,
  type DataTableColumn,
  type MenuItem,
} from '@lucy-spa/ui';
import { PrefetchLink as Link } from '../link';
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
import { paginationLabels } from '../../../lib/workforce/list-view';
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
  useSuccessToast,
} from '../ui';

type TabId = 'current' | 'versions' | 'vouchers';
type Overlay = 'terminate' | 'voucher';

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

  useEffect(() => {
    let active = true;
    api
      .get<DiscountDetailResponse>(`/api/v1/discounts/${id}`)
      .then((data) => active && setProgram(data))
      .catch((error: unknown) => active && setLoadError(error));
    return () => {
      active = false;
    };
  }, [api, id]);

  if (loadError && !program) return <ErrorState error={loadError} t={t} />;
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
  const { api, t, locale, base, navigate } = useWorkforce();
  const notify = useSuccessToast();
  const text = organizationDictionary(locale);
  const d = t.discounts;
  const [tab, setTab] = useState<TabId>('current');
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
        {
          id: 'terminate',
          label: d.terminate,
          tone: 'danger',
          onSelect: () => setOverlay('terminate'),
        },
      ]
    : [];

  return (
    <>
      <PageHeader
        title={title}
        intro={`${program.code} · ${program.requiresCode ? d.codeProgram : d.autoProgram}`}
        breadcrumbs={
          <Breadcrumbs
            label={text.breadcrumbs}
            LinkComponent={Link}
            items={[{ label: d.title, href: `${base}/discounts` }, { label: title }]}
          />
        }
      >
        {menu.length > 0 ? <RowActions menuLabel={text.moreActions} items={menu} /> : null}
        {manage ? (
          <Button
            variant="primary"
            icon="plus"
            onClick={() => navigate?.(`${base}/discounts/${program.id}/versions/new`)}
          >
            {d.newVersion}
          </Button>
        ) : null}
      </PageHeader>
      <Cluster gap="inline">
        <span className="ls-hint">{t.common.status}:</span>
        <Badge tone={statusTone(program.status)}>{d.statuses[program.status]}</Badge>
      </Cluster>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {terminated ? (
        <Notice tone="info">
          {fill(d.terminatedInfo, { reason: program.terminatedReason ?? '—' })}
        </Notice>
      ) : null}
      <Tabs
        label={d.tabsLabel}
        value={tab}
        onChange={(id) => setTab(id as TabId)}
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
          facts={[{ label: d.code, value: `${program.code} · ${title}` }]}
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

function CurrentVersion({ program }: { program: DiscountDetailResponse }) {
  const { t, locale } = useWorkforce();
  const d = t.discounts;
  const current = program.current;
  const limits = [
    current.usageLimitTotal === null ? null : fill(d.totalShort, { n: current.usageLimitTotal }),
    current.usageLimitPerCustomer === null
      ? null
      : fill(d.perCustomerShort, { n: current.usageLimitPerCustomer }),
  ].filter((entry): entry is string => entry !== null);
  return (
    <Section title={fill(d.current, { n: current.versionNo })}>
      <DescriptionList
        columns={2}
        items={[
          { label: d.colBenefit, value: benefitLabel(current, locale) },
          {
            label: d.colWindow,
            value: `${formatVnInstant(current.validFrom, locale)} → ${formatVnInstant(current.validUntil, locale)}`,
          },
          { label: d.minSpend, value: formatVnd(current.minSpendVnd, locale) },
          {
            label: d.scope,
            value:
              d.scopes[current.scopeMode] +
              (current.scopeMode === 'SELECTED'
                ? ` (${current.serviceIds.length} ${d.services.toLowerCase()}, ${current.categoryIds.length} ${d.categories.toLowerCase()})`
                : ''),
          },
          { label: d.limits, value: limits.length > 0 ? limits.join(' · ') : d.unlimited },
          { label: d.colUsed, value: program.redemptions },
        ]}
      />
    </Section>
  );
}

/** The immutable history, newest first as the API sends it. */
function Versions({ program }: { program: DiscountDetailResponse }) {
  const { t, locale } = useWorkforce();
  const d = t.discounts;
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
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
      cell: (version) =>
        `${formatVnInstant(version.validFrom, locale)} → ${formatVnInstant(version.validUntil, locale)}`,
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
    <ListSection title={d.history} count={program.versions.length}>
      <DataTable
        mode="client"
        caption={fill(t.common.list.table, { list: d.history })}
        columns={columns}
        rows={program.versions}
        rowKey={(version) => version.id}
        paging={{
          page,
          pageSize,
          onPageChange: setPage,
          onPageSizeChange: (size) => {
            setPageSize(size);
            setPage(1);
          },
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
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const columns: DataTableColumn<VoucherResponse>[] = [
    {
      key: 'code',
      header: d.vouchersTitle,
      mobileTitle: true,
      cell: (voucher) => <code>{voucher.code}</code>,
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
      count={program.vouchers.length}
      actions={
        editable ? (
          <Button variant="secondary" icon="plus" onClick={onAdd}>
            {d.addVoucher}
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
        empty={<Empty>{d.noVouchers}</Empty>}
        paging={{
          page,
          pageSize,
          onPageChange: setPage,
          onPageSizeChange: (size) => {
            setPageSize(size);
            setPage(1);
          },
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
              maxLength={64}
              autoComplete="off"
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
            />
          )}
        </Field>
      </FormGrid>
    </FormDialog>
  );
}
