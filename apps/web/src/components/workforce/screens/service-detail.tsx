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
  ConfirmDialog,
  DataTable,
  DescriptionList,
  Field,
  FormActions,
  FormDialog,
  FormDrawer,
  FormGrid,
  FormSection,
  ListSection,
  PageHeader as UiPageHeader,
  RowActions,
  Select,
  Stack,
  Tabs,
  Textarea,
  TextInput,
  useUnsavedChangesGuard,
  useUrlState,
  type DataTableColumn,
  type MenuItem,
} from '@lucy-spa/ui';
import { ListCrumbLink } from '../link';
import { useState } from 'react';
import { fill } from '../../../i18n/workforce';
import { organizationDictionary } from '../../../i18n/organization';
import { durationNumbers, durationProblem, formatEstimate } from '../../../lib/workforce/durations';
import { confirmError, formOverlayLabels } from '../../../lib/workforce/form-labels';
import { canAt, canGlobal } from '../../../lib/workforce/permissions';
import {
  formatServicePrice,
  maxQuantityBody,
  priceProblem,
  quantityProblem,
  type PriceForm,
} from '../../../lib/workforce/pricing';
import {
  contentChanges,
  contentDirty,
  contentOf,
  contentProblem,
  type ServiceContentForm,
} from '../../../lib/workforce/service-content';
import { localizedName } from '../../../lib/workforce/services-list';
import { runMutation } from '../../../lib/workforce/workflows';
import { opensInput } from '../../../lib/workforce/opens-input';
import { useBranches } from '../data';
import { useAccount, useWorkforce } from '../session';
import { MediaPhotoField } from './media-photo-field';
import { ServiceContentFields } from './service-content-fields';
import { DurationFields } from './service-durations';
import { PriceFields, focusFirstInvalidSoon } from './service-price-fields';
import { StatusConfirm } from './services';
import {
  Badge,
  Button,
  Empty,
  ErrorState,
  Loading,
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
  if (!service.data) return <Loading t={t} page />;
  return <ServiceDetail service={service.data} reload={service.reload} />;
}

