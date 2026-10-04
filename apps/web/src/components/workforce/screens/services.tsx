'use client';

import type {
  ServicePricingUnit,
  ServiceCategoryListResponse,
  ServiceCategoryResponse,
  ServiceCreateRequest,
  ServiceListResponse,
  ServiceResponse,
} from '@lucy-spa/contracts';
import {
  ConfirmDialog,
  DataTable,
  FacetedFilter,
  Field,
  FormDialog,
  FormDrawer,
  FormGrid,
  ListToolbar,
  NumberInput,
  RowActions,
  SearchInput,
  Select,
  Tabs,
  TextInput,
  useUrlState,
  type DataTableColumn,
} from '@lucy-spa/ui';
import { PrefetchLink as Link } from '../link';
import { useState } from 'react';
import { fill } from '../../../i18n/workforce';
import {
  deleteConfirmation,
  deleteErrorMessage,
  deletedMessage,
  requestDelete,
  withoutDeleted,
  type DeleteTarget,
} from '../../../lib/workforce/catalog-delete';
import { durationNumbers, durationProblem, formatEstimate } from '../../../lib/workforce/durations';
import { confirmError, formOverlayLabels } from '../../../lib/workforce/form-labels';
import {
  paginationLabels,
  resultsText,
  sortLabels,
  toolbarLabels,
} from '../../../lib/workforce/list-view';
import { canGlobal } from '../../../lib/workforce/permissions';
import {
  formatServicePrice,
  maxQuantityBody,
  priceProblem,
  quantityProblem,
} from '../../../lib/workforce/pricing';
import {
  filterServices,
  localizedName,
  normalizeServiceList,
  orderCategories,
  SERVICE_LIST_DEFAULTS,
  SERVICE_PAGE_KEYS,
  serviceSortValue,
} from '../../../lib/workforce/services-list';
import { ApiError } from '../../../lib/workforce/api';
import { runMutation } from '../../../lib/workforce/workflows';
import { useAccount, useWorkforce } from '../session';
import { DurationFields } from './service-durations';
import { PriceFields } from './service-price-fields';
import {
  Badge,
  Button,
  Empty,
  ErrorState,
  Notice,
  PageHeader,
  useResource,
  useSubmit,
} from '../ui';

type Overlay =
  | { kind: 'createService' }
  | { kind: 'createCategory' }
  | { kind: 'editCategory'; category: ServiceCategoryResponse }
  | { kind: 'serviceStatus'; service: ServiceResponse }
  | { kind: 'categoryStatus'; category: ServiceCategoryResponse }
  | { kind: 'delete'; target: DeleteTarget };

/**
 * Service catalog: services and their categories in two tabs. The API returns everything, so search,
 * filters, sorting and paging run in the browser (`DataTable` client mode); their state lives in the
 * address bar. Creating a service (about 11 fields) is a drawer, a category (4 fields) a dialog; the
 * row `⋮` menu offers Details, (De)activate and the permanent Delete of a wrongly created record.
 */
