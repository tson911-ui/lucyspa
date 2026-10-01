'use client';

import type {
  BranchSummary,
  ServiceCategoryListResponse,
  ServiceResponse,
  ServiceUpdateRequest,
  SkillListResponse,
} from '@lucy-spa/contracts';
import {
  Breadcrumbs,
  CheckField,
  Cluster,
  DataTable,
  DescriptionList,
  Field,
  FormActions,
  FormDialog,
  FormDrawer,
  FormGrid,
  ListSection,
  RowActions,
  Select,
  Stack,
  Tabs,
  Textarea,
  TextInput,
  type DataTableColumn,
  type MenuItem,
} from '@lucy-spa/ui';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { fill } from '../../../i18n/workforce';
import { organizationDictionary } from '../../../i18n/organization';
import { durationNumbers, durationProblem, formatEstimate } from '../../../lib/workforce/durations';
import { formOverlayLabels } from '../../../lib/workforce/form-labels';
import { canAt, canGlobal } from '../../../lib/workforce/permissions';
import {
  formatServicePrice,
  maxQuantityBody,
  priceProblem,
  quantityProblem,
  type PriceForm,
} from '../../../lib/workforce/pricing';
import { localizedName } from '../../../lib/workforce/services-list';
import { runMutation } from '../../../lib/workforce/workflows';
import { useBranches } from '../data';
import { useAccount, useWorkforce } from '../session';
import { DurationFields } from './service-durations';
import { PriceFields } from './service-price-fields';
import { StatusConfirm } from './services';
import {
  Badge,
  Button,
  Empty,
  ErrorState,
  Loading,
  PageHeader,
  Section,
  useResource,
  useSubmit,
  useSuccessToast,
} from '../ui';

/**
 * One service: an Overview tab (master data and price, each with its own edit action), the branch
 * availability and the eligible skills. Master data needs GLOBAL MANAGE_SERVICES, a price change
 * GLOBAL MANAGE_SERVICE_PRICES (always with a reason), availability MANAGE_SERVICES for that branch.
 * Edit opens a drawer (8 fields), the price a dialog, (de)activation a confirmation with a reason.
 */
export function ServiceDetailScreen({ id }: { id: string }) {
  const { api, t } = useWorkforce();
  const service = useResource(() => api.get<ServiceResponse>(`/api/v1/services/${id}`), [api, id]);
  if (service.error && !service.data) {
    return <ErrorState error={service.error} t={t} onRetry={() => void service.reload()} />;
  }
  if (!service.data) return <Loading t={t} />;
  return <ServiceDetail service={service.data} reload={service.reload} />;
}

type TabId = 'overview' | 'branches' | 'skills';
type Overlay = 'edit' | 'price' | 'status';

