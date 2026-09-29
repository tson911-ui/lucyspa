'use client';

import type {
  AuthorizationScope,
  EmployeeDirectoryResponse,
  OrganizationAppointment,
  OrganizationAppointmentsResponse,
  OrganizationArea,
  OrganizationBranch,
  OrganizationLevel,
  OrganizationRegion,
  OrganizationSnapshotResponse,
} from '@lucy-spa/contracts';
import { useEffect, useState, type FormEvent } from 'react';
import { organizationDictionary } from '../../../i18n/organization';
import { canAnywhere } from '../../../lib/workforce/permissions';
import { runMutation } from '../../../lib/workforce/workflows';
import { useAccount, useWorkforce } from '../session';
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

type OrgTab = 'regions' | 'areas' | 'branches' | 'appointments';

export function OrganizationScreen() {
  const { api, t, locale } = useWorkforce();
  const { account } = useAccount();
  const text = organizationDictionary(locale);

  const allowed =
    canAnywhere(account, 'VIEW_ORGANIZATION') ||
    canAnywhere(account, 'MANAGE_ORGANIZATION') ||
    canAnywhere(account, 'MANAGE_ORG_ASSIGNMENTS');

  const [tab, setTab] = useState<OrgTab>('regions');

  const snapshot = useResource(
    () =>
      allowed
        ? api.get<OrganizationSnapshotResponse>('/api/v1/organization')
        : Promise.resolve(null),
    [api, allowed],
  );

  const appointments = useResource(
    () =>
      allowed
        ? api.get<OrganizationAppointmentsResponse>('/api/v1/organization/appointments', {})
        : Promise.resolve(null),
    [api, allowed],
  );

  if (!allowed) {
    return <Notice tone="warning">{text.noAccess}</Notice>;
  }

  const reloadAll = async () => {
    await Promise.all([snapshot.reload(), appointments.reload()]);
  };

  return (
    <>
      <PageHeader title={text.title} />
      <Notice tone="info">{text.ownerNote}</Notice>
      <Notice tone="info">{text.attendanceNote}</Notice>

      <div className="wf-form-actions" role="tablist" aria-label={text.title}>
        <button
          type="button"
          className="wf-button"
          role="tab"
          aria-selected={tab === 'regions'}
          onClick={() => setTab('regions')}
        >
          {text.regions} ({snapshot.data?.regions.length ?? 0})
        </button>
        <button
          type="button"
          className="wf-button"
          role="tab"
          aria-selected={tab === 'areas'}
          onClick={() => setTab('areas')}
        >
          {text.areas} ({snapshot.data?.areas.length ?? 0})
        </button>
        <button
          type="button"
          className="wf-button"
          role="tab"
          aria-selected={tab === 'branches'}
          onClick={() => setTab('branches')}
        >
          {text.branches} ({snapshot.data?.branches.length ?? 0})
        </button>
        <button
          type="button"
          className="wf-button"
          role="tab"
          aria-selected={tab === 'appointments'}
          onClick={() => setTab('appointments')}
        >
          {text.appointments} ({appointments.data?.items.length ?? 0})
        </button>
      </div>

      {snapshot.loading || appointments.loading ? <Loading t={t} /> : null}
      {snapshot.error ? (
        <ErrorState error={snapshot.error} t={t} onRetry={() => void snapshot.reload()} />
      ) : null}
      {appointments.error ? (
        <ErrorState error={appointments.error} t={t} onRetry={() => void appointments.reload()} />
      ) : null}

      {snapshot.data ? (
        <>
          {tab === 'regions' ? (
            <RegionsView
              regions={snapshot.data.regions}
              canManage={canAnywhere(account, 'MANAGE_ORGANIZATION')}
              onReload={reloadAll}
            />
          ) : null}
          {tab === 'areas' ? (
            <AreasView
              regions={snapshot.data.regions}
              areas={snapshot.data.areas}
              canManage={canAnywhere(account, 'MANAGE_ORGANIZATION')}
              onReload={reloadAll}
            />
          ) : null}
          {tab === 'branches' ? (
            <BranchesPlacementView
              areas={snapshot.data.areas}
              branches={snapshot.data.branches}
              canManage={canAnywhere(account, 'MANAGE_ORGANIZATION')}
              onReload={reloadAll}
            />
          ) : null}
          {tab === 'appointments' && appointments.data ? (
            <AppointmentsView
              appointments={appointments.data.items}
              snapshot={snapshot.data}
              canManage={canAnywhere(account, 'MANAGE_ORG_ASSIGNMENTS')}
              onReload={reloadAll}
            />
          ) : null}
        </>
      ) : null}
    </>
  );
}

