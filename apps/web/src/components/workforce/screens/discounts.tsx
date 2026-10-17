'use client';

import type { DiscountListResponse, DiscountSummaryResponse } from '@lucy-spa/contracts';
import {
  ButtonLink,
  DataTable,
  EmptyState,
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
import { AdminButtonLink } from './admin-button-link';

/**
 * "Ưu đãi" (Phase 4 Step 6): the Owner's discount programs. Programs are never deleted; "editing" appends an
 * immutable version and early termination is permanent. The POS never types a percentage or an amount.
 * The API returns every program, so search, the status filter, sorting and paging run in the browser
 * (`DataTable` client mode) with their state in the address bar; creating opens its own page.
 */
export function DiscountsScreen() {
  const { api, t, locale, base } = useWorkforce();
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

  // The program name leads and wraps by word (never cut, C15); the program code is a muted reference at the end.
  const columns: DataTableColumn<DiscountSummaryResponse>[] = [
    {
      key: 'name',
      header: d.colProgram,
      mobileTitle: true,
      wrap: true,
      width: 'lg',
      sortable: true,
      sortValue: (program) => discountSortValue(program, 'name', locale),
      cell: (program) => (
        <Link className="ls-link" href={`${base}/discounts/${program.id}`}>
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
          ? fill(d.codeProgramCount, {
              kind: d.codeProgram,
              count: fill(d.codeCount, { n: program.voucherCount }),
            })
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
      // Start on the first line, end on the second: no "→" glyph, and a range never breaks in the middle of a date.
      cell: (program) => (
        <span className="ls-cell-stack ls-cat-window">
          <span className="ls-cell-main">{formatVnInstant(program.current.validFrom, locale)}</span>
          <span className="ls-cell-sub">
            {fill(d.untilShort, { date: formatVnInstant(program.current.validUntil, locale) })}
          </span>
        </span>
      ),
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
      key: 'code',
      header: d.code,
      cell: (program) => (
        <span className="ls-cat-code" translate="no">
          {program.code}
        </span>
      ),
    },
    {
      key: 'actions',
      header: t.common.actions,
      actions: true,
      cell: (program) => (
        // A real link in the menu (client-side, modifier-click works): the kit menu takes the staff router link.
        <RowActions
          menuLabel={fill(t.common.list.actionsFor, { name: discountName(program, locale) })}
          LinkComponent={Link}
          items={[
            {
              id: 'details',
              label: t.common.details,
              icon: 'eye',
              href: `${base}/discounts/${program.id}`,
            },
          ]}
        />
      ),
    },
  ];

  return (
    <>
      <PageHeader title={d.title} intro={d.intro}>
        {/* Creating opens its own page: a real link (modifier-click, new tab), styled as the one primary. */}
        {canManage ? (
          <ButtonLink
            LinkComponent={AdminButtonLink}
            variant="primary"
            icon="plus"
            href={`${base}/discounts/new`}
          >
            {d.create}
          </ButtonLink>
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
              hint={d.searchPlaceholder}
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
        drillDown
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
        empty={
          programs.data ? (
            all.length === 0 ? (
              <EmptyState icon={false} title={d.noneTitle}>
                {d.none}
              </EmptyState>
            ) : (
              <EmptyState
                icon="search"
                title={d.noMatchTitle}
                action={
                  <Button variant="secondary" onClick={() => updateList({ q: '', status: '' })}>
                    {t.common.list.reset}
                  </Button>
                }
              >
                {d.noMatch}
              </EmptyState>
            )
          ) : undefined
        }
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
