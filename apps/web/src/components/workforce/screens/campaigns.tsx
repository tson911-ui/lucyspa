'use client';

import type {
  CampaignCreateRequest,
  CampaignDetailResponse,
  CampaignListResponse,
  CampaignListRow,
} from '@lucy-spa/contracts';
import {
  DataTable,
  Field,
  FacetedFilter,
  FormDialog,
  FormGrid,
  ListToolbar,
  RowActions,
  SearchInput,
  Textarea,
  TextInput,
  useUrlState,
  type DataTableColumn,
} from '@lucy-spa/ui';
import { useRef, useState } from 'react';
import { campaignDictionary } from '../../../i18n/campaigns';
import { fill } from '../../../i18n/workforce';
import {
  CAMPAIGN_LIST_DEFAULTS,
  CAMPAIGN_LIST_PAGE_KEYS,
  campaignListQuery,
  campaignName,
  campaignTone,
  campaignDays,
  createRequest,
  emptyCreateDraft,
  firstProblemField,
  normalizeCampaignList,
  validateCreate,
  withName,
  type CampaignCreateDraft,
  type CampaignFormField,
} from '../../../lib/workforce/campaigns';
import { formOverlayLabels } from '../../../lib/workforce/form-labels';
import { paginationLabels, resultsText, toolbarLabels } from '../../../lib/workforce/list-view';
import { canGlobal } from '../../../lib/workforce/permissions';
import { PrefetchLink as Link } from '../link';
import { useAccount, useWorkforce } from '../session';
import {
  Badge,
  Button,
  Empty,
  ErrorState,
  Notice,
  PageHeader,
  useResource,
  useSuccessToast,
} from '../ui';
import { useCampaignAction } from './campaign-dialogs';

const STATES = ['DRAFT', 'SCHEDULED', 'ACTIVE', 'ENDED'] as const;

/**
 * "Chiến dịch khuyến mãi" (Phase 6 Wave 4 / P6-23): every promotion campaign, 20 to a page, newest first within a state. The API
 * pages, searches and filters on the server, so the address bar holds only the search, the state and the page. A new campaign is a
 * short form (a dialog); its page does the rest. Needs the global MANAGE_PRODUCT_PRICES.
 */
export function CampaignsScreen() {
  const { api, t, locale, base, navigate } = useWorkforce();
  const { account } = useAccount();
  const c = campaignDictionary(locale);
  const allowed = canGlobal(account, 'MANAGE_PRODUCT_PRICES');
  const [list, updateList] = useUrlState(CAMPAIGN_LIST_DEFAULTS, {
    normalize: normalizeCampaignList,
    resetOnChange: CAMPAIGN_LIST_PAGE_KEYS,
  });
  const [creating, setCreating] = useState(false);
  const campaigns = useResource(
    () =>
      allowed
        ? api.get<CampaignListResponse>('/api/v1/product-campaigns', campaignListQuery(list))
        : Promise.resolve(null),
    [api, allowed, list.q, list.state, list.page],
  );

  if (!allowed) {
    return (
      <>
        <PageHeader title={c.title} />
        <Notice tone="info">{c.noAccess}</Notice>
      </>
    );
  }

  const rows = campaigns.data?.rows ?? [];
  const total = campaigns.data?.total ?? 0;
  const active = (list.q ? 1 : 0) + (list.state ? 1 : 0);
  const open = (row: CampaignListRow) => navigate?.(`${base}/product-campaigns/${row.id}`);
  const filtered = active > 0;

  const columns: DataTableColumn<CampaignListRow>[] = [
    {
      key: 'name',
      header: c.list.name,
      mobileTitle: true,
      truncate: true,
      width: 'lg',
      cell: (row) => (
        <Link
          className="ls-link"
          href={`${base}/product-campaigns/${row.id}`}
          title={campaignName(row, locale)}
        >
          {campaignName(row, locale)}
        </Link>
      ),
    },
    {
      key: 'state',
      header: c.list.status,
      cell: (row) => (
        <Badge tone={campaignTone(row.state)}>
          {row.endedEarlyAt ? c.list.endedEarly : c.states[row.state]}
        </Badge>
      ),
    },
    {
      key: 'window',
      header: c.list.window,
      hideBelow: 'md',
      cell: (row) => campaignDays(row, locale),
    },
    {
      key: 'groups',
      header: c.list.groups,
      numeric: true,
      hideBelow: 'lg',
      cell: (row) => row.groupCount,
    },
    { key: 'items', header: c.list.products, numeric: true, cell: (row) => row.itemCount },
    {
      key: 'actions',
      header: t.common.actions,
      actions: true,
      cell: (row) => (
        <RowActions
          menuLabel={fill(t.common.list.actionsFor, { name: campaignName(row, locale) })}
          items={[{ id: 'open', label: c.list.open, icon: 'eye', onSelect: () => open(row) }]}
        />
      ),
    },
  ];

  return (
    <>
      <PageHeader title={c.title} intro={c.intro}>
        <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
          {c.list.create}
        </Button>
      </PageHeader>
      {campaigns.data && (total > 0 || filtered) ? (
        <ListToolbar
          labels={toolbarLabels(t)}
          activeFilters={active}
          resultCount={resultsText(t, total)}
          onReset={() => updateList({ q: '', state: '' })}
          reload={{ label: t.common.reload, onClick: () => void campaigns.reload() }}
          search={
            <SearchInput
              id="campaign-q"
              value={list.q}
              label={c.list.search}
              placeholder={c.list.search}
              clearLabel={t.common.list.clearSearch}
              onSearch={(q) => updateList({ q }, { replace: true })}
            />
          }
          filters={
            <FacetedFilter
              label={c.list.state}
              clearLabel={t.common.list.clearChoice}
              options={STATES.map((state) => ({ value: state, label: c.states[state] }))}
              selected={list.state ? [list.state] : []}
              onChange={([state]) => updateList({ state: state ?? '' })}
            />
          }
        />
      ) : null}
      <DataTable
        mode="server"
        caption={fill(t.common.list.table, { list: c.title })}
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        loading={campaigns.loading}
        loadingLabel={t.common.loading}
        error={
          campaigns.error ? (
            <ErrorState error={campaigns.error} t={t} onRetry={() => void campaigns.reload()} />
          ) : undefined
        }
        empty={
          campaigns.data ? <Empty>{filtered ? c.list.noMatch : c.list.empty}</Empty> : undefined
        }
        paging={{
          page: list.page,
          pageSize: campaigns.data?.pageSize ?? 20,
          total,
          onPageChange: (page) => updateList({ page }),
          labels: paginationLabels(t, c.title),
        }}
      />
      {creating ? (
        <CampaignCreateDialog
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            navigate?.(`${base}/product-campaigns/${id}`);
          }}
        />
      ) : null}
    </>
  );
}

