'use client';

import type {
  CampaignDetailResponse,
  CampaignItemRow,
  CampaignItemsResponse,
} from '@lucy-spa/contracts';
import {
  CheckField,
  ConfirmDialog,
  DataTable,
  EmptyState,
  FacetedFilter,
  ListSection,
  ListToolbar,
  SearchInput,
  SelectionBar,
  type DataTableColumn,
} from '@lucy-spa/ui';
import { useEffect, useState } from 'react';
import { campaignDictionary } from '../../../i18n/campaigns';
import { fill } from '../../../i18n/workforce';
import {
  CAMPAIGN_PROBLEMS,
  discountText,
  groupNumbers,
  itemProblems,
  itemsFilterCount,
  itemsQuery,
  productLine,
  selectAll,
  toggleSelected,
  type CampaignDetailState,
} from '../../../lib/workforce/campaigns';
import { formatVnd } from '../../../lib/workforce/format';
import { paginationLabels, resultsText, toolbarLabels } from '../../../lib/workforce/list-view';
import { useWorkforce } from '../session';
import { Button, ErrorState, useResource, useSuccessToast } from '../ui';
import { useConfirmError, type SendCampaign } from './campaign-dialogs';
import { listFormat, metaLine } from './pos-format';

/** The 20 products of a page and how many pages there are: when a removal empties the last page, the list steps back. */
function useStepBack(page: number, rows: number, total: number, set: (page: number) => void) {
  useEffect(() => {
    if (page > 1 && rows === 0 && total > 0) set(Math.max(1, Math.ceil(total / 20)));
  }, [page, rows, total, set]);
}

/**
 * The chosen products of a campaign with the price its rule gives. Filters: search, group, and the three problems the review
 * counts (no discount, in another campaign, own promotion). A draft can take products out; the selection survives page changes.
 */