function RegionsView({
  regions,
  canManage,
  onReload,
}: {
  regions: OrganizationRegion[];
  canManage: boolean;
  onReload: () => Promise<void>;
}) {
  const { t, locale } = useWorkforce();
  const text = organizationDictionary(locale);

  return (
    <Section title={text.regions}>
      {canManage ? <CreateRegionForm onSaved={onReload} /> : null}
      {regions.length === 0 ? (
        <Empty>{text.noRows}</Empty>
      ) : (
        <table className="wf-table">
          <thead>
            <tr>
              <th>{t.common.code}</th>
              <th>{t.common.name}</th>
              <th>{t.common.status}</th>
              {canManage ? <th>{t.common.actions}</th> : null}
            </tr>
          </thead>
          <tbody>
            {regions.map((region) => (
              <RegionRow
                key={region.id}
                region={region}
                canManage={canManage}
                onReload={onReload}
              />
            ))}
          </tbody>
        </table>
      )}
    </Section>
  );
}

function RegionRow({
  region,
  canManage,
  onReload,
}: {
  region: OrganizationRegion;
  canManage: boolean;
  onReload: () => Promise<void>;
}) {
  const { api, t, locale } = useWorkforce();
  const text = organizationDictionary(locale);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(region.name);
  const [reason, setReason] = useState('');
  const submit = useSubmit();

  const handleUpdate = async (activeToggle?: boolean) => {
    const ok = await submit.run(
      () =>
        runMutation(
          () =>
            api.post(`/api/v1/organization/regions/${region.id}`, {
              name: activeToggle !== undefined ? region.name : name,
              isActive: activeToggle !== undefined ? activeToggle : region.isActive,
              expectedVersion: region.version,
              reason,
            }),
          onReload,
        ),
      text.saved,
    );
    if (ok) {
      setReason('');
      setEditing(false);
      await onReload();
    }
  };

  return (
    <tr>
      <td data-label={t.common.code}>{region.code}</td>
      <td data-label={t.common.name}>
        {editing ? (
          <input
            className="wf-input"
            value={name}
            maxLength={150}
            onChange={(e) => setName(e.target.value)}
          />
        ) : (
          region.name
        )}
      </td>
      <td data-label={t.common.status}>
        <Badge tone={region.isActive ? 'success' : 'neutral'}>
          {region.isActive ? t.common.active : text.inactive}
        </Badge>
      </td>
      {canManage ? (
        <td data-label={t.common.actions}>
          {editing ? (
            <div className="wf-form-actions">
              <input
                className="wf-input"
                placeholder={t.common.reason}
                value={reason}
                maxLength={500}
                onChange={(e) => setReason(e.target.value)}
              />
              <button
                type="button"
                className="wf-button wf-button-primary"
                disabled={submit.pending || !name.trim() || !reason.trim()}
                onClick={() => void handleUpdate()}
              >
                {t.common.save}
              </button>
              <button
                type="button"
                className="wf-button"
                disabled={submit.pending}
                onClick={() => {
                  setEditing(false);
                  setName(region.name);
                  setReason('');
                }}
              >
                {t.common.cancel}
              </button>
            </div>
          ) : (
            <div className="wf-form-actions">
              <button type="button" className="wf-button" onClick={() => setEditing(true)}>
                {text.rename}
              </button>
              <button
                type="button"
                className="wf-button"
                onClick={() => {
                  const promptReason = window.prompt(t.common.reason);
                  if (promptReason) {
                    setReason(promptReason);
                    void api
                      .post(`/api/v1/organization/regions/${region.id}`, {
                        isActive: !region.isActive,
                        expectedVersion: region.version,
                        reason: promptReason,
                      })
                      .then(() => onReload());
                  }
                }}
              >
                {region.isActive ? text.deactivate : text.activate}
              </button>
            </div>
          )}
          <FormFeedback error={submit.error} success={submit.success} t={t} />
        </td>
      ) : null}
    </tr>
  );
}

