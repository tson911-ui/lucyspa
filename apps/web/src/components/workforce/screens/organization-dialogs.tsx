'use client';

import type {
  EmployeeDirectoryResponse,
  OrganizationAppointment,
  OrganizationArea,
  OrganizationBranch,
  OrganizationLevel,
  OrganizationRegion,
  OrganizationSnapshotResponse,
} from '@lucy-spa/contracts';
import {
  Combobox,
  ConfirmDialog,
  Field,
  FormDialog,
  FormGrid,
  Select,
  TextInput,
} from '@lucy-spa/ui';
import { useEffect, useState } from 'react';
import { organizationDictionary } from '../../../i18n/organization';
import { confirmError, formOverlayLabels } from '../../../lib/workforce/form-labels';
import { resultsText } from '../../../lib/workforce/list-view';
import {
  appointmentScope,
  formatScope,
  ORG_LEVELS,
} from '../../../lib/workforce/organization-list';
import { runMutation } from '../../../lib/workforce/workflows';
import { useWorkforce } from '../session';
import { ErrorState, useResource, useSubmit } from '../ui';

/**
 * Dialogs of the Organization screen. Each is mounted only while open (so its fields reset on
 * close), saves with one request, and calls `onSaved` after the list has been reloaded. A reason is
 * required on every change, as before.
 */

type Saved = () => Promise<void>;