function ServiceDetail({
  service,
  reload,
}: {
  service: ServiceResponse;
  reload: () => Promise<void>;
}) {
  const { t, locale, base } = useWorkforce();
  const { account } = useAccount();
  const notify = useSuccessToast();
  const text = organizationDictionary(locale);
  const manage = canGlobal(account, 'MANAGE_SERVICES');
  const prices = canGlobal(account, 'MANAGE_SERVICE_PRICES');
  const [tab, setTab] = useState<TabId>('overview');
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const name = localizedName(service, locale);

  /** After a successful change: close the overlay and say what happened (the data was reloaded first). */
  const finish = (message: string) => {
    setOverlay(null);
    notify(message);
  };
  const menu: MenuItem[] = manage
    ? [
        {
          id: 'status',
          label: service.isActive ? t.common.deactivate : t.common.activate,
          ...(service.isActive ? { tone: 'danger' as const } : {}),
          onSelect: () => setOverlay('status'),
        },
      ]
    : [];

  return (
    <>
      <PageHeader
        title={name}
        intro={`${service.code} · ${formatServicePrice(service, t, locale)}`}
        breadcrumbs={
          <Breadcrumbs
            label={text.breadcrumbs}
            LinkComponent={Link}
            items={[{ label: t.services.title, href: `${base}/services` }, { label: name }]}
          />
        }
      >
        {menu.length > 0 ? <RowActions menuLabel={text.moreActions} items={menu} /> : null}
        {manage ? (
          <Button variant="primary" icon="edit" onClick={() => setOverlay('edit')}>
            {t.services.editService}
          </Button>
        ) : null}
      </PageHeader>
      <Cluster gap="inline">
        <span className="ls-hint">{t.common.status}:</span>
        <Badge tone={service.isActive ? 'success' : 'neutral'}>
          {service.isActive ? t.common.active : t.common.inactive}
        </Badge>
      </Cluster>
      <Tabs
        label={t.services.tabsLabel}
        value={tab}
        onChange={(id) => setTab(id as TabId)}
        tabs={[
          {
            id: 'overview',
            label: t.services.tabOverview,
            panel: (
              <Stack gap="page">
                <MasterData service={service} />
                <Price service={service} editable={prices} onEdit={() => setOverlay('price')} />
              </Stack>
            ),
          },
          {
            id: 'branches',
            label: t.services.tabBranches,
            panel: <Availability service={service} reload={reload} />,
          },
          {
            id: 'skills',
            label: t.services.tabSkills,
            panel: <EligibleSkills service={service} editable={manage} reload={reload} />,
          },
        ]}
      />
      {overlay === 'edit' ? (
        <ServiceEdit
          service={service}
          reload={reload}
          onClose={() => setOverlay(null)}
          onDone={finish}
        />
      ) : null}
      {overlay === 'price' ? (
        <PriceDialog
          service={service}
          reload={reload}
          onClose={() => setOverlay(null)}
          onDone={finish}
        />
      ) : null}
      {overlay === 'status' ? (
        <StatusConfirm
          kind="service"
          record={service}
          onClose={() => setOverlay(null)}
          onChanged={reload}
          onDone={() => finish(t.common.saved)}
        />
      ) : null}
    </>
  );
}

function MasterData({ service }: { service: ServiceResponse }) {
  const { api, t, locale } = useWorkforce();
  const categories = useResource(
    () => api.get<ServiceCategoryListResponse>('/api/v1/service-categories'),
    [api],
  );
  const category = categories.data?.categories.find((entry) => entry.id === service.categoryId);
  return (
    <Section title={t.services.master}>
      <DescriptionList
        columns={2}
        items={[
          { label: t.common.code, value: service.code },
          {
            label: t.services.category,
            value: category ? localizedName(category, locale) : null,
          },
          { label: t.services.nameVi, value: service.nameVi },
          { label: t.services.nameEn, value: service.nameEn },
          { label: t.services.descriptionVi, value: service.descriptionVi },
          { label: t.services.descriptionEn, value: service.descriptionEn },
          {
            label: t.services.estimate,
            value: formatEstimate(service.estimatedMinMinutes, service.estimatedMaxMinutes, t),
          },
          { label: t.services.duration, value: service.durationMinutes },
        ]}
      />
    </Section>
  );
}

function Price({
  service,
  editable,
  onEdit,
}: {
  service: ServiceResponse;
  editable: boolean;
  onEdit: () => void;
}) {
  const { t, locale } = useWorkforce();
  return (
    <Section
      title={t.services.priceSection}
      actions={
        editable ? (
          <Button variant="secondary" icon="edit" onClick={onEdit}>
            {t.services.changePrice}
          </Button>
        ) : undefined
      }
    >
      <DescriptionList
        columns={2}
        items={[
          { label: t.services.price, value: formatServicePrice(service, t, locale) },
          { label: t.services.pricingUnit, value: t.services.pricingUnits[service.pricingUnit] },
          ...(service.pricingUnit === 'PER_NAIL'
            ? [{ label: t.services.maxQuantity, value: service.maxQuantity }]
            : []),
        ]}
      />
    </Section>
  );
}

type Done = (message: string) => void;