/**
 * The short form that starts a draft: names, the address (it follows the Vietnamese name until the person edits it), the period in
 * Vietnam time and an internal note. A taken address comes back from the API and is shown on the address field.
 */
function CampaignCreateDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { api, t, locale } = useWorkforce();
  const c = campaignDictionary(locale);
  const notify = useSuccessToast();
  const [initial] = useState<CampaignCreateDraft>(() => emptyCreateDraft());
  const [draft, setDraft] = useState<CampaignCreateDraft>(initial);
  const [checked, setChecked] = useState(false);
  const createdId = useRef<string | null>(null);
  const command = useCampaignAction(async (path, body) => {
    const made = await api.post<CampaignDetailResponse>(path, body);
    createdId.current = made.id;
  });
  const problems = checked ? validateCreate(draft) : {};
  const text = (field: CampaignFormField) => {
    if (command.field === field && command.message) return command.message;
    const key = problems[field];
    if (!key) return undefined;
    return c.problems[key];
  };

  async function submit() {
    setChecked(true);
    const found = validateCreate(draft);
    const field = firstProblemField(found);
    if (field) {
      document.getElementById(`campaign-create-${field}`)?.focus();
      return;
    }
    const body: CampaignCreateRequest | null = createRequest(draft);
    if (!body) return;
    if (await command.run('/api/v1/product-campaigns', body)) {
      notify(c.create.created);
      if (createdId.current) onCreated(createdId.current);
    }
  }

  return (
    <FormDialog
      title={c.create.title}
      labels={{ ...formOverlayLabels(t, c.create.submit), submitting: c.saving }}
      busy={command.pending}
      dirty={JSON.stringify(draft) !== JSON.stringify(initial)}
      error={
        command.message && !command.field ? (
          <Notice tone="error">{command.message}</Notice>
        ) : undefined
      }
      onClose={onClose}
      onSubmit={submit}
    >
      <FormGrid cols={2}>
        <Field id="campaign-create-nameVi" label={c.fields.nameVi} error={text('nameVi')} required>
          {(control) => (
            <TextInput
              {...control}
              value={draft.nameVi}
              onChange={(event) => setDraft(withName(draft, { nameVi: event.target.value }))}
            />
          )}
        </Field>
        <Field id="campaign-create-nameEn" label={c.fields.nameEn} error={text('nameEn')} required>
          {(control) => (
            <TextInput
              {...control}
              value={draft.nameEn}
              onChange={(event) => setDraft(withName(draft, { nameEn: event.target.value }))}
            />
          )}
        </Field>
        <Field
          id="campaign-create-slug"
          label={c.fields.slug}
          hint={c.fields.slugHint}
          error={text('slug')}
          required
          full
        >
          {(control) => (
            <TextInput
              {...control}
              autoComplete="off"
              spellCheck={false}
              value={draft.slug}
              onChange={(event) => {
                command.clear();
                setDraft({ ...draft, slug: event.target.value, slugTouched: true });
              }}
            />
          )}
        </Field>
        <Field
          id="campaign-create-startsAt"
          label={c.fields.startsAt}
          hint={c.fields.startsHint}
          error={text('startsAt')}
          required
        >
          {(control) => (
            <TextInput
              {...control}
              type="datetime-local"
              value={draft.startsAt}
              onChange={(event) => setDraft({ ...draft, startsAt: event.target.value })}
            />
          )}
        </Field>
        <Field id="campaign-create-endsAt" label={c.fields.endsAt} error={text('endsAt')} required>
          {(control) => (
            <TextInput
              {...control}
              type="datetime-local"
              value={draft.endsAt}
              onChange={(event) => setDraft({ ...draft, endsAt: event.target.value })}
            />
          )}
        </Field>
        <Field
          id="campaign-create-note"
          label={c.fields.note}
          hint={c.fields.noteHint}
          error={text('note')}
          full
        >
          {(control) => (
            <Textarea
              {...control}
              rows={3}
              value={draft.note}
              onChange={(event) => setDraft({ ...draft, note: event.target.value })}
            />
          )}
        </Field>
      </FormGrid>
    </FormDialog>
  );
}
