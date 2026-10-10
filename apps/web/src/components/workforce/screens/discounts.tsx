'use client';

import type { DiscountListResponse, DiscountSummaryResponse } from '@lucy-spa/contracts';
import {
  DataTable,
  FacetedFilter,
  ListToolbar,
  RowActions,
  SearchInput,
  useUrlState,
  type DataTableColumn,
} from '@lucy-spa/ui';
import { PrefetchLink as Link } from '../link';
import { fill } from '../../../i18n/workforce';
import { benefitLabel, formatVnInstant, statusTone } from '../../../lib/workforce/discounts';
import {
  DISCOUNT_LIST_DEFAULTS,
  DISCOUNT_PAGE_KEYS,
  DISCOUNT_STATUSES,
  discountName,
  discountSortValue,
  filterDiscounts,
  normalizeDiscountList,
} from '../../../lib/workforce/discounts-list';
import {
  paginationLabels,
  resultsText,
  sortLabels,
  toolbarLabels,
} from '../../../lib/workforce/list-view';
import { canGlobal } from '../../../lib/workforce/permissions';
import { useAccount, useWorkforce } from '../session';
import { Badge, Button, Empty, ErrorState, PageHeader, useResource } from '../ui';

/**
 * "Ưu đãi" (Phase 4 Step 6): the Owner's discount programs. Programs are never deleted; "editing" appends an
 * immutable version and early termination is permanent. The POS never types a percentage or an amount.
 * The API returns every program, so search, the status filter, sorting and paging run in the browser
 * (`DataTable` client mode) with their state in the address bar; creating opens its own page.
 */
export function DiscountsScreen() {
  const { api, t, locale, base, navigate } = useWorkforce();
  const { account } = useAccount();
  const d = t.discounts;
  const allowed = canGlobal(account, 'MANAGE_DISCOUNTS') || canGlobal(account, 'CREATE_VOUCHERS');
  const programs = useResource(
    () => (allowed ? api.get<DiscountListResponse>('/api/v1/discounts') : Promise.resolve(null)),
    [api, allowed],
  );
  const [list, updateList] = useUrlState(DISCOUNT_LIST_DEFAULTS, {
    normalize: normalizeDiscountList,
    resetOnChange: DISCOUNT_PAGE_KEYS,
  });

  if (!allowed) {
    return (
      <>
        <PageHeader title={d.title} intro={d.intro} />
        <Empty>{d.noAccess}</Empty>
      </>
    );
  }

  const all = programs.data?.discounts ?? [];
  const rows = filterDiscounts(all, list);
  const canManage = programs.data?.permissions.manage ?? false;
  const active = (list.q ? 1 : 0) + (list.status ? 1 : 0);
  const open = (program: DiscountSummaryResponse) => navigate?.(`${base}/discounts/${program.id}`);

  const columns: DataTableColumn<DiscountSummaryResponse>[] = [
    { key: 'code', header: d.code, cell: (program) => program.code },
    {
      key: 'name',
      header: d.colProgram,
      mobileTitle: true,
      truncate: true,
      width: 'md',
      sortable: true,
      sortValue: (program) => discountSortValue(program, 'name', locale),
      cell: (program) => (
        <Link
          className="ls-link"
          href={`${base}/discounts/${program.id}`}
          title={discountName(program, locale)}
        >
          {discountName(program, locale)}
        </Link>
      ),
    },
    {
      key: 'kind',
      header: d.kind,
      hideBelow: 'lg',
      cell: (program) =>
        program.requiresCode
          ? `${d.codeProgram} · ${fill(d.codeCount, { n: program.voucherCount })}`
          : d.autoProgram,
    },
    {
      key: 'scope',
      header: d.colScope,
      // Lowest priority: on a 1440 px screen the validity column would be cut off (the detail page shows the scope).
      hideBelow: '2xl',
      cell: (program) => d.scopeKinds[program.current.scope ?? 'SERVICES'],
    },
    {
      key: 'benefit',
      header: d.colBenefit,
      numeric: true,
      cell: (program) => benefitLabel(program.current, locale),
    },
    {
      key: 'window',
      header: d.colWindow,
      hideBelow: 'wide',
      sortable: true,
      sortValue: (program) => discountSortValue(program, 'window', locale),
      cell: (program) =>
        `${formatVnInstant(program.current.validFrom, locale)} → ${formatVnInstant(program.current.validUntil, locale)}`,
    },
    {
      key: 'status',
      header: d.colStatus,
      sortable: true,
      sortValue: (program) => discountSortValue(program, 'status', locale),
      cell: (program) => (
        <Badge tone={statusTone(program.status)}>{d.statuses[program.status]}</Badge>
      ),
    },
    {
      key: 'used',
      header: d.colUsed,
      numeric: true,
      sortable: true,
      sortValue: (program) => discountSortValue(program, 'used', locale),
      cell: (program) => program.redemptions,
    },
    {
      key: 'actions',
      header: t.common.actions,
      actions: true,
      cell: (program) => (
        <RowActions
          menuLabel={fill(t.common.list.actionsFor, { name: discountName(program, locale) })}
          items={[
            { id: 'details', label: t.common.details, icon: 'eye', onSelect: () => open(program) },
          ]}
        />
      ),
    },
  ];

  return (
    <>
      <PageHeader title={d.title} intro={d.intro}>
        {canManage ? (
          <Button variant="primary" icon="plus" onClick={() => navigate?.(`${base}/discounts/new`)}>
            {d.create}
          </Button>
        ) : null}
      </PageHeader>
      {programs.data && all.length > 0 ? (
        <ListToolbar
          labels={toolbarLabels(t)}
          activeFilters={active}
          resultCount={resultsText(t, rows.length)}
          onReset={() => updateList({ q: '', status: '' })}
          reload={{ label: t.common.reload, onClick: () => void programs.reload() }}
          search={
            <SearchInput
              id="discount-q"
              value={list.q}
              label={d.search}
              placeholder={d.search}
              clearLabel={t.common.list.clearSearch}
              onSearch={(q) => updateList({ q }, { replace: true })}
            />
          }
          filters={
            <FacetedFilter
              label={t.common.status}
              clearLabel={t.common.list.clearChoice}
              options={DISCOUNT_STATUSES.map((status) => ({
                value: status,
                label: d.statuses[status],
              }))}
              selected={list.status ? [list.status] : []}
              onChange={([status]) => updateList({ status: status ?? '' })}
            />
          }
        />
      ) : null}
      <DataTable
        mode="client"
        caption={fill(t.common.list.table, { list: d.title })}
        columns={columns}
        rows={rows}
        rowKey={(program) => program.id}
        sort={{ key: list.sort, direction: list.dir === 'asc' ? 'asc' : 'desc' }}
        onSortChange={(sort) => updateList({ sort: sort.key, dir: sort.direction })}
        sortLabels={sortLabels(t)}
        loading={programs.loading && !programs.data}
        loadingLabel={t.common.loading}
        error={
          programs.error ? (
            <ErrorState error={programs.error} t={t} onRetry={() => void programs.reload()} />
          ) : undefined
        }
        empty={programs.data ? <Empty>{all.length === 0 ? d.none : d.noMatch}</Empty> : undefined}
        paging={{
          page: list.page,
          pageSize: list.pageSize,
          onPageChange: (page) => updateList({ page }),
          onPageSizeChange: (pageSize) => updateList({ pageSize }),
          labels: paginationLabels(t, d.title),
        }}
      />
    </>
  );
}
