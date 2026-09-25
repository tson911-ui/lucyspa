'use client';

import type {
  ServiceCategoryListResponse,
  ServiceResponse,
  ServiceUpdateRequest,
  SkillListResponse,
} from '@lucy-spa/contracts';
import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { durationNumbers, durationProblem } from '../../../lib/workforce/durations';
import { formatServicePrice, priceProblem, type PriceForm } from '../../../lib/workforce/pricing';
import { canAt, canGlobal } from '../../../lib/workforce/permissions';
import { runMutation } from '../../../lib/workforce/workflows';
import { useBranches } from '../data';
import { useAccount, useWorkforce } from '../session';
import { DurationFields } from './service-durations';
import { PriceFields } from './service-price-fields';
import {
  Badge,
  ErrorState,
  Field,
  FormFeedback,
  Loading,
  PageHeader,
  Section,
  SubmitButton,
  useResource,
  useSubmit,
} from '../ui';

/**
 * One service, in three clearly separate parts: master data (GLOBAL MANAGE_SERVICES),
 * price (GLOBAL MANAGE_SERVICE_PRICES, always with a reason) and branch availability
 * (MANAGE_SERVICES for that branch). Eligible skills are part of the master data.
 */
export function ServiceDetailScreen({ id }: { id: string }) {
  const { api, t, base, locale } = useWorkforce();
  const { account } = useAccount();
  const service = useResource(() => api.get<ServiceResponse>(`/api/v1/services/${id}`), [api, id]);
  const manage = canGlobal(account, 'MANAGE_SERVICES');
  const prices = canGlobal(account, 'MANAGE_SERVICE_PRICES');

  return (
    <>
      <p>
        <Link href={`${base}/services`}>← {t.common.back}</Link>
      </p>
      {service.loading && !service.data ? <Loading t={t} /> : null}
      {service.error ? (
        <ErrorState error={service.error} t={t} onRetry={() => void service.reload()} />
      ) : null}
      {service.data ? (
        <>
          <PageHeader
            title={locale === 'vi' ? service.data.nameVi : service.data.nameEn}
            intro={`${service.data.code} · ${formatServicePrice(service.data, t, locale)}`}
          >
            <Badge tone={service.data.isActive ? 'success' : 'neutral'}>
              {service.data.isActive ? t.common.active : t.common.inactive}
            </Badge>
          </PageHeader>
          <MasterData service={service.data} editable={manage} reload={service.reload} />
          <Price service={service.data} editable={prices} reload={service.reload} />
          <Availability service={service.data} reload={service.reload} />
          <EligibleSkills service={service.data} editable={manage} reload={service.reload} />
          {manage ? <ServiceStatus service={service.data} reload={service.reload} /> : null}
        </>
      ) : null}
    </>
  );
}