export function ServicesScreen() {
  const { api, t, base, locale, navigate } = useWorkforce();
  const { account } = useAccount();
  const manage = canGlobal(account, 'MANAGE_SERVICES');
  const canCreate = manage && canGlobal(account, 'MANAGE_SERVICE_PRICES');
  const categories = useResource(
    () => api.get<ServiceCategoryListResponse>('/api/v1/service-categories'),
    [api],
  );
  const services = useResource(() => api.get<ServiceListResponse>('/api/v1/services'), [api]);
  const [list, updateList] = useUrlState(SERVICE_LIST_DEFAULTS, {
    normalize: normalizeServiceList,
    resetOnChange: SERVICE_PAGE_KEYS,
  });
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);

  const reloadFor = (kind: DeleteTarget['kind']) =>
    kind === 'service' ? services.reload() : categories.reload();

  /** After a successful save: refresh both lists, close the overlay and say what happened. */
  const finish = (message: string) => async () => {
    await Promise.all([services.reload(), categories.reload()]);
    setOverlay(null);
    setNotice(message);
  };

  async function confirmDelete(confirmed: DeleteTarget) {
    try {
      await requestDelete(api, confirmed);
    } catch (error) {
      // A changed record is reloaded so the next attempt uses its current version; a refused
      // deletion keeps the record visible and the dialog explains why.
      if (error instanceof ApiError && error.code === 'CONFLICT' && !error.field) {
        await reloadFor(confirmed.kind);
      }
      throw error;
    }
    setRemoved((current) => new Set([...current, confirmed.id]));
    setNotice(deletedMessage(confirmed, t));
    setOverlay(null);
    await reloadFor(confirmed.kind);
  }

  const allCategories = categories.data?.categories ?? [];
  const categoryName = (id: string) => {
    const category = allCategories.find((entry) => entry.id === id);
    return category ? localizedName(category, locale) : '—';
  };
  const allServices = withoutDeleted(services.data?.services ?? [], removed);
  const rows = filterServices(allServices, list);
  const shownCategories = orderCategories(withoutDeleted(allCategories, removed));
  const active = (list.q ? 1 : 0) + (list.category ? 1 : 0) + (list.status ? 1 : 0);
  const noCategories = Boolean(categories.data) && shownCategories.length === 0;
  const onCategories = list.tab === 'categories';

  const openDelete = (target: DeleteTarget) => {
    setNotice(null);
    setOverlay({ kind: 'delete', target });
  };

  const serviceColumns: DataTableColumn<ServiceResponse>[] = [
    {
      key: 'code',
      header: t.common.code,
      sortable: true,
      sortValue: (service) => serviceSortValue(service, 'code', locale, categoryName),
      cell: (service) => service.code,
    },
    {
      key: 'name',
      header: t.common.name,
      mobileTitle: true,
      truncate: true,
      width: 'md',
      sortable: true,
      sortValue: (service) => serviceSortValue(service, 'name', locale, categoryName),
      cell: (service) => (
        <Link
          className="ls-link"
          href={`${base}/services/${service.id}`}
          title={localizedName(service, locale)}
        >
          {localizedName(service, locale)}
        </Link>
      ),
    },
    {
      key: 'category',
      header: t.services.category,
      hideBelow: 'lg',
      truncate: true,
      width: 'md',
      sortable: true,
      sortValue: (service) => serviceSortValue(service, 'category', locale, categoryName),
      cell: (service) => categoryName(service.categoryId),
    },
    {
      key: 'price',
      header: t.services.price,
      numeric: true,
      sortable: true,
      sortValue: (service) => serviceSortValue(service, 'price', locale, categoryName),
      cell: (service) => formatServicePrice(service, t, locale),
    },
    {
      key: 'estimate',
      header: t.services.estimate,
      numeric: true,
      hideBelow: 'xl',
      cell: (service) =>
        formatEstimate(service.estimatedMinMinutes, service.estimatedMaxMinutes, t),
    },
    {
      key: 'status',
      header: t.common.status,
      cell: (service) => (
        <Badge tone={service.isActive ? 'success' : 'neutral'}>
          {service.isActive ? t.common.active : t.common.inactive}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: t.common.actions,
      actions: true,
      cell: (service) => {
        const name = localizedName(service, locale);
        return (
          <RowActions
            menuLabel={fill(t.common.list.actionsFor, { name })}
            items={[
              {
                id: 'details',
                label: t.common.details,
                icon: 'eye',
                onSelect: () => navigate?.(`${base}/services/${service.id}`),
              },
              ...(manage
                ? [
                    {
                      id: 'status',
                      label: service.isActive ? t.common.deactivate : t.common.activate,
                      onSelect: () => {
                        setNotice(null);
                        setOverlay({ kind: 'serviceStatus', service });
                      },
                    },
                  ]
                : []),
              ...(canCreate
                ? [
                    {
                      id: 'delete',
                      label: t.services.delete,
                      icon: 'trash' as const,
                      tone: 'danger' as const,
                      onSelect: () =>
                        openDelete({
                          kind: 'service',
                          id: service.id,
                          name,
                          code: service.code,
                          version: service.version,
                        }),
                    },
                  ]
                : []),
            ]}
          />
        );
      },
    },
  ];

  const categoryColumns: DataTableColumn<ServiceCategoryResponse>[] = [
    { key: 'code', header: t.common.code, cell: (category) => category.code },
    {
      key: 'nameVi',
      header: t.services.nameVi,
      mobileTitle: true,
      truncate: true,
      width: 'lg',
      cell: (category) => category.nameVi,
    },
    {
      key: 'nameEn',
      header: t.services.nameEn,
      hideBelow: 'md',
      truncate: true,
      width: 'lg',
      cell: (category) => category.nameEn,
    },
    {
      key: 'sortOrder',
      header: t.services.sortOrder,
      numeric: true,
      hideBelow: 'lg',
      cell: (category) => category.sortOrder,
    },
    {
      key: 'status',
      header: t.common.status,
      cell: (category) => (
        <Badge tone={category.isActive ? 'success' : 'neutral'}>
          {category.isActive ? t.common.active : t.common.inactive}
        </Badge>
      ),
    },
    ...(manage
      ? [
          {
            key: 'actions',
            header: t.common.actions,
            actions: true,
            cell: (category: ServiceCategoryResponse) => {
              const name = localizedName(category, locale);
              return (
                <RowActions
                  menuLabel={fill(t.common.list.actionsFor, { name })}
                  items={[
                    {
                      id: 'edit',
                      label: t.common.edit,
                      icon: 'edit',
                      onSelect: () => {
                        setNotice(null);
                        setOverlay({ kind: 'editCategory', category });
                      },
                    },
                    {
                      id: 'status',
                      label: category.isActive ? t.common.deactivate : t.common.activate,
                      onSelect: () => {
                        setNotice(null);
                        setOverlay({ kind: 'categoryStatus', category });
                      },
                    },
                    {
                      id: 'delete',
                      label: t.services.delete,
                      icon: 'trash',
                      tone: 'danger',
                      onSelect: () =>
                        openDelete({
                          kind: 'category',
                          id: category.id,
                          name,
                          code: category.code,
                          version: category.version,
                        }),
                    },
                  ]}
                />
              );
            },
          },
        ]
      : []),
  ];

  const servicesPanel = (
    <>
      {canCreate && noCategories ? <Notice tone="info">{t.services.noCategories}</Notice> : null}
      {services.data && allServices.length > 0 ? (
        <ListToolbar
          labels={toolbarLabels(t)}
          activeFilters={active}
          resultCount={resultsText(t, rows.length)}
          onReset={() => updateList({ q: '', category: '', status: '' })}
          reload={{ label: t.common.reload, onClick: () => void services.reload() }}
          search={
            <SearchInput
              id="service-q"
              value={list.q}
              label={t.services.search}
              placeholder={t.services.search}
              clearLabel={t.common.list.clearSearch}
              onSearch={(q) => updateList({ q }, { replace: true })}
            />
          }
          filters={
            <>
              <FacetedFilter
                label={t.services.category}
                clearLabel={t.common.list.clearChoice}
                options={shownCategories.map((category) => ({
                  value: category.id,
                  label: localizedName(category, locale),
                }))}
                selected={list.category ? [list.category] : []}
                onChange={([category]) => updateList({ category: category ?? '' })}
              />
              <FacetedFilter
                label={t.common.status}
                clearLabel={t.common.list.clearChoice}
                options={[
                  { value: 'active', label: t.common.active },
                  { value: 'inactive', label: t.common.inactive },
                ]}
                selected={list.status ? [list.status] : []}
                onChange={([status]) => updateList({ status: status ?? '' })}
              />
            </>
          }
        />
      ) : null}
      <DataTable
        mode="client"
        caption={fill(t.common.list.table, { list: t.services.services })}
        columns={serviceColumns}
        rows={rows}
        rowKey={(service) => service.id}
        sort={{ key: list.sort, direction: list.dir === 'desc' ? 'desc' : 'asc' }}
        onSortChange={(sort) => updateList({ sort: sort.key, dir: sort.direction })}
        sortLabels={sortLabels(t)}
        loading={services.loading}
        loadingLabel={t.common.loading}
        error={
          services.error ? (
            <ErrorState error={services.error} t={t} onRetry={() => void services.reload()} />
          ) : undefined
        }
        empty={
          services.data ? (
            <Empty>{allServices.length === 0 ? t.common.empty : t.services.noMatch}</Empty>
          ) : undefined
        }
        paging={{
          page: list.page,
          pageSize: list.pageSize,
          onPageChange: (page) => updateList({ page }),
          onPageSizeChange: (pageSize) => updateList({ pageSize }),
          labels: paginationLabels(t, t.services.services),
        }}
      />
    </>
  );

  const categoriesPanel = (
    <DataTable
      mode="client"
      caption={fill(t.common.list.table, { list: t.services.categories })}
      columns={categoryColumns}
      rows={shownCategories}
      rowKey={(category) => category.id}
      loading={categories.loading}
      loadingLabel={t.common.loading}
      error={
        categories.error ? (
          <ErrorState error={categories.error} t={t} onRetry={() => void categories.reload()} />
        ) : undefined
      }
      empty={categories.data ? <Empty>{t.common.empty}</Empty> : undefined}
      paging={{
        page: list.cpage,
        pageSize: list.cpageSize,
        onPageChange: (cpage) => updateList({ cpage }),
        onPageSizeChange: (cpageSize) => updateList({ cpageSize }),
        labels: paginationLabels(t, t.services.categories),
      }}
    />
  );

  return (
    <>
      <PageHeader title={t.services.title}>
        {onCategories && manage ? (
          <Button
            variant="primary"
            icon="plus"
            onClick={() => {
              setNotice(null);
              setOverlay({ kind: 'createCategory' });
            }}
          >
            {t.services.createCategory}
          </Button>
        ) : null}
        {!onCategories && canCreate && !noCategories ? (
          <Button
            variant="primary"
            icon="plus"
            onClick={() => {
              setNotice(null);
              setOverlay({ kind: 'createService' });
            }}
          >
            {t.services.createService}
          </Button>
        ) : null}
      </PageHeader>
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      <Tabs
        label={t.services.title}
        value={list.tab}
        onChange={(tab) => updateList({ tab })}
        tabs={[
          {
            id: 'services',
            label: `${t.services.services} (${allServices.length})`,
            panel: servicesPanel,
          },
          {
            id: 'categories',
            label: `${t.services.categories} (${shownCategories.length})`,
            panel: categoriesPanel,
          },
        ]}
      />
      {overlay?.kind === 'createService' ? (
        <ServiceCreate
          categories={shownCategories}
          onClose={() => setOverlay(null)}
          onCreated={finish(t.services.created)}
        />
      ) : null}
      {overlay?.kind === 'createCategory' ? (
        <CategoryCreate
          onClose={() => setOverlay(null)}
          onCreated={finish(t.services.categoryCreated)}
        />
      ) : null}
      {overlay?.kind === 'editCategory' ? (
        <CategoryEdit
          key={overlay.category.id}
          category={overlay.category}
          onClose={() => setOverlay(null)}
          onSaved={finish(t.common.saved)}
        />
      ) : null}
      {overlay?.kind === 'serviceStatus' ? (
        <StatusConfirm
          key={overlay.service.id}
          kind="service"
          record={overlay.service}
          onClose={() => setOverlay(null)}
          onChanged={finish(t.common.saved)}
        />
      ) : null}
      {overlay?.kind === 'categoryStatus' ? (
        <StatusConfirm
          key={overlay.category.id}
          kind="category"
          record={overlay.category}
          onClose={() => setOverlay(null)}
          onChanged={finish(t.common.saved)}
        />
      ) : null}
      {overlay?.kind === 'delete' ? (
        <ConfirmDialog
          {...deleteConfirmation(overlay.target, t)}
          tone="danger"
          busyLabel={t.common.saving}
          cancelLabel={t.common.cancel}
          referenceLabel={t.errors.reference}
          describeError={(error) => ({
            message: deleteErrorMessage(error, overlay.target.kind, t),
            reference: error instanceof ApiError ? error.requestId : null,
          })}
          onCancel={() => setOverlay(null)}
          onConfirm={() => confirmDelete(overlay.target)}
        />
      ) : null}
    </>
  );
}