function ReasonField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { t } = useWorkforce();
  return (
    <Field label={t.common.reason} required>
      {(control) => (
        <TextInput
          {...control}
          maxLength={500}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </Field>
  );
}

/** Shared frame: submit state, dirty guard, error line. `save` returns the request to send. */
function useOrgForm(onSaved: Saved) {
  const { t } = useWorkforce();
  const submit = useSubmit();
  async function send(request: () => Promise<unknown>) {
    const ok = await submit.run(() => runMutation(request, onSaved), '');
    if (ok) await onSaved();
  }
  const error = submit.error ? <ErrorState error={submit.error} t={t} /> : undefined;
  return { submit, send, error };
}

export function RegionCreate({ onClose, onSaved }: { onClose: () => void; onSaved: Saved }) {
  const { api, t, locale } = useWorkforce();
  const text = organizationDictionary(locale);
  const [form, setForm] = useState({ code: '', name: '', reason: '' });
  const { submit, send, error } = useOrgForm(onSaved);
  return (
    <FormDialog
      title={text.createRegion}
      labels={formOverlayLabels(t, t.common.create)}
      busy={submit.pending}
      dirty={form.code !== '' || form.name !== '' || form.reason !== ''}
      submitDisabled={!form.code.trim() || !form.name.trim() || !form.reason.trim()}
      error={error}
      onClose={onClose}
      onSubmit={() => send(() => api.post('/api/v1/organization/regions', form))}
    >
      <FormGrid>
        <Field label={t.common.code} required width="md">
          {(control) => (
            <TextInput
              {...control}
              maxLength={64}
              value={form.code}
              onChange={(event) => setForm({ ...form, code: event.target.value })}
            />
          )}
        </Field>
        <Field label={t.common.name} required>
          {(control) => (
            <TextInput
              {...control}
              maxLength={150}
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          )}
        </Field>
        <ReasonField value={form.reason} onChange={(reason) => setForm({ ...form, reason })} />
      </FormGrid>
    </FormDialog>
  );
}

export function RegionRename({
  region,
  onClose,
  onSaved,
}: {
  region: OrganizationRegion;
  onClose: () => void;
  onSaved: Saved;
}) {
  const { api, t, locale } = useWorkforce();
  const text = organizationDictionary(locale);
  const [name, setName] = useState(region.name);
  const [reason, setReason] = useState('');
  const { submit, send, error } = useOrgForm(onSaved);
  const changed = name.trim() !== '' && name !== region.name;
  return (
    <FormDialog
      title={`${text.renameRegion}: ${region.code}`}
      labels={formOverlayLabels(t, t.common.save)}
      busy={submit.pending}
      dirty={name !== region.name || reason !== ''}
      submitDisabled={!changed || !reason.trim()}
      error={error}
      onClose={onClose}
      onSubmit={() =>
        send(() =>
          api.post(`/api/v1/organization/regions/${region.id}`, {
            name,
            expectedVersion: region.version,
            reason,
          }),
        )
      }
    >
      <FormGrid>
        <Field label={t.common.name} required>
          {(control) => (
            <TextInput
              {...control}
              maxLength={150}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          )}
        </Field>
        <ReasonField value={reason} onChange={setReason} />
      </FormGrid>
    </FormDialog>
  );
}

function regionOptions(regions: readonly OrganizationRegion[], keep?: string) {
  return regions
    .filter((region) => region.isActive || region.id === keep)
    .map((region) => ({ value: region.id, label: `${region.name} (${region.code})` }));
}

export function AreaCreate({
  regions,
  onClose,
  onSaved,
}: {
  regions: readonly OrganizationRegion[];
  onClose: () => void;
  onSaved: Saved;
}) {
  const { api, t, locale } = useWorkforce();
  const text = organizationDictionary(locale);
  const [form, setForm] = useState({ regionId: '', code: '', name: '', reason: '' });
  const { submit, send, error } = useOrgForm(onSaved);
  return (
    <FormDialog
      title={text.createArea}
      labels={formOverlayLabels(t, t.common.create)}
      busy={submit.pending}
      dirty={Object.values(form).some((value) => value !== '')}
      submitDisabled={
        !form.regionId || !form.code.trim() || !form.name.trim() || !form.reason.trim()
      }
      error={error}
      onClose={onClose}
      onSubmit={() => send(() => api.post('/api/v1/organization/areas', form))}
    >
      <FormGrid>
        <Field label={text.region} required>
          {(control) => (
            <Select
              {...control}
              placeholder={text.choose}
              value={form.regionId}
              onChange={(event) => setForm({ ...form, regionId: event.target.value })}
              options={regionOptions(regions)}
            />
          )}
        </Field>
        <Field label={t.common.code} required width="md">
          {(control) => (
            <TextInput
              {...control}
              maxLength={64}
              value={form.code}
              onChange={(event) => setForm({ ...form, code: event.target.value })}
            />
          )}
        </Field>
        <Field label={t.common.name} required>
          {(control) => (
            <TextInput
              {...control}
              maxLength={150}
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          )}
        </Field>
        <ReasonField value={form.reason} onChange={(reason) => setForm({ ...form, reason })} />
      </FormGrid>
    </FormDialog>
  );
}

export function AreaEdit({
  area,
  regions,
  onClose,
  onSaved,
}: {
  area: OrganizationArea;
  regions: readonly OrganizationRegion[];
  onClose: () => void;
  onSaved: Saved;
}) {
  const { api, t, locale } = useWorkforce();
  const text = organizationDictionary(locale);
  const [name, setName] = useState(area.name);
  const [regionId, setRegionId] = useState(area.regionId);
  const [reason, setReason] = useState('');
  const { submit, send, error } = useOrgForm(onSaved);
  const changed = name !== area.name || regionId !== area.regionId;
  return (
    <FormDialog
      title={`${text.editArea}: ${area.code}`}
      labels={formOverlayLabels(t, t.common.save)}
      busy={submit.pending}
      dirty={changed || reason !== ''}
      submitDisabled={!changed || !name.trim() || !reason.trim()}
      error={error}
      onClose={onClose}
      onSubmit={() =>
        send(() =>
          api.post(`/api/v1/organization/areas/${area.id}`, {
            name,
            regionId,
            expectedVersion: area.version,
            reason,
          }),
        )
      }
    >
      <FormGrid>
        <Field label={t.common.name} required>
          {(control) => (
            <TextInput
              {...control}
              maxLength={150}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          )}
        </Field>
        <Field label={text.region} required>
          {(control) => (
            <Select
              {...control}
              value={regionId}
              onChange={(event) => setRegionId(event.target.value)}
              options={regionOptions(regions, area.regionId)}
            />
          )}
        </Field>
        <ReasonField value={reason} onChange={setReason} />
      </FormGrid>
    </FormDialog>
  );
}

export function BranchPlacement({
  branch,
  areas,
  onClose,
  onSaved,
}: {
  branch: OrganizationBranch;
  areas: readonly OrganizationArea[];
  onClose: () => void;
  onSaved: Saved;
}) {
  const { api, t, locale } = useWorkforce();
  const text = organizationDictionary(locale);
  const [areaId, setAreaId] = useState(branch.areaId ?? '');
  const [reason, setReason] = useState('');
  const { submit, send, error } = useOrgForm(onSaved);
  const changed = areaId !== (branch.areaId ?? '');
  return (
    <FormDialog
      title={`${text.placement}: ${branch.name}`}
      labels={formOverlayLabels(t, t.common.save)}
      busy={submit.pending}
      dirty={changed || reason !== ''}
      submitDisabled={!changed || !reason.trim()}
      error={error}
      onClose={onClose}
      onSubmit={() =>
        send(() =>
          api.post(`/api/v1/organization/branches/${branch.id}`, {
            areaId: areaId || null,
            expectedVersion: branch.version,
            reason,
          }),
        )
      }
    >
      <FormGrid>
        <Field label={text.area} required>
          {(control) => (
            <Select
              {...control}
              placeholder={text.unplaced}
              value={areaId}
              onChange={(event) => setAreaId(event.target.value)}
              options={areas
                .filter((area) => area.isActive || area.id === branch.areaId)
                .map((area) => ({ value: area.id, label: `${area.name} (${area.code})` }))}
            />
          )}
        </Field>
        <ReasonField value={reason} onChange={setReason} />
      </FormGrid>
    </FormDialog>
  );
}

/** Activate or deactivate a region or an area: a confirmation with a required reason. */
export function OrgStatusConfirm({
  kind,
  record,
  onClose,
  onChanged,
}: {
  kind: 'region' | 'area';
  record: OrganizationRegion | OrganizationArea;
  onClose: () => void;
  onChanged: Saved;
}) {
  const { api, t, locale } = useWorkforce();
  const text = organizationDictionary(locale);
  const deactivating = record.isActive;
  const title =
    kind === 'region'
      ? deactivating
        ? text.deactivateRegionTitle
        : text.activateRegionTitle
      : deactivating
        ? text.deactivateAreaTitle
        : text.activateAreaTitle;
  const body =
    kind === 'region'
      ? deactivating
        ? text.deactivateRegionBody
        : text.activateRegionBody
      : deactivating
        ? text.deactivateAreaBody
        : text.activateAreaBody;
  return (
    <ConfirmDialog
      title={title}
      description={body}
      facts={[{ label: t.common.code, value: `${record.code} · ${record.name}` }]}
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
            api.post(
              `/api/v1/organization/${kind === 'region' ? 'regions' : 'areas'}/${record.id}`,
              {
                isActive: !record.isActive,
                expectedVersion: record.version,
                reason: reason ?? '',
              },
            ),
          onChanged,
        );
        if (!outcome.ok) throw outcome.error;
        await onChanged();
      }}
    />
  );
}