function CreateRegionForm({ onSaved }: { onSaved: () => Promise<void> }) {
  const { api, t, locale } = useWorkforce();
  const text = organizationDictionary(locale);
  const [form, setForm] = useState({ code: '', name: '', reason: '' });
  const submit = useSubmit();

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    const ok = await submit.run(
      () => runMutation(() => api.post('/api/v1/organization/regions', form), onSaved),
      text.saved,
    );
    if (ok) {
      setForm({ code: '', name: '', reason: '' });
      await onSaved();
    }
  };

  return (
    <details>
      <summary>{text.createRegion}</summary>
      <form className="wf-form" onSubmit={(e) => void handleCreate(e)}>
        <Field id="region-code" label={t.common.code} required>
          <input
            id="region-code"
            required
            maxLength={64}
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value })}
          />
        </Field>
        <Field id="region-name" label={t.common.name} required>
          <input
            id="region-name"
            required
            maxLength={150}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </Field>
        <Field id="region-reason" label={t.common.reason} required>
          <input
            id="region-reason"
            required
            maxLength={500}
            value={form.reason}
            onChange={(e) => setForm({ ...form, reason: e.target.value })}
          />
        </Field>
        <FormFeedback error={submit.error} success={submit.success} t={t} />
        <SubmitButton
          pending={submit.pending}
          label={t.common.create}
          pendingLabel={t.common.saving}
          disabled={!form.code.trim() || !form.name.trim() || !form.reason.trim()}
        />
      </form>
    </details>
  );
}

function AreasView({
  regions,
  areas,
  canManage,
  onReload,
}: {
  regions: OrganizationRegion[];
  areas: OrganizationArea[];
  canManage: boolean;
  onReload: () => Promise<void>;
}) {
  const { t, locale } = useWorkforce();
  const text = organizationDictionary(locale);

  return (
    <Section title={text.areas}>
      {canManage ? <CreateAreaForm regions={regions} onSaved={onReload} /> : null}
      {areas.length === 0 ? (
        <Empty>{text.noRows}</Empty>
      ) : (
        <table className="wf-table">
          <thead>
            <tr>
              <th>{t.common.code}</th>
              <th>{t.common.name}</th>
              <th>{text.region}</th>
              <th>{t.common.status}</th>
              {canManage ? <th>{t.common.actions}</th> : null}
            </tr>
          </thead>
          <tbody>
            {areas.map((area) => (
              <AreaRow
                key={area.id}
                area={area}
                regions={regions}
                canManage={canManage}
                onReload={onReload}
              />
            ))}
          </tbody>
        </table>
      )}
    </Section>
  );
}