/** Activate or deactivate a service or category: a confirmation with a required reason. */
export function StatusConfirm({
  kind,
  record,
  onClose,
  onChanged,
  onDone,
}: {
  kind: 'service' | 'category';
  record: ServiceResponse | ServiceCategoryResponse;
  onClose: () => void;
  onChanged: () => Promise<void>;
  /** Called once the change was saved and `onChanged` finished (the list screen closes in `onChanged`). */
  onDone?: () => void;
}) {
  const { api, t, locale } = useWorkforce();
  const deactivating = record.isActive;
  const text = t.services;
  const path =
    kind === 'service'
      ? `/api/v1/services/${record.id}/status`
      : `/api/v1/service-categories/${record.id}/status`;
  const [title, description] =
    kind === 'service'
      ? deactivating
        ? [text.deactivateServiceTitle, text.deactivateServiceBody]
        : [text.activateServiceTitle, text.activateServiceBody]
      : deactivating
        ? [text.deactivateCategoryTitle, text.deactivateCategoryBody]
        : [text.activateCategoryTitle, text.activateCategoryBody];
  return (
    <ConfirmDialog
      title={title}
      description={description}
      facts={[{ label: t.common.code, value: `${record.code} · ${localizedName(record, locale)}` }]}
      tone={deactivating ? 'danger' : 'neutral'}
      confirmLabel={deactivating ? t.common.deactivate : t.common.activate}
      busyLabel={t.common.saving}
      cancelLabel={t.common.cancel}
      referenceLabel={t.errors.reference}
      reasonField={{
        label: t.common.reason,
        required: true,
        requiredLabel: t.common.required,
        requiredMessage: t.common.form.reasonRequired,
      }}
      describeError={confirmError(t)}
      onCancel={onClose}
      onConfirm={async (reason) => {
        const outcome = await runMutation(
          () =>
            api.post(path, {
              expectedVersion: record.version,
              isActive: !record.isActive,
              reason: reason ?? '',
            }),
          onChanged,
        );
        if (!outcome.ok) throw outcome.error;
        await onChanged();
        onDone?.();
      }}
    />
  );
}