/** Master data (8 fields, a medium form): only the changed fields are sent. */
function ServiceEdit({
  service,
  reload,
  onClose,
  onDone,
}: {
  service: ServiceResponse;
  reload: () => Promise<void>;
  onClose: () => void;
  onDone: Done;
}) {
  const { api, t, locale } = useWorkforce();
  const categories = useResource(
    () => api.get<ServiceCategoryListResponse>('/api/v1/service-categories'),
    [api],
  );
  const initial = {
    categoryId: service.categoryId,
    nameVi: service.nameVi,
    nameEn: service.nameEn,
    descriptionVi: service.descriptionVi ?? '',
    descriptionEn: service.descriptionEn ?? '',
    durationMinutes: String(service.durationMinutes),
    estimatedMinMinutes: String(service.estimatedMinMinutes),
    estimatedMaxMinutes: String(service.estimatedMaxMinutes),
  };
  const [form, setForm] = useState(initial);
  const submit = useSubmit();
  const dirty = (Object.keys(initial) as Array<keyof typeof initial>).some(
    (key) => form[key] !== initial[key],
  );
  const durationsValid = durationProblem(form) === null;

  async function save() {
    if (!durationsValid || !dirty) return;
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
      '',
    );
    if (ok) {
      await reload();
      onDone(t.common.saved);
    }
  }

  return (
    <FormDrawer
      title={t.services.editService}
      labels={formOverlayLabels(t, t.common.save)}
      busy={submit.pending}
      dirty={dirty}
      submitDisabled={!dirty || !durationsValid || !form.nameVi.trim() || !form.nameEn.trim()}
      error={submit.error ? <ErrorState error={submit.error} t={t} /> : undefined}
      onClose={onClose}
      onSubmit={save}
    >
      <FormGrid cols={2}>
        <Field label={t.services.category} required full>
          {(control) => (
            <Select
              {...control}
              value={form.categoryId}
              options={(categories.data?.categories ?? []).map((category) => ({
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
        <Field label={t.services.descriptionVi}>
          {(control) => (
            <Textarea
              {...control}
              maxLength={2000}
              value={form.descriptionVi}
              onChange={(event) => setForm({ ...form, descriptionVi: event.target.value })}
            />
          )}
        </Field>
        <Field label={t.services.descriptionEn}>
          {(control) => (
            <Textarea
              {...control}
              maxLength={2000}
              value={form.descriptionEn}
              onChange={(event) => setForm({ ...form, descriptionEn: event.target.value })}
            />
          )}
        </Field>
      </FormGrid>
      <DurationFields
        idPrefix="sd"
        value={form}
        onChange={(next) => setForm({ ...form, ...next })}
        t={t}
      />
    </FormDrawer>
  );
}

/** The price command: new price, unit and limit plus the reason that is always required. */
function PriceDialog({
  service,
  reload,
  onClose,
  onDone,
}: {
  service: ServiceResponse;
  reload: () => Promise<void>;
  onClose: () => void;
  onDone: Done;
}) {
  const { api, t, locale } = useWorkforce();
  const initial: PriceForm = {
    priceVnd: service.priceVnd,
    priceMaxVnd: service.priceMaxVnd,
    pricingUnit: service.pricingUnit,
    maxQuantity: String(service.maxQuantity),
  };
  const [price, setPrice] = useState<PriceForm>(initial);
  const [reason, setReason] = useState('');
  const submit = useSubmit();
  const valid = priceProblem(price) === null && quantityProblem(price) === null;
  // A PER_SERVICE limit is always 1, so only a PER_NAIL limit counts as a change.
  const changed =
    price.priceVnd !== service.priceVnd ||
    price.priceMaxVnd !== service.priceMaxVnd ||
    price.pricingUnit !== service.pricingUnit ||
    (price.pricingUnit === 'PER_NAIL' && price.maxQuantity !== String(service.maxQuantity));

  async function save() {
    if (!valid || !changed || reason.trim() === '') return;
    const ok = await submit.run(
      () =>
        runMutation(
          () =>
            api.post(`/api/v1/services/${service.id}/price`, {
              expectedVersion: service.version,
              priceVnd: price.priceVnd,
              priceMaxVnd: price.priceMaxVnd,
              pricingUnit: price.pricingUnit,
              ...maxQuantityBody(price),
              reason,
            }),
          reload,
        ),
      '',
    );
    if (ok) {
      await reload();
      onDone(t.common.saved);
    }
  }

  return (
    <FormDialog
      title={t.services.changePrice}
      size="lg"
      labels={formOverlayLabels(t, t.common.save)}
      busy={submit.pending}
      dirty={changed || reason !== ''}
      submitDisabled={!valid || !changed || reason.trim() === ''}
      error={submit.error ? <ErrorState error={submit.error} t={t} /> : undefined}
      onClose={onClose}
      onSubmit={save}
    >
      <PriceFields idPrefix="price-new" value={price} onChange={setPrice} t={t} locale={locale} />
      <FormGrid>
        <Field label={t.services.priceReason} required>
          {(control) => (
            <TextInput
              {...control}
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          )}
        </Field>
      </FormGrid>
    </FormDialog>
  );
}

/** Branch availability: one row per visible branch, the `⋮` menu offers or withdraws the service there. */
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
  const rows = [...(branches.data?.values() ?? [])];
  const canToggle = rows.some((branch) => canAt(account, 'MANAGE_SERVICES', branch.id));

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

  const offered = (branch: BranchSummary) =>
    service.availability.find((row) => row.branchId === branch.id)?.isActive === true;
  const columns: DataTableColumn<BranchSummary>[] = [
    {
      key: 'name',
      header: t.common.branch,
      mobileTitle: true,
      truncate: true,
      width: 'lg',
      cell: (branch) => branch.name,
    },
    {
      key: 'status',
      header: t.common.status,
      cell: (branch) => (
        <Badge tone={offered(branch) ? 'success' : 'neutral'}>
          {offered(branch) ? t.services.offered : t.services.notOffered}
        </Badge>
      ),
    },
    ...(canToggle
      ? [
          {
            key: 'actions',
            header: t.common.actions,
            actions: true,
            cell: (branch: BranchSummary) =>
              canAt(account, 'MANAGE_SERVICES', branch.id) ? (
                <RowActions
                  menuLabel={fill(t.common.list.actionsFor, { name: branch.name })}
                  items={[
                    {
                      id: 'toggle',
                      label: offered(branch) ? t.services.withdraw : t.services.offer,
                      disabled: submit.pending,
                      onSelect: () =>
                        void toggle(
                          branch.id,
                          !offered(branch),
                          service.availability.find((row) => row.branchId === branch.id)?.version ??
                            null,
                        ),
                    },
                  ]}
                />
              ) : null,
          },
        ]
      : []),
  ];

  return (
    <ListSection title={t.services.availability} count={rows.length}>
      {submit.error ? <ErrorState error={submit.error} t={t} /> : null}
      <DataTable
        mode="client"
        caption={fill(t.common.list.table, { list: t.services.availability })}
        columns={columns}
        rows={rows}
        rowKey={(branch) => branch.id}
        loading={branches.loading && !branches.data}
        loadingLabel={t.common.loading}
        empty={branches.data ? <Empty>{t.common.empty}</Empty> : undefined}
        paging={{ off: 'A salon runs a handful of branches: the list is the branch count.' }}
      />
    </ListSection>
  );
}

/** Skills that qualify an employee for the service (any one is enough). */
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
  const initial = service.eligibleSkills.map((skill) => skill.id);
  const [selected, setSelected] = useState(() => new Set(initial));
  const submit = useSubmit();
  useEffect(() => setSelected(new Set(initial)), [service.version]);
  const dirty =
    selected.size !== initial.length || initial.some((skillId) => !selected.has(skillId));

  async function save() {
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
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <Stack gap="block">
          <p className="ls-hint">{t.services.eligibleHint}</p>
          {submit.error ? <ErrorState error={submit.error} t={t} /> : null}
          {options.length === 0 ? (
            <Empty>{t.services.noEligibleSkills}</Empty>
          ) : (
            <div role="group" aria-label={t.services.eligibleSkills}>
              {options.map((skill) => (
                <CheckField
                  key={skill.id}
                  checked={selected.has(skill.id)}
                  disabled={!editable}
                  onChange={(event) => {
                    const next = new Set(selected);
                    if (event.target.checked) next.add(skill.id);
                    else next.delete(skill.id);
                    setSelected(next);
                  }}
                  label={
                    <span>
                      {locale === 'vi' ? skill.nameVi : skill.nameEn}{' '}
                      <span className="ls-hint">({skill.code})</span>{' '}
                      {!skill.isActive ? <Badge tone="neutral">{t.common.inactive}</Badge> : null}
                    </span>
                  }
                />
              ))}
            </div>
          )}
          {editable ? (
            <FormActions
              primary={
                <Button type="submit" variant="primary" loading={submit.pending} disabled={!dirty}>
                  {submit.pending ? t.common.saving : t.services.saveSkills}
                </Button>
              }
            />
          ) : null}
        </Stack>
      </form>
    </Section>
  );
}