function AreaRow({
  area,
  regions,
  canManage,
  onReload,
}: {
  area: OrganizationArea;
  regions: OrganizationRegion[];
  canManage: boolean;
  onReload: () => Promise<void>;
}) {
  const { api, t, locale } = useWorkforce();
  const text = organizationDictionary(locale);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(area.name);
  const [regionId, setRegionId] = useState(area.regionId);
  const [reason, setReason] = useState('');
  const submit = useSubmit();

  const handleUpdate = async () => {
    const ok = await submit.run(
      () =>
        runMutation(
          () =>
            api.post(`/api/v1/organization/areas/${area.id}`, {
              name,
              regionId,
              expectedVersion: area.version,
              reason,
            }),
          onReload,
        ),
      text.saved,
    );
    if (ok) {
      setReason('');
      setEditing(false);
      await onReload();
    }
  };

  const regionName = regions.find((r) => r.id === area.regionId)?.name ?? area.regionId;

  return (
    <tr>
      <td data-label={t.common.code}>{area.code}</td>
      <td data-label={t.common.name}>
        {editing ? (
          <input
            className="wf-input"
            value={name}
            maxLength={150}
            onChange={(e) => setName(e.target.value)}
          />
        ) : (
          area.name
        )}
      </td>
      <td data-label={text.region}>
        {editing ? (
          <select value={regionId} onChange={(e) => setRegionId(e.target.value)}>
            {regions
              .filter((r) => r.isActive || r.id === area.regionId)
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
          </select>
        ) : (
          regionName
        )}
      </td>
      <td data-label={t.common.status}>
        <Badge tone={area.isActive ? 'success' : 'neutral'}>
          {area.isActive ? t.common.active : text.inactive}
        </Badge>
      </td>
      {canManage ? (
        <td data-label={t.common.actions}>
          {editing ? (
            <div className="wf-form-actions">
              <input
                className="wf-input"
                placeholder={t.common.reason}
                value={reason}
                maxLength={500}
                onChange={(e) => setReason(e.target.value)}
              />
              <button
                type="button"
                className="wf-button wf-button-primary"
                disabled={submit.pending || !name.trim() || !reason.trim()}
                onClick={() => void handleUpdate()}
              >
                {t.common.save}
              </button>
              <button
                type="button"
                className="wf-button"
                disabled={submit.pending}
                onClick={() => {
                  setEditing(false);
                  setName(area.name);
                  setRegionId(area.regionId);
                  setReason('');
                }}
              >
                {t.common.cancel}
              </button>
            </div>
          ) : (
            <div className="wf-form-actions">
              <button type="button" className="wf-button" onClick={() => setEditing(true)}>
                {t.common.edit}
              </button>
              <button
                type="button"
                className="wf-button"
                onClick={() => {
                  const promptReason = window.prompt(t.common.reason);
                  if (promptReason) {
                    void api
                      .post(`/api/v1/organization/areas/${area.id}`, {
                        isActive: !area.isActive,
                        expectedVersion: area.version,
                        reason: promptReason,
                      })
                      .then(() => onReload());
                  }
                }}
              >
                {area.isActive ? text.deactivate : text.activate}
              </button>
            </div>
          )}
          <FormFeedback error={submit.error} success={submit.success} t={t} />
        </td>
      ) : null}
    </tr>
  );
}

function CreateAreaForm({
  regions,
  onSaved,
}: {
  regions: OrganizationRegion[];
  onSaved: () => Promise<void>;
}) {
  const { api, t, locale } = useWorkforce();
  const text = organizationDictionary(locale);
  const activeRegions = regions.filter((r) => r.isActive);
  const [form, setForm] = useState({ regionId: '', code: '', name: '', reason: '' });
  const submit = useSubmit();

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    const ok = await submit.run(
      () => runMutation(() => api.post('/api/v1/organization/areas', form), onSaved),
      text.saved,
    );
    if (ok) {
      setForm({ regionId: '', code: '', name: '', reason: '' });
      await onSaved();
    }
  };

  return (
    <details>
      <summary>{text.createArea}</summary>
      <form className="wf-form" onSubmit={(e) => void handleCreate(e)}>
        <Field id="area-region" label={text.region} required>
          <select
            id="area-region"
            required
            value={form.regionId}
            onChange={(e) => setForm({ ...form, regionId: e.target.value })}
          >
            <option value="">{text.choose}</option>
            {activeRegions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} ({r.code})
              </option>
            ))}
          </select>
        </Field>
        <Field id="area-code" label={t.common.code} required>
          <input
            id="area-code"
            required
            maxLength={64}
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value })}
          />
        </Field>
        <Field id="area-name" label={t.common.name} required>
          <input
            id="area-name"
            required
            maxLength={150}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </Field>
        <Field id="area-reason" label={t.common.reason} required>
          <input
            id="area-reason"
            required
            maxLength={500}
            value={form.reason}
            onChange={(e) => setForm({ ...form, reason: e.target.value })}
          />
        </Field>
        <FormFeedback error={submit.error} success={submit.success} t={t} />
        <SubmitButton
          pending={submit.pending}
          label={t.common.create}
          pendingLabel={t.common.saving}
          disabled={!form.regionId || !form.code.trim() || !form.name.trim() || !form.reason.trim()}
        />
      </form>
    </details>
  );
}

function BranchesPlacementView({
  areas,
  branches,
  canManage,
  onReload,
}: {
  areas: OrganizationArea[];
  branches: OrganizationBranch[];
  canManage: boolean;
  onReload: () => Promise<void>;
}) {
  const { t, locale } = useWorkforce();
  const text = organizationDictionary(locale);

  return (
    <Section title={text.placement}>
      {branches.length === 0 ? (
        <Empty>{text.noRows}</Empty>
      ) : (
        <table className="wf-table">
          <thead>
            <tr>
              <th>{t.common.code}</th>
              <th>{t.common.name}</th>
              <th>{text.area}</th>
              {canManage ? <th>{t.common.actions}</th> : null}
            </tr>
          </thead>
          <tbody>
            {branches.map((branch) => (
              <BranchPlacementRow
                key={branch.id}
                branch={branch}
                areas={areas}
                canManage={canManage}
                onReload={onReload}
              />
            ))}
          </tbody>
        </table>
      )}
    </Section>
  );
}

