'use client';

import type {
  CampaignDetailResponse,
  CampaignPickerResponse,
  CampaignPickerRow,
  ProductBrandListResponse,
  ProductCategoryListResponse,
} from '@lucy-spa/contracts';
import {
  CheckField,
  DataTable,
  Field,
  FacetedFilter,
  FormDialog,
  FormGrid,
  ListSection,
  ListToolbar,
  Menu,
  MoneyInput,
  SearchInput,
  SelectionBar,
  Select,
  type DataTableColumn,
} from '@lucy-spa/ui';
import { useEffect, useState } from 'react';
import { campaignDictionary } from '../../../i18n/campaigns';
import { fill } from '../../../i18n/workforce';
import {
  CAMPAIGN_ADD_LIMIT,
  groupNumbers,
  moneyBound,
  pickerFilter,
  pickerFilterCount,
  pickerQuery,
  priceRangeInvalid,
  productLine,
  ruleText,
  selectAll,
  toggleSelected,
  type CampaignDetailState,
} from '../../../lib/workforce/campaigns';
import { formOverlayLabels } from '../../../lib/workforce/form-labels';
import { formatVnd } from '../../../lib/workforce/format';
import { paginationLabels, resultsText, toolbarLabels } from '../../../lib/workforce/list-view';
import { localizedName } from '../../../lib/workforce/products';
import { useWorkforce } from '../session';
import { Badge, Button, Empty, ErrorState, Notice, useResource, useSuccessToast } from '../ui';
import { useCampaignAction, type SendCampaign } from './campaign-dialogs';

type Adding = { mode: 'selected'; count: number } | { mode: 'filtered'; count: number };

/** A price bound of the picker: typed freely, applied when the box is left or Enter is pressed (not on every digit). */
function PriceBound({
  id,
  label,
  value,
  onCommit,
}: {
  id: string;
  label: string;
  value: string;
  onCommit: (value: string) => void;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <MoneyInput
      id={id}
      aria-label={label}
      placeholder={label}
      unit="₫"
      value={text === '' ? null : Number(text)}
      onValueChange={(next) => setText(next === null ? '' : String(next))}
      onBlur={() => {
        const next = moneyBound(text);
        if (next !== value) onCommit(next);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          const next = moneyBound(text);
          if (next !== value) onCommit(next);
        }
      }}
    />
  );
}

/**
 * Picking products for a draft: every product on sale, filtered by brand, category, price and stock, with the selection kept across
 * pages. "Add selected" sends the chosen ids; "Add all filtered results" sends the filter itself (up to 2000 products at once), after
 * a confirmation that states how many products it will add. A product already in the campaign moves to the chosen group.
 */