/** End a management appointment: a confirmation with a required reason. */
export function AppointmentEnd({
  item,
  snapshot,
  onClose,
  onChanged,
}: {
  item: OrganizationAppointment;
  snapshot: OrganizationSnapshotResponse;
  onClose: () => void;
  onChanged: Saved;
}) {
  const { api, t, locale } = useWorkforce();
  const text = organizationDictionary(locale);
  return (
    <ConfirmDialog
      title={text.endTitle}
      description={text.endBody}
      facts={[
        { label: text.employee, value: item.fullName },
        { label: text.level, value: text.levels[item.level] },
        { label: t.roles.scope, value: formatScope(item.scope, snapshot, text.system) },
      ]}
      tone="danger"
      confirmLabel={text.end}
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
            api.post(`/api/v1/organization/appointments/${item.id}/end`, {
              expectedVersion: item.version,
              reason: reason ?? '',
            }),
          onChanged,
        );
        if (!outcome.ok) throw outcome.error;
        await onChanged();
      }}
    />
  );
}

/** Appoint an employee to a management level. The directory search runs on the server (debounced). */
export function AppointmentCreate({
  snapshot,
  onClose,
  onSaved,
}: {
  snapshot: OrganizationSnapshotResponse;
  onClose: () => void;
  onSaved: Saved;
}) {
  const { api, t, locale } = useWorkforce();
  const text = organizationDictionary(locale);
  const [level, setLevel] = useState<OrganizationLevel>('STORE_MANAGER');
  const [scopeId, setScopeId] = useState('');
  const [employee, setEmployee] = useState<{ value: string; label: string } | null>(null);
  const [reason, setReason] = useState('');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const { submit, send, error } = useOrgForm(onSaved);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);
  const employees = useResource(
    () =>
      api.get<EmployeeDirectoryResponse>('/api/v1/employees', {
        status: 'ACTIVE',
        ...(search ? { q: search } : {}),
        limit: 20,
      }),
    [api, search],
  );
  const fetched = (employees.data?.items ?? []).map((entry) => ({
    value: entry.id,
    label: `${entry.fullName} (${entry.employeeId})`,
  }));
  // The chosen person stays in the list while the search text narrows it.
  const options = employee
    ? [employee, ...fetched.filter((option) => option.value !== employee.value)]
    : fetched;

  const scopeOptions =
    level === 'REGIONAL_MANAGER'
      ? snapshot.regions.filter((r) => r.isActive)
      : level === 'AREA_MANAGER'
        ? snapshot.areas.filter((a) => a.isActive)
        : snapshot.branches.filter((b) => b.isActive);
  const scopeLabel =
    level === 'REGIONAL_MANAGER'
      ? text.region
      : level === 'AREA_MANAGER'
        ? text.area
        : text.branches;
  const ready = employee !== null && (level === 'CEO' || scopeId !== '') && reason.trim() !== '';

  return (
    <FormDialog
      title={text.appoint}
      labels={formOverlayLabels(t, text.appoint)}
      busy={submit.pending}
      dirty={employee !== null || scopeId !== '' || reason !== '' || level !== 'STORE_MANAGER'}
      submitDisabled={!ready}
      error={error}
      onClose={onClose}
      onSubmit={() =>
        employee
          ? send(() =>
              api.post('/api/v1/organization/appointments', {
                userId: employee.value,
                level,
                scope: appointmentScope(level, scopeId),
                reason,
              }),
            )
          : Promise.resolve()
      }
    >
      <FormGrid>
        <Field label={text.level} required>
          {(control) => (
            <Select
              {...control}
              value={level}
              onChange={(event) => {
                setLevel(event.target.value as OrganizationLevel);
                setScopeId('');
              }}
              options={ORG_LEVELS.filter((entry) => entry !== 'TEAM_LEADER').map((entry) => ({
                value: entry,
                label: text.levels[entry],
              }))}
            />
          )}
        </Field>
        {level === 'CEO' ? (
          <p className="ls-hint">
            {t.roles.scope}: {text.system}
          </p>
        ) : (
          <Field label={scopeLabel} required>
            {(control) => (
              <Select
                {...control}
                placeholder={text.choose}
                value={scopeId}
                onChange={(event) => setScopeId(event.target.value)}
                options={scopeOptions.map((entry) => ({
                  value: entry.id,
                  label: `${entry.name} (${entry.code})`,
                }))}
              />
            )}
          </Field>
        )}
        <Field label={text.employee} required>
          {(control) => (
            <Combobox
              {...control}
              options={options}
              value={employee?.value ?? null}
              onValueChange={(value) => setEmployee(options.find((o) => o.value === value) ?? null)}
              onQueryChange={setQuery}
              loading={employees.loading}
              loadingLabel={t.common.loading}
              emptyLabel={text.employeeEmpty}
              placeholder={text.search}
              resultsLabel={(count) => resultsText(t, count)}
            />
          )}
        </Field>
        <ReasonField value={reason} onChange={setReason} />
      </FormGrid>
    </FormDialog>
  );
}