function MasterData({
  service,
  editable,
  reload,
}: {
  service: ServiceResponse;
  editable: boolean;
  reload: () => Promise<void>;
}) {
  const { api, t, locale } = useWorkforce();
  const categories = useResource(
    () => api.get<ServiceCategoryListResponse>('/api/v1/service-categories'),
    [api],
  );
  const initial = () => ({
    categoryId: service.categoryId,
    nameVi: service.nameVi,
    nameEn: service.nameEn,
    descriptionVi: service.descriptionVi ?? '',
    descriptionEn: service.descriptionEn ?? '',
    durationMinutes: String(service.durationMinutes),
    estimatedMinMinutes: String(service.estimatedMinMinutes),
    estimatedMaxMinutes: String(service.estimatedMaxMinutes),
  });
  const [form, setForm] = useState(initial);
  const submit = useSubmit();
  useEffect(() => setForm(initial()), [service.version]);

  const durationsValid = durationProblem(form) === null;

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!durationsValid) return;
    const text = (value: string) => (value.trim() === '' ? null : value);
    const durations = durationNumbers(form);
    const body: ServiceUpdateRequest = {
      expectedVersion: service.version,
      ...(form.categoryId !== service.categoryId ? { categoryId: form.categoryId } : {}),
      ...(form.nameVi !== service.nameVi ? { nameVi: form.nameVi } : {}),
      ...(form.nameEn !== service.nameEn ? { nameEn: form.nameEn } : {}),
      ...(text(form.descriptionVi) !== service.descriptionVi
        ? { descriptionVi: text(form.descriptionVi) }
        : {}),
      ...(text(form.descriptionEn) !== service.descriptionEn
        ? { descriptionEn: text(form.descriptionEn) }
        : {}),
      // Only changed durations are sent; the API validates the resulting combination.
      ...(durations.durationMinutes !== service.durationMinutes
        ? { durationMinutes: durations.durationMinutes }
        : {}),
      ...(durations.estimatedMinMinutes !== service.estimatedMinMinutes
        ? { estimatedMinMinutes: durations.estimatedMinMinutes }
        : {}),
      ...(durations.estimatedMaxMinutes !== service.estimatedMaxMinutes
        ? { estimatedMaxMinutes: durations.estimatedMaxMinutes }
        : {}),
    };
    const ok = await submit.run(
      () => runMutation(() => api.post(`/api/v1/services/${service.id}`, body), reload),
      t.common.saved,
    );
    if (ok) await reload();
  }

  return (
    <Section title={t.services.master}>
      <form className="wf-form" onSubmit={(event) => void save(event)}>
        <fieldset disabled={!editable} className="wf-fieldset">
          <Field id="sd-category" label={t.services.category} required>
            <select
              id="sd-category"
              value={form.categoryId}
              onChange={(event) => setForm({ ...form, categoryId: event.target.value })}
            >
              {(categories.data?.categories ?? []).map((category) => (
                <option key={category.id} value={category.id}>
                  {locale === 'vi' ? category.nameVi : category.nameEn}
                </option>
              ))}
            </select>
          </Field>
          <div className="wf-row">
            <Field id="sd-vi" label={t.services.nameVi} required>
              <input
                id="sd-vi"
                required
                maxLength={200}
                value={form.nameVi}
                onChange={(event) => setForm({ ...form, nameVi: event.target.value })}
              />
            </Field>
            <Field id="sd-en" label={t.services.nameEn} required>
              <input
                id="sd-en"
                required
                maxLength={200}
                value={form.nameEn}
                onChange={(event) => setForm({ ...form, nameEn: event.target.value })}
              />
            </Field>
          </div>
          <div className="wf-row">
            <Field id="sd-dvi" label={t.services.descriptionVi}>
              <textarea
                id="sd-dvi"
                maxLength={2000}
                value={form.descriptionVi}
                onChange={(event) => setForm({ ...form, descriptionVi: event.target.value })}
              />
            </Field>
            <Field id="sd-den" label={t.services.descriptionEn}>
              <textarea
                id="sd-den"
                maxLength={2000}
                value={form.descriptionEn}
                onChange={(event) => setForm({ ...form, descriptionEn: event.target.value })}
              />
            </Field>
          </div>
          <DurationFields
            idPrefix="sd"
            value={form}
            onChange={(next) => setForm({ ...form, ...next })}
            t={t}
          />
        </fieldset>
        {editable ? (
          <>
            <FormFeedback error={submit.error} success={submit.success} t={t} />
            <SubmitButton
              pending={submit.pending}
              label={t.common.save}
              pendingLabel={t.common.saving}
              disabled={!durationsValid}
            />
          </>
        ) : null}
      </form>
    </Section>
  );
}

function Price({
  service,
  editable,
  reload,
}: {
  service: ServiceResponse;
  editable: boolean;
  reload: () => Promise<void>;
}) {
  const { api, t, locale } = useWorkforce();
  const current = (): PriceForm => ({
    priceVnd: service.priceVnd,
    priceMaxVnd: service.priceMaxVnd,
    pricingUnit: service.pricingUnit,
  });
  const [price, setPrice] = useState<PriceForm>(current);
  const [reason, setReason] = useState('');
  const submit = useSubmit();
  useEffect(() => setPrice(current()), [service.version]);
  const valid = priceProblem(price) === null;
  const changed =
    price.priceVnd !== service.priceVnd ||
    price.priceMaxVnd !== service.priceMaxVnd ||
    price.pricingUnit !== service.pricingUnit;

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!valid || !changed) return;
    const ok = await submit.run(
      () =>
        runMutation(
          () =>
            api.post(`/api/v1/services/${service.id}/price`, {
              expectedVersion: service.version,
              priceVnd: price.priceVnd,
              priceMaxVnd: price.priceMaxVnd,
              pricingUnit: price.pricingUnit,
              reason,
            }),
          reload,
        ),
      t.common.saved,
    );
    if (ok) {
      setReason('');
      await reload();
    }
  }

  return (
    <Section title={t.services.priceSection}>
      <p className="wf-emphasis">{formatServicePrice(service, t, locale)}</p>
      {editable ? (
        <form className="wf-form" onSubmit={(event) => void save(event)}>
          <PriceFields
            idPrefix="price-new"
            value={price}
            onChange={setPrice}
            t={t}
            locale={locale}
          />
          <Field id="price-reason" label={t.services.priceReason} required>
            <input
              id="price-reason"
              required
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
          <FormFeedback error={submit.error} success={submit.success} t={t} />
          <SubmitButton
            pending={submit.pending}
            label={t.services.changePrice}
            pendingLabel={t.common.saving}
            disabled={!valid || !changed || reason.trim() === ''}
          />
        </form>
      ) : null}
    </Section>
  );
}

