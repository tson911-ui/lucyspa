'use client';

import type {
  ServicePricingUnit,
  ServiceCategoryListResponse,
  ServiceCategoryResponse,
  ServiceCreateRequest,
  ServiceListResponse,
} from '@lucy-spa/contracts';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { durationNumbers, durationProblem, formatEstimate } from '../../../lib/workforce/durations';
import { canGlobal } from '../../../lib/workforce/permissions';
import { runMutation } from '../../../lib/workforce/workflows';
import { useAccount, useWorkforce } from '../session';
import { ApiError } from '../../../lib/workforce/api';
import {
  deletedMessage,
  requestDelete,
  withoutDeleted,
  type DeleteTarget,
} from '../../../lib/workforce/catalog-delete';
import { ConfirmDeleteDialog } from '../confirm-delete';
import { formatServicePrice, priceProblem } from '../../../lib/workforce/pricing';
import { DurationFields } from './service-durations';
import { PriceFields } from './service-price-fields';
import {
  Badge,
  Empty,
  ErrorState,
  Field,
  FormFeedback,
  Loading,
  Notice,
  PageHeader,
  Section,
  SubmitButton,
  useResource,
  useSubmit,
} from '../ui';

export function ServicesScreen() {
  const { api, t, base, locale } = useWorkforce();
  const { account } = useAccount();
  const manage = canGlobal(account, 'MANAGE_SERVICES');
  const canCreate = manage && canGlobal(account, 'MANAGE_SERVICE_PRICES');
  const categories = useResource(
    () => api.get<ServiceCategoryListResponse>('/api/v1/service-categories'),
    [api],
  );
  const services = useResource(() => api.get<ServiceListResponse>('/api/v1/services'), [api]);
  // Permanent deletion (not deactivation): confirmed in a dialog, authorized by the API.
  const [target, setTarget] = useState<DeleteTarget | null>(null);
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set());
  const [deletedNotice, setDeletedNotice] = useState<string | null>(null);
  const reloadFor = (kind: DeleteTarget['kind']) =>
    kind === 'service' ? services.reload() : categories.reload();

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
    setDeletedNotice(deletedMessage(confirmed, t));
    setTarget(null);
    await reloadFor(confirmed.kind);
  }

  const categoryName = (id: string) => {
    const category = categories.data?.categories.find((entry) => entry.id === id);
    return category ? (locale === 'vi' ? category.nameVi : category.nameEn) : '—';
  };

  return (
    <>
      <PageHeader title={t.services.title} />
      {deletedNotice ? <Notice tone="success">{deletedNotice}</Notice> : null}
      {target ? (
        <ConfirmDeleteDialog
          target={target}
          t={t}
          onCancel={() => setTarget(null)}
          onConfirm={() => confirmDelete(target)}
        />
      ) : null}
      <Section title={t.services.categories}>
        {categories.loading ? <Loading t={t} /> : null}
        {categories.error ? (
          <ErrorState error={categories.error} t={t} onRetry={() => void categories.reload()} />
        ) : null}
        {manage ? <CategoryCreate reload={categories.reload} /> : null}
        {categories.data && categories.data.categories.length === 0 ? (
          <Empty>{t.common.empty}</Empty>
        ) : null}
        {categories.data && categories.data.categories.length > 0 ? (
          <table className="wf-table">
            <thead>
              <tr>
                <th scope="col">{t.common.code}</th>
                <th scope="col">{t.services.nameVi}</th>
                <th scope="col">{t.services.nameEn}</th>
                <th scope="col">{t.services.sortOrder}</th>
                <th scope="col">{t.common.status}</th>
                {manage ? <th scope="col">{t.common.actions}</th> : null}
              </tr>
            </thead>
            <tbody>
              {withoutDeleted(categories.data.categories, removed).map((category) => (
                <tr key={category.id}>
                  <td data-label={t.common.code}>{category.code}</td>
                  <td data-label={t.services.nameVi}>{category.nameVi}</td>
                  <td data-label={t.services.nameEn}>{category.nameEn}</td>
                  <td data-label={t.services.sortOrder}>{category.sortOrder}</td>
                  <td data-label={t.common.status}>
                    <Badge tone={category.isActive ? 'success' : 'neutral'}>
                      {category.isActive ? t.common.active : t.common.inactive}
                    </Badge>
                  </td>
                  {manage ? (
                    <td data-label={t.common.actions}>
                      <div className="wf-row-actions">
                        <CategoryEdit category={category} reload={categories.reload} />
                        <button
                          type="button"
                          className="wf-button wf-button-quiet wf-danger-text"
                          aria-label={`${t.services.delete}: ${locale === 'vi' ? category.nameVi : category.nameEn}`}
                          onClick={() => {
                            setDeletedNotice(null);
                            setTarget({
                              kind: 'category',
                              id: category.id,
                              name: locale === 'vi' ? category.nameVi : category.nameEn,
                              code: category.code,
                              version: category.version,
                            });
                          }}
                        >
                          {t.services.delete}
                        </button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </Section>
      <Section title={t.services.services}>
        {canCreate ? (
          <ServiceCreate categories={categories.data?.categories ?? []} reload={services.reload} />
        ) : null}
        {services.loading ? <Loading t={t} /> : null}
        {services.error ? (
          <ErrorState error={services.error} t={t} onRetry={() => void services.reload()} />
        ) : null}
        {services.data && services.data.services.length === 0 ? (
          <Empty>{t.common.empty}</Empty>
        ) : null}
        {services.data && services.data.services.length > 0 ? (
          <table className="wf-table">
            <thead>
              <tr>
                <th scope="col">{t.common.code}</th>
                <th scope="col">{t.common.name}</th>
                <th scope="col">{t.services.category}</th>
                <th scope="col">{t.services.price}</th>
                <th scope="col">{t.services.estimate}</th>
                <th scope="col">{t.common.status}</th>
                <th scope="col">{t.common.actions}</th>
              </tr>
            </thead>
            <tbody>
              {withoutDeleted(services.data.services, removed).map((service) => (
                <tr key={service.id}>
                  <td data-label={t.common.code}>{service.code}</td>
                  <td data-label={t.common.name}>
                    {locale === 'vi' ? service.nameVi : service.nameEn}
                  </td>
                  <td data-label={t.services.category}>{categoryName(service.categoryId)}</td>
                  <td data-label={t.services.price}>{formatServicePrice(service, t, locale)}</td>
                  <td data-label={t.services.estimate}>
                    {formatEstimate(service.estimatedMinMinutes, service.estimatedMaxMinutes, t)}
                  </td>
                  <td data-label={t.common.status}>
                    <Badge tone={service.isActive ? 'success' : 'neutral'}>
                      {service.isActive ? t.common.active : t.common.inactive}
                    </Badge>
                  </td>
                  <td data-label={t.common.actions}>
                    <div className="wf-row-actions">
                      <Link href={`${base}/services/${service.id}`}>{t.common.details}</Link>
                      {canCreate ? (
                        <button
                          type="button"
                          className="wf-button wf-button-quiet wf-danger-text"
                          aria-label={`${t.services.delete}: ${locale === 'vi' ? service.nameVi : service.nameEn}`}
                          onClick={() => {
                            setDeletedNotice(null);
                            setTarget({
                              kind: 'service',
                              id: service.id,
                              name: locale === 'vi' ? service.nameVi : service.nameEn,
                              code: service.code,
                              version: service.version,
                            });
                          }}
                        >
                          {t.services.delete}
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </Section>
    </>
  );
}

function CategoryCreate({ reload }: { reload: () => Promise<void> }) {
  const { api, t } = useWorkforce();
  const empty = { code: '', nameVi: '', nameEn: '', sortOrder: '0' };
  const [form, setForm] = useState(empty);
  const submit = useSubmit();

  async function save(event: FormEvent) {
    event.preventDefault();
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
          reload,
        ),
      t.services.created,
    );
    if (ok) {
      setForm(empty);
      await reload();
    }
  }

  return (
    <details className="wf-disclosure">
      <summary>{t.services.createCategory}</summary>
      <form className="wf-form" onSubmit={(event) => void save(event)}>
        <div className="wf-row">
          <Field id="cat-code" label={t.common.code} required>
            <input
              id="cat-code"
              required
              maxLength={64}
              value={form.code}
              onChange={(event) => setForm({ ...form, code: event.target.value })}
            />
          </Field>
          <Field id="cat-sort" label={t.services.sortOrder}>
            <input
              id="cat-sort"
              type="number"
              min={0}
              max={100000}
              step={1}
              value={form.sortOrder}
              onChange={(event) => setForm({ ...form, sortOrder: event.target.value })}
            />
          </Field>
        </div>
        <div className="wf-row">
          <Field id="cat-vi" label={t.services.nameVi} required>
            <input
              id="cat-vi"
              required
              maxLength={200}
              value={form.nameVi}
              onChange={(event) => setForm({ ...form, nameVi: event.target.value })}
            />
          </Field>
          <Field id="cat-en" label={t.services.nameEn} required>
            <input
              id="cat-en"
              required
              maxLength={200}
              value={form.nameEn}
              onChange={(event) => setForm({ ...form, nameEn: event.target.value })}
            />
          </Field>
        </div>
        <FormFeedback error={submit.error} success={submit.success} t={t} />
        <SubmitButton
          pending={submit.pending}
          label={t.common.create}
          pendingLabel={t.common.saving}
        />
      </form>
    </details>
  );
}

function CategoryEdit({
  category,
  reload,
}: {
  category: ServiceCategoryResponse;
  reload: () => Promise<void>;
}) {
  const { api, t } = useWorkforce();
  const [form, setForm] = useState({
    nameVi: category.nameVi,
    nameEn: category.nameEn,
    sortOrder: String(category.sortOrder),
    reason: '',
  });
  const submit = useSubmit();
  const id = `cat-${category.id}`;

  async function save(event: FormEvent) {
    event.preventDefault();
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
          reload,
        ),
      t.common.saved,
    );
    if (ok) await reload();
  }

  async function toggle() {
    const ok = await submit.run(
      () =>
        runMutation(
          () =>
            api.post(`/api/v1/service-categories/${category.id}/status`, {
              expectedVersion: category.version,
              isActive: !category.isActive,
              reason: form.reason,
            }),
          reload,
        ),
      t.common.saved,
    );
    if (ok) await reload();
  }

  return (
    <details className="wf-disclosure">
      <summary>{t.common.edit}</summary>
      <form className="wf-inline-form" onSubmit={(event) => void save(event)}>
        <Field id={`${id}-vi`} label={t.services.nameVi} required>
          <input
            id={`${id}-vi`}
            required
            maxLength={200}
            value={form.nameVi}
            onChange={(event) => setForm({ ...form, nameVi: event.target.value })}
          />
        </Field>
        <Field id={`${id}-en`} label={t.services.nameEn} required>
          <input
            id={`${id}-en`}
            required
            maxLength={200}
            value={form.nameEn}
            onChange={(event) => setForm({ ...form, nameEn: event.target.value })}
          />
        </Field>
        <Field id={`${id}-sort`} label={t.services.sortOrder}>
          <input
            id={`${id}-sort`}
            type="number"
            min={0}
            max={100000}
            value={form.sortOrder}
            onChange={(event) => setForm({ ...form, sortOrder: event.target.value })}
          />
        </Field>
        <SubmitButton
          pending={submit.pending}
          label={t.common.save}
          pendingLabel={t.common.saving}
        />
        <Field id={`${id}-reason`} label={t.common.reason}>
          <input
            id={`${id}-reason`}
            maxLength={500}
            value={form.reason}
            onChange={(event) => setForm({ ...form, reason: event.target.value })}
          />
        </Field>
        <button
          type="button"
          className="wf-button wf-button-quiet"
          disabled={submit.pending || form.reason.trim() === ''}
          onClick={() => void toggle()}
        >
          {category.isActive ? t.common.deactivate : t.common.activate}
        </button>
        <FormFeedback error={submit.error} success={submit.success} t={t} />
      </form>
    </details>
  );
}

function ServiceCreate({
  categories,
  reload,
}: {
  categories: readonly ServiceCategoryResponse[];
  reload: () => Promise<void>;
}) {
  const { api, t, locale } = useWorkforce();
  const empty = {
    code: '',
    categoryId: '',
    nameVi: '',
    nameEn: '',
    priceVnd: '',
    priceMaxVnd: '',
    pricingUnit: 'PER_SERVICE' as ServicePricingUnit,
    estimatedMinMinutes: '60',
    estimatedMaxMinutes: '60',
    durationMinutes: '60',
  };
  const [form, setForm] = useState(empty);
  const submit = useSubmit();
  const priceValid = priceProblem(form) === null;
  const durationsValid = durationProblem(form) === null;

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!priceValid || !durationsValid) return;
    const body: ServiceCreateRequest = {
      code: form.code,
      categoryId: form.categoryId,
      nameVi: form.nameVi,
      nameEn: form.nameEn,
      priceVnd: form.priceVnd,
      priceMaxVnd: form.priceMaxVnd,
      pricingUnit: form.pricingUnit,
      ...durationNumbers(form),
    };
    const ok = await submit.run(
      () => runMutation(() => api.post('/api/v1/services', body), reload),
      t.services.created,
    );
    if (ok) {
      setForm(empty);
      await reload();
    }
  }

  if (categories.length === 0) return <Notice tone="info">{t.services.noCategories}</Notice>;
  return (
    <details className="wf-disclosure">
      <summary>{t.services.createService}</summary>
      <form className="wf-form" onSubmit={(event) => void save(event)}>
        <div className="wf-row">
          <Field id="svc-code" label={t.common.code} required>
            <input
              id="svc-code"
              required
              maxLength={64}
              value={form.code}
              onChange={(event) => setForm({ ...form, code: event.target.value })}
            />
          </Field>
          <Field id="svc-category" label={t.services.category} required>
            <select
              id="svc-category"
              required
              value={form.categoryId}
              onChange={(event) => setForm({ ...form, categoryId: event.target.value })}
            >
              <option value="" disabled>
                —
              </option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {locale === 'vi' ? category.nameVi : category.nameEn}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="wf-row">
          <Field id="svc-vi" label={t.services.nameVi} required>
            <input
              id="svc-vi"
              required
              maxLength={200}
              value={form.nameVi}
              onChange={(event) => setForm({ ...form, nameVi: event.target.value })}
            />
          </Field>
          <Field id="svc-en" label={t.services.nameEn} required>
            <input
              id="svc-en"
              required
              maxLength={200}
              value={form.nameEn}
              onChange={(event) => setForm({ ...form, nameEn: event.target.value })}
            />
          </Field>
        </div>
        <div className="wf-row"></div>
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

        <FormFeedback error={submit.error} success={submit.success} t={t} />
        <SubmitButton
          pending={submit.pending}
          label={t.common.create}
          pendingLabel={t.common.saving}
          disabled={!priceValid || !durationsValid}
        />
      </form>
    </details>
  );
}