type TabId = 'overview' | 'branches' | 'skills';
type Overlay = 'edit' | 'price' | 'status';
const TAB_IDS: readonly TabId[] = ['overview', 'branches', 'skills'];
const TAB_DEFAULTS = { tab: 'overview' };
const normalizeTab = (state: typeof TAB_DEFAULTS) => ({
  tab: (TAB_IDS as readonly string[]).includes(state.tab) ? state.tab : 'overview',
});
const TAB_OPTIONS = { normalize: normalizeTab };

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
  // The open tab lives in the address bar (reload, back and a shared link keep it).
  const [view, updateView] = useUrlState(TAB_DEFAULTS, TAB_OPTIONS);
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
          label: opensInput(service.isActive ? t.common.deactivate : t.common.activate),
          ...(service.isActive ? { tone: 'danger' as const } : {}),
          onSelect: () => setOverlay('status'),
        },
      ]
    : [];

  return (
    <>
      {/* The status is the kit header's status slot under the title (never inside the heading); the subtitle is the code only
          (no "code · price" meta string: the price has its own card). */}
      <UiPageHeader
        title={name}
        description={service.code}
        status={
          <Badge tone={service.isActive ? 'success' : 'neutral'}>
            {service.isActive ? t.common.active : t.common.inactive}
          </Badge>
        }
        breadcrumbs={
          <Breadcrumbs
            label={text.breadcrumbs}
            LinkComponent={ListCrumbLink}
            items={[{ label: t.services.title, href: `${base}/services` }, { label: name }]}
          />
        }
        actions={
          menu.length > 0 || manage ? (
            <>
              {menu.length > 0 ? <RowActions menuLabel={text.moreActions} items={menu} /> : null}
              {manage ? (
                <Button variant="primary" icon="edit" onClick={() => setOverlay('edit')}>
                  {t.services.editService}
                </Button>
              ) : null}
            </>
          ) : undefined
        }
      />
      <Tabs
        label={t.services.tabsLabel}
        value={view.tab}
        onChange={(id) => updateView({ tab: id })}
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
            // Keyed by the version: a saved change remounts the form with the new selection (no effect copying props).
            panel: (
              <EligibleSkills
                key={service.version}
                service={service}
                editable={manage}
                reload={reload}
              />
            ),
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
          {
            label: t.services.photoSection,
            value: service.photoMediaId ? t.services.photoPreview : t.services.photoNone,
          },
          { label: t.services.includedVi, value: service.includedVi.join('; ') || null },
          { label: t.services.includedEn, value: service.includedEn.join('; ') || null },
          { label: t.services.stepsVi, value: service.stepsVi.join('; ') || null },
          { label: t.services.stepsEn, value: service.stepsEn.join('; ') || null },
          {
            label: t.services.faqVi,
            value: service.faqVi.map((row) => row.question).join('; ') || null,
          },
          {
            label: t.services.faqEn,
            value: service.faqEn.map((row) => row.question).join('; ') || null,
          },
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
  const [content, setContent] = useState<ServiceContentForm>(() => contentOf(service));
  const [photoMediaId, setPhotoMediaId] = useState(service.photoMediaId ?? '');
  const submit = useSubmit();
  const photoChanged = photoMediaId !== (service.photoMediaId ?? '');
  const dirty =
    (Object.keys(initial) as Array<keyof typeof initial>).some(
      (key) => form[key] !== initial[key],
    ) ||
    contentDirty(content, service) ||
    photoChanged;
  const durationsValid = durationProblem(form) === null;
  const contentValid = contentProblem(content) === null;
  const namesValid = form.nameVi.trim() !== '' && form.nameEn.trim() !== '';
  // Validate on submit: the button stays enabled, each problem shows at its field and the first one takes focus.
  const [checked, setChecked] = useState(false);
  const nameError = (value: string) =>
    checked && value.trim() === '' ? t.common.form.fieldRequired : undefined;

  async function save() {
    if (!dirty) {
      onClose();
      return;
    }
    if (!durationsValid || !contentValid || !namesValid) {
      setChecked(true);
      focusFirstInvalidSoon();
      return;
    }
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
      ...contentChanges(content, service),
      ...(photoChanged ? { photoMediaId: photoMediaId === '' ? null : photoMediaId } : {}),
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
      title={t.services.editServiceTitle}
      labels={formOverlayLabels(t, t.common.save)}
      busy={submit.pending}
      dirty={dirty}
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
        <Field label={t.services.nameVi} required error={nameError(form.nameVi)}>
          {(control) => (
            <TextInput
              {...control}
              name="nameVi"
              maxLength={200}
              value={form.nameVi}
              onChange={(event) => setForm({ ...form, nameVi: event.target.value })}
            />
          )}
        </Field>
        <Field label={t.services.nameEn} required error={nameError(form.nameEn)}>
          {(control) => (
            <TextInput
              {...control}
              name="nameEn"
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
              name="descriptionVi"
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
              name="descriptionEn"
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
        showErrors={checked}
      />
      <FormSection title={t.services.photoSection} description={t.services.photoHint}>
        <MediaPhotoField mediaId={photoMediaId} onChange={setPhotoMediaId} />
      </FormSection>
      <ServiceContentFields value={content} onChange={setContent} />
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

  const [checked, setChecked] = useState(false);

  async function save() {
    // Validate on submit: nothing changed closes; a problem shows at its field and the first one takes focus.
    if (!changed) {
      onClose();
      return;
    }
    if (!valid || reason.trim() === '') {
      setChecked(true);
      focusFirstInvalidSoon();
      return;
    }
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
      title={t.services.changePriceTitle}
      size="lg"
      labels={formOverlayLabels(t, t.common.save)}
      busy={submit.pending}
      dirty={changed || reason !== ''}
      error={submit.error ? <ErrorState error={submit.error} t={t} /> : undefined}
      onClose={onClose}
      onSubmit={save}
    >
      <PriceFields
        idPrefix="price-new"
        value={price}
        onChange={setPrice}
        t={t}
        locale={locale}
        showErrors={checked}
      />
      <FormGrid>
        <Field
          label={t.services.priceReason}
          required
          error={checked && reason.trim() === '' ? t.common.form.reasonRequired : undefined}
        >
          {(control) => (
            <TextInput
              {...control}
              name="reason"
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
  const notify = useSuccessToast();
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
  const versionAt = (branchId: string) =>
    service.availability.find((row) => row.branchId === branchId)?.version ?? null;
  const [withdrawing, setWithdrawing] = useState<BranchSummary | null>(null);
  const columns: DataTableColumn<BranchSummary>[] = [
    {
      key: 'name',
      header: t.common.branch,
      mobileTitle: true,
      wrap: true,
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
                    // Offering posts at once; withdrawing stops bookings there, so it asks first (wig: destructive
                    // action from a row menu needs a confirmation).
                    offered(branch)
                      ? {
                          id: 'toggle',
                          label: t.services.withdraw,
                          tone: 'danger' as const,
                          disabled: submit.pending,
                          onSelect: () => setWithdrawing(branch),
                        }
                      : {
                          id: 'toggle',
                          label: t.services.offer,
                          disabled: submit.pending,
                          onSelect: () => void toggle(branch.id, true, versionAt(branch.id)),
                        },
                  ]}
                />
              ) : null,
          },
        ]
      : []),
  ];

  return (
    <ListSection title={t.services.availability}>
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
      {withdrawing ? (
        <ConfirmDialog
          title={t.services.withdrawTitle}
          description={fill(t.services.withdrawBody, { branch: withdrawing.name })}
          tone="danger"
          confirmLabel={t.services.withdraw}
          busyLabel={t.common.deactivating}
          cancelLabel={t.common.cancel}
          referenceLabel={t.errors.reference}
          describeError={confirmError(t)}
          onCancel={() => setWithdrawing(null)}
          onConfirm={async () => {
            const outcome = await runMutation(
              () =>
                api.post(`/api/v1/services/${service.id}/branches/${withdrawing.id}`, {
                  expectedVersion: versionAt(withdrawing.id),
                  isActive: false,
                }),
              reload,
            );
            if (!outcome.ok) throw outcome.error;
            await reload();
            setWithdrawing(null);
            notify(t.common.saved);
          }}
        />
      ) : null}
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
  const dirty =
    selected.size !== initial.length || initial.some((skillId) => !selected.has(skillId));
  // Leaving the page with an unsaved selection asks first.
  useUnsavedChangesGuard(dirty && !submit.pending);

  async function save() {
    // Nothing changed: nothing to send (the button is never disabled to signal that).
    if (!dirty) return;
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
                <Button type="submit" variant="primary" loading={submit.pending}>
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