function Availability({
  service,
  reload,
}: {
  service: ServiceResponse;
  reload: () => Promise<void>;
}) {
  const { api, t } = useWorkforce();
  const { account } = useAccount();
  const branches = useBranches(api);
  const submit = useSubmit();

  async function toggle(branchId: string, isActive: boolean, expectedVersion: number | null) {
    const ok = await submit.run(
      () =>
        runMutation(
          () =>
            api.post(`/api/v1/services/${service.id}/branches/${branchId}`, {
              expectedVersion,
              isActive,
            }),
          reload,
        ),
      t.common.saved,
    );
    if (ok) await reload();
  }

  return (
    <Section title={t.services.availability}>
      {branches.loading ? <Loading t={t} /> : null}
      <FormFeedback error={submit.error} success={submit.success} t={t} />
      <table className="wf-table">
        <thead>
          <tr>
            <th scope="col">{t.common.branch}</th>
            <th scope="col">{t.common.status}</th>
            <th scope="col">{t.common.actions}</th>
          </tr>
        </thead>
        <tbody>
          {[...(branches.data?.values() ?? [])].map((branch) => {
            const entry = service.availability.find((row) => row.branchId === branch.id);
            const offered = entry?.isActive === true;
            return (
              <tr key={branch.id}>
                <td data-label={t.common.branch}>{branch.name}</td>
                <td data-label={t.common.status}>
                  <Badge tone={offered ? 'success' : 'neutral'}>
                    {offered ? t.services.offered : t.services.notOffered}
                  </Badge>
                </td>
                <td data-label={t.common.actions}>
                  {canAt(account, 'MANAGE_SERVICES', branch.id) ? (
                    <button
                      type="button"
                      className="wf-button wf-button-quiet"
                      disabled={submit.pending}
                      onClick={() => void toggle(branch.id, !offered, entry?.version ?? null)}
                    >
                      {offered ? t.services.withdraw : t.services.offer}
                    </button>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Section>
  );
}

function EligibleSkills({
  service,
  editable,
  reload,
}: {
  service: ServiceResponse;
  editable: boolean;
  reload: () => Promise<void>;
}) {
  const { api, t, locale } = useWorkforce();
  const skills = useResource(() => api.get<SkillListResponse>('/api/v1/skills'), [api]);
  const [selected, setSelected] = useState(
    () => new Set(service.eligibleSkills.map((skill) => skill.id)),
  );
  const submit = useSubmit();
  useEffect(
    () => setSelected(new Set(service.eligibleSkills.map((skill) => skill.id))),
    [service.version],
  );

  async function save(event: FormEvent) {
    event.preventDefault();
    const ok = await submit.run(
      () =>
        runMutation(
          () =>
            api.post(`/api/v1/services/${service.id}/skills`, {
              expectedVersion: service.version,
              skillIds: [...selected],
            }),
          reload,
        ),
      t.common.saved,
    );
    if (ok) await reload();
  }

  const options = skills.data?.skills ?? service.eligibleSkills;
  return (
    <Section title={t.services.eligibleSkills}>
      <p className="wf-muted">{t.services.eligibleHint}</p>
      <form onSubmit={(event) => void save(event)}>
        <fieldset className="wf-checklist" disabled={!editable}>
          <legend className="wf-visually-hidden">{t.services.eligibleSkills}</legend>
          {options.map((skill) => (
            <label key={skill.id}>
              <input
                type="checkbox"
                checked={selected.has(skill.id)}
                onChange={(event) => {
                  const next = new Set(selected);
                  if (event.target.checked) next.add(skill.id);
                  else next.delete(skill.id);
                  setSelected(next);
                }}
              />
              {locale === 'vi' ? skill.nameVi : skill.nameEn}{' '}
              <span className="wf-muted wf-small">({skill.code})</span>
              {!skill.isActive ? <Badge tone="neutral">{t.common.inactive}</Badge> : null}
            </label>
          ))}
        </fieldset>
        {editable ? (
          <>
            <FormFeedback error={submit.error} success={submit.success} t={t} />
            <SubmitButton
              pending={submit.pending}
              label={t.services.saveSkills}
              pendingLabel={t.common.saving}
            />
          </>
        ) : null}
      </form>
    </Section>
  );
}

function ServiceStatus({
  service,
  reload,
}: {
  service: ServiceResponse;
  reload: () => Promise<void>;
}) {
  const { api, t } = useWorkforce();
  const [reason, setReason] = useState('');
  const submit = useSubmit();

  async function save(event: FormEvent) {
    event.preventDefault();
    const ok = await submit.run(
      () =>
        runMutation(
          () =>
            api.post(`/api/v1/services/${service.id}/status`, {
              expectedVersion: service.version,
              isActive: !service.isActive,
              reason,
            }),
          reload,
        ),
      t.common.saved,
    );
    if (ok) {
      setReason('');
      await reload();
    }
  }

  return (
    <Section title={t.common.status}>
      <form className="wf-form" onSubmit={(event) => void save(event)}>
        <Field id="svc-status-reason" label={t.common.reason} required>
          <input
            id="svc-status-reason"
            required
            maxLength={500}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
        <FormFeedback error={submit.error} success={submit.success} t={t} />
        <SubmitButton
          pending={submit.pending}
          label={service.isActive ? t.common.deactivate : t.common.activate}
          pendingLabel={t.common.saving}
          tone={service.isActive ? 'danger' : 'primary'}
          disabled={reason.trim() === ''}
        />
      </form>
    </Section>
  );
}