export function ItemsPanel({
  campaign,
  send,
  list,
  updateList,
}: {
  campaign: CampaignDetailResponse;
  send: SendCampaign;
  list: CampaignDetailState;
  updateList: (patch: Partial<CampaignDetailState>, change?: { replace?: boolean }) => void;
}) {
  const { api, t, locale } = useWorkforce();
  const c = campaignDictionary(locale);
  const notify = useSuccessToast();
  const [selected, setSelected] = useState<string[]>([]);
  const [removing, setRemoving] = useState(false);
  const editable = campaign.can.changeItems;
  const numbers = groupNumbers(campaign.groups);
  const items = useResource(
    () =>
      api.get<CampaignItemsResponse>(
        `/api/v1/product-campaigns/${campaign.id}/items`,
        itemsQuery(list),
      ),
    [api, campaign.id, campaign.rowVersion, list.ipage, list.iq, list.group, list.problem],
  );
  const rows = items.data?.rows ?? [];
  const total = items.data?.total ?? 0;
  useStepBack(list.ipage, rows.length, total, (ipage) => updateList({ ipage }));
  const active = itemsFilterCount(list);
  const describeError = useConfirmError();

  const columns: DataTableColumn<CampaignItemRow>[] = [
    {
      key: 'product',
      header: c.items.product,
      mobileTitle: true,
      wrap: true,
      width: 'lg',
      cell: (row) => {
        const name = productLine(row);
        return editable ? (
          <CheckField
            aria-label={fill(c.items.select, { name })}
            label={<span className="ls-adm-c-name">{name}</span>}
            checked={selected.includes(row.variantId)}
            onChange={() => setSelected(toggleSelected(selected, row.variantId))}
          />
        ) : (
          <span className="ls-adm-c-name">{name}</span>
        );
      },
    },
    {
      key: 'sku',
      header: c.items.sku,
      hideBelow: 'xl',
      cell: (row) => <span translate="no">{row.sku}</span>,
    },
    {
      key: 'group',
      header: c.items.inGroup,
      hideBelow: 'md',
      cell: (row) => fill(c.groups.name, { n: numbers.get(row.groupId) ?? '?' }),
    },
    {
      key: 'list',
      header: c.items.listPrice,
      numeric: true,
      cell: (row) => formatVnd(row.listPriceVnd, locale),
    },
    {
      key: 'price',
      header: c.items.campaignPrice,
      numeric: true,
      cell: (row) =>
        row.campaignPriceVnd === null ? c.items.noPrice : formatVnd(row.campaignPriceVnd, locale),
    },
    {
      key: 'percent',
      header: c.items.percent,
      numeric: true,
      cell: (row) => discountText(row.discountPercent),
    },
    {
      key: 'notes',
      header: c.items.notes,
      hideBelow: 'lg',
      wrap: true,
      width: 'md',
      cell: (row) => {
        const problems = itemProblems(row);
        if (problems.length === 0) return null;
        const names = listFormat(locale).format(row.otherCampaigns.map((other) => other.nameVi));
        const text = metaLine(
          locale,
          problems.map((problem) => c.items.problems[problem]),
        );
        return names === '' ? text : `${text} (${fill(c.items.overlapWith, { names })})`;
      },
    },
  ];

  const toolbar =
    editable && selected.length > 0 ? (
      <SelectionBar
        label={c.items.selectionActions}
        summary={fill(c.items.selected, { count: selected.length })}
      >
        <Button
          variant="ghost"
          onClick={() =>
            setSelected(
              selectAll(
                selected,
                rows.map((row) => row.variantId),
              ),
            )
          }
        >
          {c.items.selectPage}
        </Button>
        <Button variant="ghost" onClick={() => setSelected([])}>
          {c.items.clear}
        </Button>
        <Button variant="danger-outline" icon="trash" onClick={() => setRemoving(true)}>
          {c.items.removeSelected}
        </Button>
      </SelectionBar>
    ) : (
      <ListToolbar
        labels={toolbarLabels(t)}
        activeFilters={active}
        resultCount={resultsText(t, total)}
        onReset={() => updateList({ iq: '', group: '', problem: '' })}
        reload={{ label: t.common.reload, onClick: () => void items.reload() }}
        search={
          <SearchInput
            id="campaign-items-q"
            value={list.iq}
            label={c.items.search}
            hint={c.items.searchPlaceholder}
            clearLabel={t.common.list.clearSearch}
            onSearch={(iq) => updateList({ iq }, { replace: true })}
          />
        }
        filters={
          <>
            <FacetedFilter
              label={c.items.group}
              clearLabel={t.common.list.clearChoice}
              options={[...campaign.groups]
                .sort((a, b) => a.position - b.position)
                .map((group) => ({
                  value: group.id,
                  label: fill(c.groups.name, { n: numbers.get(group.id) ?? group.position }),
                }))}
              selected={list.group ? [list.group] : []}
              onChange={([group]) => updateList({ group: group ?? '' })}
            />
            <FacetedFilter
              label={c.items.problem}
              clearLabel={t.common.list.clearChoice}
              options={CAMPAIGN_PROBLEMS.map((problem) => ({
                value: problem,
                label: c.items.problems[problem],
              }))}
              selected={list.problem ? [list.problem] : []}
              onChange={([problem]) => updateList({ problem: problem ?? '' })}
            />
          </>
        }
      />
    );

  return (
    <ListSection title={c.items.table}>
      {items.data && (total > 0 || active > 0) ? toolbar : null}
      <DataTable
        mode="server"
        caption={c.items.table}
        columns={columns}
        rows={rows}
        rowKey={(row) => row.variantId}
        loading={items.loading}
        loadingLabel={t.common.loading}
        error={
          items.error ? (
            <ErrorState error={items.error} t={t} onRetry={() => void items.reload()} />
          ) : undefined
        }
        empty={
          items.data ? (
            active > 0 ? (
              <EmptyState icon="search" title={c.items.noMatchTitle}>
                {c.items.noMatch}
              </EmptyState>
            ) : (
              <EmptyState icon="tag" title={c.items.emptyTitle}>
                {editable ? c.items.emptyDraft : c.items.empty}
              </EmptyState>
            )
          ) : undefined
        }
        paging={{
          page: list.ipage,
          pageSize: items.data?.pageSize ?? 20,
          total,
          onPageChange: (ipage) => updateList({ ipage }),
          labels: paginationLabels(t, c.items.table),
        }}
      />
      {removing ? (
        <ConfirmDialog
          title={c.items.removeTitle}
          description={c.items.removeBody}
          facts={[{ label: c.items.product, value: String(selected.length) }]}
          tone="danger"
          confirmLabel={c.items.removeConfirm}
          cancelLabel={c.cancel}
          describeError={describeError}
          onCancel={() => setRemoving(false)}
          onConfirm={async () => {
            await send(`/api/v1/product-campaigns/${campaign.id}/items/remove`, {
              expectedVersion: campaign.rowVersion,
              variantIds: selected,
            });
            setSelected([]);
            setRemoving(false);
            notify(c.items.removedToast);
          }}
        />
      ) : null}
    </ListSection>
  );
}