export function PickerPanel({
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
  const [adding, setAdding] = useState<Adding | null>(null);
  const brands = useResource(
    () => api.get<ProductBrandListResponse>('/api/v1/product-brands'),
    [api],
  );
  const categories = useResource(
    () => api.get<ProductCategoryListResponse>('/api/v1/product-categories'),
    [api],
  );
  const badRange = priceRangeInvalid(list);
  const picker = useResource(
    () =>
      badRange
        ? Promise.resolve(null)
        : api.get<CampaignPickerResponse>(
            `/api/v1/product-campaigns/${campaign.id}/picker`,
            pickerQuery(list),
          ),
    [
      api,
      campaign.id,
      campaign.rowVersion,
      badRange,
      list.ppage,
      list.pq,
      list.brand,
      list.category,
      list.min,
      list.max,
      list.stock,
    ],
  );
  const rows = picker.data?.rows ?? [];
  const total = picker.data?.total ?? 0;
  const hasGroups = campaign.groups.length > 0;
  const numbers = groupNumbers(campaign.groups);
  const active = pickerFilterCount(list);

  // A removal elsewhere can leave the page past the last one: step back.
  useEffect(() => {
    if (list.ppage > 1 && picker.data && rows.length === 0 && total > 0) {
      updateList({ ppage: Math.max(1, Math.ceil(total / 20)) });
    }
  }, [list.ppage, picker.data, rows.length, total, updateList]);

  const columns: DataTableColumn<CampaignPickerRow>[] = [
    {
      key: 'product',
      header: c.picker.product,
      mobileTitle: true,
      truncate: true,
      width: 'lg',
      cell: (row) => {
        const name = productLine(row);
        return (
          <CheckField
            aria-label={fill(c.picker.select, { name })}
            label={
              <span className="ls-cell-title" title={name}>
                {name}
              </span>
            }
            checked={selected.includes(row.variantId)}
            onChange={() => setSelected(toggleSelected(selected, row.variantId))}
          />
        );
      },
    },
    {
      key: 'brand',
      header: c.picker.brandCol,
      hideBelow: 'lg',
      truncate: true,
      width: 'sm',
      cell: (row) => row.brandName,
    },
    {
      key: 'category',
      header: c.picker.categoryCol,
      hideBelow: 'xl',
      truncate: true,
      width: 'sm',
      cell: (row) => row.categoryName,
    },
    {
      key: 'list',
      header: c.picker.listPrice,
      numeric: true,
      cell: (row) => formatVnd(row.listPriceVnd, locale),
    },
    {
      key: 'stock',
      header: c.picker.available,
      numeric: true,
      hideBelow: 'md',
      cell: (row) => row.available,
    },
    {
      key: 'group',
      header: c.picker.inGroup,
      cell: (row) =>
        row.groupId ? (
          <Badge tone="info">
            {fill(c.picker.groupName, { n: numbers.get(row.groupId) ?? '?' })}
          </Badge>
        ) : (
          c.picker.notIn
        ),
    },
  ];

  const startFiltered = () => setAdding({ mode: 'filtered', count: total });
  const startSelected = () => setAdding({ mode: 'selected', count: selected.length });

  const toolbar =
    selected.length > 0 ? (
      <SelectionBar
        label={c.picker.selectionActions}
        summary={fill(c.picker.selected, { count: selected.length })}
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
          {c.picker.selectPage}
        </Button>
        <Button variant="ghost" onClick={() => setSelected([])}>
          {c.picker.clear}
        </Button>
        <Button variant="secondary" disabled={!hasGroups || total === 0} onClick={startFiltered}>
          {c.picker.addFiltered}
        </Button>
        <Button variant="primary" disabled={!hasGroups} onClick={startSelected}>
          {c.picker.addSelected}
        </Button>
      </SelectionBar>
    ) : (
      <ListToolbar
        labels={toolbarLabels(t)}
        activeFilters={active}
        resultCount={resultsText(t, total)}
        onReset={() => updateList({ pq: '', brand: '', category: '', min: '', max: '', stock: '' })}
        reload={{ label: t.common.reload, onClick: () => void picker.reload() }}
        search={
          <SearchInput
            id="campaign-picker-q"
            value={list.pq}
            label={c.picker.search}
            placeholder={c.picker.search}
            clearLabel={t.common.list.clearSearch}
            onSearch={(pq) => updateList({ pq }, { replace: true })}
          />
        }
        filters={
          <>
            <FacetedFilter
              label={c.picker.brand}
              clearLabel={t.common.list.clearChoice}
              options={(brands.data?.brands ?? []).map((brand) => ({
                value: brand.id,
                label: localizedName(brand, locale),
              }))}
              selected={list.brand ? [list.brand] : []}
              onChange={([brand]) => updateList({ brand: brand ?? '' })}
            />
            <FacetedFilter
              label={c.picker.category}
              clearLabel={t.common.list.clearChoice}
              options={(categories.data?.categories ?? []).map((category) => ({
                value: category.id,
                label: localizedName(category, locale),
              }))}
              selected={list.category ? [list.category] : []}
              onChange={([category]) => updateList({ category: category ?? '' })}
            />
            <PriceBound
              id="campaign-picker-min"
              label={c.picker.priceFrom}
              value={list.min}
              onCommit={(min) => updateList({ min })}
            />
            <PriceBound
              id="campaign-picker-max"
              label={c.picker.priceTo}
              value={list.max}
              onCommit={(max) => updateList({ max })}
            />
            <FacetedFilter
              label={c.picker.stock}
              clearLabel={t.common.list.clearChoice}
              options={[{ value: '1', label: c.picker.stockOnly }]}
              selected={list.stock ? [list.stock] : []}
              onChange={([stock]) => updateList({ stock: stock ?? '' })}
            />
          </>
        }
        actions={
          <Menu
            label={c.picker.addMenu}
            icon="plus"
            items={[
              {
                id: 'page',
                label: c.picker.selectPage,
                icon: 'check',
                disabled: rows.length === 0,
                onSelect: () =>
                  setSelected(
                    selectAll(
                      selected,
                      rows.map((row) => row.variantId),
                    ),
                  ),
              },
              {
                id: 'filtered',
                label: c.picker.addFiltered,
                icon: 'plus',
                disabled: !hasGroups || total === 0,
                onSelect: startFiltered,
              },
            ]}
          />
        }
      />
    );

  return (
    <ListSection title={c.picker.table}>
      {!hasGroups ? <Notice tone="info">{c.picker.noGroups}</Notice> : null}
      {selected.length >= CAMPAIGN_ADD_LIMIT ? (
        <Notice tone="warning">{fill(c.picker.limitReached, { max: CAMPAIGN_ADD_LIMIT })}</Notice>
      ) : null}
      {badRange ? <Notice tone="error">{c.problems.priceRange}</Notice> : null}
      {(picker.data || badRange) && (total > 0 || active > 0) ? toolbar : null}
      <DataTable
        mode="server"
        caption={c.picker.table}
        columns={columns}
        rows={rows}
        rowKey={(row) => row.variantId}
        loading={picker.loading}
        loadingLabel={t.common.loading}
        error={
          picker.error ? (
            <ErrorState error={picker.error} t={t} onRetry={() => void picker.reload()} />
          ) : undefined
        }
        empty={
          picker.data || badRange ? (
            <Empty>{active > 0 ? c.picker.noMatch : c.picker.empty}</Empty>
          ) : undefined
        }
        paging={{
          page: list.ppage,
          pageSize: picker.data?.pageSize ?? 20,
          total,
          onPageChange: (ppage) => updateList({ ppage }),
          labels: paginationLabels(t, c.picker.table),
        }}
      />
      {adding ? (
        <AddToGroupDialog
          campaign={campaign}
          send={send}
          adding={adding}
          ids={selected}
          filter={pickerFilter(list)}
          onClose={() => setAdding(null)}
          onDone={() => {
            setAdding(null);
            setSelected([]);
            notify(c.picker.added);
          }}
        />
      ) : null}
    </ListSection>
  );
}

/** Choose the group, see how many products go in, confirm. "Add all filtered results" over the limit is explained, never sent. */
function AddToGroupDialog({
  campaign,
  send,
  adding,
  ids,
  filter,
  onClose,
  onDone,
}: {
  campaign: CampaignDetailResponse;
  send: SendCampaign;
  adding: Adding;
  ids: readonly string[];
  filter: ReturnType<typeof pickerFilter>;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t, locale } = useWorkforce();
  const c = campaignDictionary(locale);
  const groups = [...campaign.groups].sort((a, b) => a.position - b.position);
  const numbers = groupNumbers(campaign.groups);
  const [groupId, setGroupId] = useState(groups[0]?.id ?? '');
  const command = useCampaignAction(send);
  const tooMany = adding.mode === 'filtered' && adding.count > CAMPAIGN_ADD_LIMIT;
  const none = adding.count === 0;

  async function submit() {
    if (tooMany || none || groupId === '') return;
    const base = `/api/v1/product-campaigns/${campaign.id}/items`;
    const ok =
      adding.mode === 'selected'
        ? await command.run(`${base}/add`, {
            expectedVersion: campaign.rowVersion,
            groupId,
            variantIds: [...ids],
          })
        : await command.run(`${base}/add-filtered`, {
            expectedVersion: campaign.rowVersion,
            groupId,
            filter,
          });
    if (ok) onDone();
  }

  return (
    <FormDialog
      title={
        adding.mode === 'selected'
          ? fill(c.picker.dialogTitleSelected, { n: adding.count })
          : c.picker.dialogTitleFiltered
      }
      description={
        adding.mode === 'selected'
          ? fill(c.picker.dialogBodySelected, { n: adding.count })
          : fill(c.picker.dialogBodyFiltered, { n: adding.count })
      }
      labels={{ ...formOverlayLabels(t, c.picker.submit), submitting: c.saving }}
      busy={command.pending}
      submitDisabled={tooMany || none}
      error={
        tooMany ? (
          <Notice tone="error">
            {fill(c.picker.tooMany, { n: adding.count, max: CAMPAIGN_ADD_LIMIT })}
          </Notice>
        ) : command.message ? (
          <Notice tone="error">{command.message}</Notice>
        ) : undefined
      }
      onClose={onClose}
      onSubmit={submit}
    >
      <FormGrid cols={1}>
        <Field label={c.picker.chooseGroup}>
          {(control) => (
            <Select
              {...control}
              value={groupId}
              options={groups.map((group) => ({
                value: group.id,
                label: `${fill(c.groups.name, { n: numbers.get(group.id) ?? group.position })} · ${ruleText(group.rule, locale)}`,
              }))}
              onChange={(event) => setGroupId(event.target.value)}
            />
          )}
        </Field>
      </FormGrid>
    </FormDialog>
  );
}