function BranchPlacementRow({
  branch,
  areas,
  canManage,
  onReload,
}: {
  branch: OrganizationBranch;
  areas: OrganizationArea[];
  canManage: boolean;
  onReload: () => Promise<void>;
}) {
  const { api, t, locale } = useWorkforce();
  const text = organizationDictionary(locale);
  const [editing, setEditing] = useState(false);
  const [areaId, setAreaId] = useState<string>(branch.areaId ?? '');
  const [reason, setReason] = useState('');
  const submit = useSubmit();

  const currentArea = areas.find((a) => a.id === branch.areaId);

  const handleSave = async () => {
    const ok = await submit.run(
      () =>
        runMutation(
          () =>
            api.post(`/api/v1/organization/branches/${branch.id}`, {
              areaId: areaId ? areaId : null,
              expectedVersion: branch.version,
              reason,
            }),
          onReload,
        ),
      text.saved,
    );
    if (ok) {
      setReason('');
      setEditing(false);
      await onReload();
    }
  };

  return (
    <tr>
      <td data-label={t.common.code}>{branch.code}</td>
      <td data-label={t.common.name}>{branch.name}</td>
      <td data-label={text.area}>
        {editing ? (
          <select value={areaId} onChange={(e) => setAreaId(e.target.value)}>
            <option value="">{text.unplaced}</option>
            {areas
              .filter((a) => a.isActive || a.id === branch.areaId)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.code})
                </option>
              ))}
          </select>
        ) : currentArea ? (
          currentArea.name
        ) : (
          <span className="wf-muted">{text.unplaced}</span>
        )}
      </td>
      {canManage ? (
        <td data-label={t.common.actions}>
          {editing ? (
            <div className="wf-form-actions">
              <input
                className="wf-input"
                placeholder={t.common.reason}
                value={reason}
                maxLength={500}
                onChange={(e) => setReason(e.target.value)}
              />
              <button
                type="button"
                className="wf-button wf-button-primary"
                disabled={submit.pending || !reason.trim()}
                onClick={() => void handleSave()}
              >
                {t.common.save}
              </button>
              <button
                type="button"
                className="wf-button"
                disabled={submit.pending}
                onClick={() => {
                  setEditing(false);
                  setAreaId(branch.areaId ?? '');
                  setReason('');
                }}
              >
                {t.common.cancel}
              </button>
            </div>
          ) : (
            <button type="button" className="wf-button" onClick={() => setEditing(true)}>
              {text.placement}
            </button>
          )}
          <FormFeedback error={submit.error} success={submit.success} t={t} />
        </td>
      ) : null}
    </tr>
  );
}

function AppointmentsView({
  appointments,
  snapshot,
  canManage,
  onReload,
}: {
  appointments: OrganizationAppointment[];
  snapshot: OrganizationSnapshotResponse;
  canManage: boolean;
  onReload: () => Promise<void>;
}) {
  const { t, locale } = useWorkforce();
  const text = organizationDictionary(locale);

  return (
    <Section title={text.appointments}>
      {canManage ? <CreateAppointmentForm snapshot={snapshot} onSaved={onReload} /> : null}
      {appointments.length === 0 ? (
        <Empty>{text.noRows}</Empty>
      ) : (
        <table className="wf-table">
          <thead>
            <tr>
              <th>{text.employee}</th>
              <th>{text.level}</th>
              <th>{t.roles.scope}</th>
              <th>{t.common.from}</th>
              {canManage ? <th>{t.common.actions}</th> : null}
            </tr>
          </thead>
          <tbody>
            {appointments.map((item) => (
              <AppointmentRow
                key={item.id}
                item={item}
                snapshot={snapshot}
                canManage={canManage}
                onReload={onReload}
              />
            ))}
          </tbody>
        </table>
      )}
    </Section>
  );
}