/** Short form (4 fields): a dialog opened from the page header. Mounted only while open. */
function CategoryCreate({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const { api, t } = useWorkforce();
  const [form, setForm] = useState({ code: '', nameVi: '', nameEn: '', sortOrder: '0' });
  const submit = useSubmit();

  async function save() {
    const ok = await submit.run(
      () =>
        runMutation(
          () =>
            api.post('/api/v1/service-categories', {
              code: form.code,
              nameVi: form.nameVi,
              nameEn: form.nameEn,
              sortOrder: Number(form.sortOrder),
            }),
          onCreated,
        ),
      t.services.categoryCreated,
    );
    if (ok) await onCreated();
  }

  return (
    <FormDialog
      title={t.services.createCategory}
      labels={formOverlayLabels(t, t.common.create)}
      busy={submit.pending}
      dirty={form.code !== '' || form.nameVi !== '' || form.nameEn !== '' || form.sortOrder !== '0'}
      error={submit.error ? <ErrorState error={submit.error} t={t} /> : undefined}
      onClose={onClose}
      onSubmit={save}
    >
      <FormGrid cols={2}>
        <Field label={t.common.code} required>
          {(control) => (
            <TextInput
              {...control}
              maxLength={64}
              value={form.code}
              onChange={(event) => setForm({ ...form, code: event.target.value })}
            />
          )}
        </Field>
        <Field label={t.services.sortOrder}>
          {(control) => (
            <NumberInput
              {...control}
              min={0}
              max={100000}
              step={1}
              value={form.sortOrder}
              onChange={(event) => setForm({ ...form, sortOrder: event.target.value })}
            />
          )}
        </Field>
        <Field label={t.services.nameVi} required>
          {(control) => (
            <TextInput
              {...control}
              maxLength={200}
              value={form.nameVi}
              onChange={(event) => setForm({ ...form, nameVi: event.target.value })}
            />
          )}
        </Field>
        <Field label={t.services.nameEn} required>
          {(control) => (
            <TextInput
              {...control}
              maxLength={200}
              value={form.nameEn}
              onChange={(event) => setForm({ ...form, nameEn: event.target.value })}
            />
          )}
        </Field>
      </FormGrid>
    </FormDialog>
  );
}

/** Rename or reorder one category. Opened from the row menu; the code never changes. */
function CategoryEdit({
  category,
  onClose,
  onSaved,
}: {
  category: ServiceCategoryResponse;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { api, t } = useWorkforce();
  const [form, setForm] = useState({
    nameVi: category.nameVi,
    nameEn: category.nameEn,
    sortOrder: String(category.sortOrder),
  });
  const submit = useSubmit();
  const changed =
    form.nameVi !== category.nameVi ||
    form.nameEn !== category.nameEn ||
    Number(form.sortOrder) !== category.sortOrder;

  async function save() {
    const ok = await submit.run(
      () =>
        runMutation(
          () =>
            api.post(`/api/v1/service-categories/${category.id}`, {
              expectedVersion: category.version,
              ...(form.nameVi !== category.nameVi ? { nameVi: form.nameVi } : {}),
              ...(form.nameEn !== category.nameEn ? { nameEn: form.nameEn } : {}),
              ...(Number(form.sortOrder) !== category.sortOrder
                ? { sortOrder: Number(form.sortOrder) }
                : {}),
            }),
          onSaved,
        ),
      t.common.saved,
    );
    if (ok) await onSaved();
  }

  return (
    <FormDialog
      title={`${t.services.editCategory}: ${category.code}`}
      labels={formOverlayLabels(t, t.common.save)}
      busy={submit.pending}
      dirty={changed}
      submitDisabled={!changed}
      error={submit.error ? <ErrorState error={submit.error} t={t} /> : undefined}
      onClose={onClose}
      onSubmit={save}
    >
      <FormGrid cols={2}>
        <Field label={t.services.nameVi} required>
          {(control) => (
            <TextInput
              {...control}
              maxLength={200}
              value={form.nameVi}
              onChange={(event) => setForm({ ...form, nameVi: event.target.value })}
            />
          )}
        </Field>
        <Field label={t.services.nameEn} required>
          {(control) => (
            <TextInput
              {...control}
              maxLength={200}
              value={form.nameEn}
              onChange={(event) => setForm({ ...form, nameEn: event.target.value })}
            />
          )}
        </Field>
        <Field label={t.services.sortOrder}>
          {(control) => (
            <NumberInput
              {...control}
              min={0}
              max={100000}
              step={1}
              value={form.sortOrder}
              onChange={(event) => setForm({ ...form, sortOrder: event.target.value })}
            />
          )}
        </Field>
      </FormGrid>
    </FormDialog>
  );
}

const EMPTY_SERVICE = {
  code: '',
  categoryId: '',
  nameVi: '',
  nameEn: '',
  priceVnd: '',
  priceMaxVnd: '',
  pricingUnit: 'PER_SERVICE' as ServicePricingUnit,
  maxQuantity: '',
  estimatedMinMinutes: '60',
  estimatedMaxMinutes: '60',
  durationMinutes: '60',
};

/** Medium form (about 11 fields): a drawer opened from the page header. Mounted only while open. */
function ServiceCreate({
  categories,
  onClose,
  onCreated,
}: {
  categories: readonly ServiceCategoryResponse[];
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const { api, t, locale } = useWorkforce();
  const [form, setForm] = useState(EMPTY_SERVICE);
  const submit = useSubmit();
  const valid =
    priceProblem(form) === null && quantityProblem(form) === null && durationProblem(form) === null;
  const dirty = (Object.keys(EMPTY_SERVICE) as Array<keyof typeof EMPTY_SERVICE>).some(
    (key) => form[key] !== EMPTY_SERVICE[key],
  );

  async function save() {
    if (!valid) return;
    const body: ServiceCreateRequest = {
      code: form.code,
      categoryId: form.categoryId,
      nameVi: form.nameVi,
      nameEn: form.nameEn,
      priceVnd: form.priceVnd,
      priceMaxVnd: form.priceMaxVnd,
      pricingUnit: form.pricingUnit,
      ...maxQuantityBody(form),
      ...durationNumbers(form),
    };
    const ok = await submit.run(
      () => runMutation(() => api.post('/api/v1/services', body), onCreated),
      t.services.created,
    );
    if (ok) await onCreated();
  }

  return (
    <FormDrawer
      title={t.services.createService}
      labels={formOverlayLabels(t, t.common.create)}
      busy={submit.pending}
      dirty={dirty}
      submitDisabled={!valid}
      error={submit.error ? <ErrorState error={submit.error} t={t} /> : undefined}
      onClose={onClose}
      onSubmit={save}
    >
      <FormGrid cols={2}>
        <Field label={t.common.code} required>
          {(control) => (
            <TextInput
              {...control}
              maxLength={64}
              value={form.code}
              onChange={(event) => setForm({ ...form, code: event.target.value })}
            />
          )}
        </Field>
        <Field label={t.services.category} required>
          {(control) => (
            <Select
              {...control}
              placeholder="—"
              value={form.categoryId}
              options={categories.map((category) => ({
                value: category.id,
                label: localizedName(category, locale),
              }))}
              onChange={(event) => setForm({ ...form, categoryId: event.target.value })}
            />
          )}
        </Field>
        <Field label={t.services.nameVi} required>
          {(control) => (
            <TextInput
              {...control}
              maxLength={200}
              value={form.nameVi}
              onChange={(event) => setForm({ ...form, nameVi: event.target.value })}
            />
          )}
        </Field>
        <Field label={t.services.nameEn} required>
          {(control) => (
            <TextInput
              {...control}
              maxLength={200}
              value={form.nameEn}
              onChange={(event) => setForm({ ...form, nameEn: event.target.value })}
            />
          )}
        </Field>
      </FormGrid>
      <PriceFields
        idPrefix="svc-price"
        value={form}
        onChange={(next) => setForm({ ...form, ...next })}
        t={t}
        locale={locale}
      />
      <DurationFields
        idPrefix="svc"
        value={form}
        onChange={(next) => setForm({ ...form, ...next })}
        t={t}
      />
    </FormDrawer>
  );
}