function formatScope(
  scope: AuthorizationScope,
  snapshot: OrganizationSnapshotResponse,
  systemText: string,
): string {
  if (scope.kind === 'GLOBAL') return systemText;
  if (scope.kind === 'REGION') {
    const region = snapshot.regions.find((r) => r.id === scope.regionId);
    return region ? region.name : scope.regionId;
  }
  if (scope.kind === 'AREA') {
    const area = snapshot.areas.find((a) => a.id === scope.areaId);
    return area ? area.name : scope.areaId;
  }
  const branch = snapshot.branches.find((b) => b.id === scope.branchId);
  return branch ? branch.name : scope.branchId;
}

function AppointmentRow({
  item,
  snapshot,
  canManage,
  onReload,
}: {
  item: OrganizationAppointment;
  snapshot: OrganizationSnapshotResponse;
  canManage: boolean;
  onReload: () => Promise<void>;
}) {
  const { api, t, locale } = useWorkforce();
  const text = organizationDictionary(locale);
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [ending, setEnding] = useState(false);
  const submit = useSubmit();

  const handleEnd = async () => {
    if (!confirmed || !reason.trim()) return;
    const ok = await submit.run(
      () =>
        runMutation(
          () =>
            api.post(`/api/v1/organization/appointments/${item.id}/end`, {
              expectedVersion: item.version,
              reason,
            }),
          onReload,
        ),
      text.saved,
    );
    if (ok) {
      setEnding(false);
      setReason('');
      setConfirmed(false);
      await onReload();
    }
  };

  return (
    <tr>
      <td data-label={text.employee}>{item.fullName}</td>
      <td data-label={text.level}>
        <Badge tone="info">{text.levels[item.level]}</Badge>
      </td>
      <td data-label={t.roles.scope}>{formatScope(item.scope, snapshot, text.system)}</td>
      <td data-label={t.common.from}>{item.startedAt.slice(0, 10)}</td>
      {canManage ? (
        <td data-label={t.common.actions}>
          {item.teamId ? (
            <span className="wf-muted wf-small">{text.teams}</span>
          ) : ending ? (
            <div className="wf-form">
              <label>
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />{' '}
                {text.confirmEnd}
              </label>
              <input
                className="wf-input"
                placeholder={t.common.reason}
                value={reason}
                maxLength={500}
                onChange={(e) => setReason(e.target.value)}
              />
              <div className="wf-form-actions">
                <button
                  type="button"
                  className="wf-button wf-button-danger"
                  disabled={submit.pending || !confirmed || !reason.trim()}
                  onClick={() => void handleEnd()}
                >
                  {text.end}
                </button>
                <button
                  type="button"
                  className="wf-button"
                  disabled={submit.pending}
                  onClick={() => {
                    setEnding(false);
                    setConfirmed(false);
                    setReason('');
                  }}
                >
                  {t.common.cancel}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="wf-button wf-button-danger"
              onClick={() => setEnding(true)}
            >
              {text.end}
            </button>
          )}
          <FormFeedback error={submit.error} success={submit.success} t={t} />
        </td>
      ) : null}
    </tr>
  );
}

function CreateAppointmentForm({
  snapshot,
  onSaved,
}: {
  snapshot: OrganizationSnapshotResponse;
  onSaved: () => Promise<void>;
}) {
  const { api, t, locale } = useWorkforce();
  const text = organizationDictionary(locale);
  const [level, setLevel] = useState<OrganizationLevel>('STORE_MANAGER');
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [scopeId, setScopeId] = useState('');
  const [reason, setReason] = useState('');
  const submit = useSubmit();

  // The directory search runs on the server (name or code, any case, with or without
  // accents); typing is debounced and an empty query is simply not sent.
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(employeeSearch.trim()), 250);
    return () => clearTimeout(timer);
  }, [employeeSearch]);
  const employees = useResource(
    () =>
      api.get<EmployeeDirectoryResponse>('/api/v1/employees', {
        status: 'ACTIVE',
        ...(debouncedSearch ? { q: debouncedSearch } : {}),
        limit: 20,
      }),
    [api, debouncedSearch],
  );
  // A selection that is no longer among the results must not stay submitted.
  useEffect(() => {
    if (
      employees.data &&
      selectedUserId &&
      !employees.data.items.some((entry) => entry.id === selectedUserId)
    ) {
      setSelectedUserId('');
    }
  }, [employees.data, selectedUserId]);

  const getScope = (): AuthorizationScope => {
    if (level === 'CEO') return { kind: 'GLOBAL' };
    if (level === 'REGIONAL_MANAGER') return { kind: 'REGION', regionId: scopeId };
    if (level === 'AREA_MANAGER') return { kind: 'AREA', areaId: scopeId };
    return { kind: 'BRANCH', branchId: scopeId };
  };

  const isScopeValid = level === 'CEO' || Boolean(scopeId);

  const handleAppoint = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedUserId || !isScopeValid || !reason.trim()) return;

    const ok = await submit.run(
      () =>
        runMutation(
          () =>
            api.post('/api/v1/organization/appointments', {
              userId: selectedUserId,
              level,
              scope: getScope(),
              reason,
            }),
          onSaved,
        ),
      text.saved,
    );
    if (ok) {
      setSelectedUserId('');
      setEmployeeSearch('');
      setScopeId('');
      setReason('');
      await onSaved();
    }
  };

  return (
    <details>
      <summary>{text.appoint}</summary>
      <form className="wf-form" onSubmit={(e) => void handleAppoint(e)}>
        <Field id="appoint-level" label={text.level} required>
          <select
            id="appoint-level"
            value={level}
            onChange={(e) => {
              setLevel(e.target.value as OrganizationLevel);
              setScopeId('');
            }}
          >
            <option value="CEO">{text.levels.CEO}</option>
            <option value="REGIONAL_MANAGER">{text.levels.REGIONAL_MANAGER}</option>
            <option value="AREA_MANAGER">{text.levels.AREA_MANAGER}</option>
            <option value="STORE_MANAGER">{text.levels.STORE_MANAGER}</option>
            <option value="DEPUTY_STORE_MANAGER">{text.levels.DEPUTY_STORE_MANAGER}</option>
          </select>
        </Field>

        {level === 'CEO' ? (
          <p className="wf-muted">
            {t.roles.scope}: <strong>{text.system}</strong>
          </p>
        ) : level === 'REGIONAL_MANAGER' ? (
          <Field id="appoint-region" label={text.region} required>
            <select
              id="appoint-region"
              required
              value={scopeId}
              onChange={(e) => setScopeId(e.target.value)}
            >
              <option value="">{text.choose}</option>
              {snapshot.regions
                .filter((r) => r.isActive)
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({r.code})
                  </option>
                ))}
            </select>
          </Field>
        ) : level === 'AREA_MANAGER' ? (
          <Field id="appoint-area" label={text.area} required>
            <select
              id="appoint-area"
              required
              value={scopeId}
              onChange={(e) => setScopeId(e.target.value)}
            >
              <option value="">{text.choose}</option>
              {snapshot.areas
                .filter((a) => a.isActive)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.code})
                  </option>
                ))}
            </select>
          </Field>
        ) : (
          <Field id="appoint-branch" label={text.branches} required>
            <select
              id="appoint-branch"
              required
              value={scopeId}
              onChange={(e) => setScopeId(e.target.value)}
            >
              <option value="">{text.choose}</option>
              {snapshot.branches
                .filter((b) => b.isActive)
                .map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({b.code})
                  </option>
                ))}
            </select>
          </Field>
        )}

        <Field id="appoint-employee-search" label={text.search}>
          <input
            id="appoint-employee-search"
            placeholder={text.search}
            value={employeeSearch}
            onChange={(e) => setEmployeeSearch(e.target.value)}
          />
        </Field>

        {employees.loading ? <Loading t={t} /> : null}
        {employees.data && employees.data.items.length > 0 ? (
          <Field id="appoint-employee-select" label={text.employee} required>
            <select
              id="appoint-employee-select"
              required
              value={selectedUserId}
              onChange={(e) => setSelectedUserId(e.target.value)}
            >
              <option value="">{text.choose}</option>
              {employees.data.items.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.fullName} ({entry.employeeId})
                </option>
              ))}
            </select>
          </Field>
        ) : employees.data ? (
          <p className="wf-muted">{text.noRows}</p>
        ) : null}

        <Field id="appoint-reason" label={t.common.reason} required>
          <input
            id="appoint-reason"
            required
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>

        <FormFeedback error={submit.error} success={submit.success} t={t} />
        <SubmitButton
          pending={submit.pending}
          label={text.appoint}
          pendingLabel={t.common.saving}
          disabled={!selectedUserId || !isScopeValid || !reason.trim()}
        />
      </form>
    </details>
  );
}
