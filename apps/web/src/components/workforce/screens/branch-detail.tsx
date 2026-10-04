'use client';

import type {
  BranchHoursUpdateRequest,
  BranchOperatingDay,
  BranchResponse,
  BranchUpdateRequest,
} from '@lucy-spa/contracts';
import {
  Breadcrumbs,
  CheckField,
  Cluster,
  ConfirmDialog,
  DescriptionList,
  Field,
  FormDialog,
  FormDrawer,
  FormGrid,
  RowActions,
  Stack,
  TextInput,
  TimeInput,
  type MenuItem,
} from '@lucy-spa/ui';
import { PrefetchLink as Link } from '../link';
import { useState } from 'react';
import { organizationDictionary } from '../../../i18n/organization';
import { confirmError, formOverlayLabels } from '../../../lib/workforce/form-labels';
import { canAt, canGlobal } from '../../../lib/workforce/permissions';
import { runMutation } from '../../../lib/workforce/workflows';
import { useAccount, useWorkforce } from '../session';
import {
  Badge,
  Button,
  ErrorState,
  Loading,
  Notice,
  PageHeader,
  Section,
  useResource,
  useSubmit,
  useSuccessToast,
} from '../ui';

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

/** Fills missing weekdays (pre-Phase 2 seed branches may have none) as closed. */
export function editableHours(hours: readonly BranchOperatingDay[]): BranchOperatingDay[] {
  return WEEKDAYS.map(
    (isoWeekday) =>
      hours.find((day) => day.isoWeekday === isoWeekday) ?? {
        isoWeekday,
        isClosed: true,
        opensAt: null,
        closesAt: null,
      },
  );
}

/**
 * Whether the edited week differs from the stored hours. The API rejects an update that
 * changes no weekday (`VALIDATION_FAILED` "days"), so an unchanged form is not submitted.
 * A weekday with no stored row (branches created before Phase 2) always counts as a change.
 */
export function hoursChanged(
  stored: readonly BranchOperatingDay[],
  edited: readonly BranchOperatingDay[],
): boolean {
  return edited.some((day) => {
    const current = stored.find((entry) => entry.isoWeekday === day.isoWeekday);
    if (!current) return true;
    if (current.isClosed !== day.isClosed) return true;
    return !day.isClosed && (current.opensAt !== day.opensAt || current.closesAt !== day.closesAt);
  });
}

type Overlay = 'details' | 'hours' | 'status';
type Done = (message: string) => void;

/**
 * One branch: header with the edit action and a `⋮` menu (activate / deactivate with a reason), then
 * the details and the business hours, each read-only with its own edit action. Details and hours need
 * MANAGE_BRANCHES at this branch, the status GLOBAL MANAGE_BRANCHES.
 */
export function BranchDetailScreen({ id }: { id: string }) {
  const { api, t } = useWorkforce();
  const branch = useResource(() => api.get<BranchResponse>(`/api/v1/branches/${id}`), [api, id]);
  if (branch.error && !branch.data) {
    return <ErrorState error={branch.error} t={t} onRetry={() => void branch.reload()} />;
  }
  if (!branch.data) return <Loading t={t} page />;
  return <BranchDetail branch={branch.data} reload={branch.reload} />;
}

function BranchDetail({ branch, reload }: { branch: BranchResponse; reload: () => Promise<void> }) {
  const { t, locale, base } = useWorkforce();
  const { account } = useAccount();
  const notify = useSuccessToast();
  const text = organizationDictionary(locale);
  const manage = canAt(account, 'MANAGE_BRANCHES', branch.id);
  const manageStatus = canGlobal(account, 'MANAGE_BRANCHES');
  const [overlay, setOverlay] = useState<Overlay | null>(null);

  /** After a successful change: close the overlay and say what happened (the data was reloaded first). */
  const finish: Done = (message) => {
    setOverlay(null);
    notify(message);
  };
  const menu: MenuItem[] = manageStatus
    ? [
        {
          id: 'status',
          label: branch.isActive ? t.common.deactivate : t.common.activate,
          ...(branch.isActive ? { tone: 'danger' as const } : {}),
          onSelect: () => setOverlay('status'),
        },
      ]
    : [];

  return (
    <>
      <PageHeader
        title={branch.name}
        intro={`${branch.code} · ${branch.timezone}`}
        breadcrumbs={
          <Breadcrumbs
            label={text.breadcrumbs}
            LinkComponent={Link}
            items={[{ label: t.branches.title, href: `${base}/branches` }, { label: branch.name }]}
          />
        }
      >
        {menu.length > 0 ? <RowActions menuLabel={text.moreActions} items={menu} /> : null}
        {manage ? (
          <Button variant="primary" icon="edit" onClick={() => setOverlay('details')}>
            {t.branches.editDetails}
          </Button>
        ) : null}
      </PageHeader>
      <Cluster gap="inline">
        <span className="ls-hint">{t.common.status}:</span>
        <Badge tone={branch.isActive ? 'success' : 'neutral'}>
          {branch.isActive ? t.common.active : t.common.inactive}
        </Badge>
      </Cluster>
      {!manage ? <Notice tone="info">{t.branches.readOnly}</Notice> : null}
      <Stack gap="page">
        <Section title={t.common.details}>
          <DescriptionList
            columns={2}
            items={[
              { label: t.common.code, value: branch.code },
              { label: t.common.name, value: branch.name },
              { label: t.branches.timezone, value: branch.timezone },
            ]}
          />
        </Section>
        <Section
          title={t.branches.hours}
          actions={
            manage ? (
              <Button variant="secondary" icon="edit" onClick={() => setOverlay('hours')}>
                {t.branches.editHours}
              </Button>
            ) : undefined
          }
        >
          {branch.hours.length === 0 ? (
            <Notice tone="info">{t.branches.noHours}</Notice>
          ) : (
            <DescriptionList
              columns={2}
              items={editableHours(branch.hours).map((day) => ({
                label: t.branches.weekdays[day.isoWeekday] ?? String(day.isoWeekday),
                value: day.isClosed ? (
                  <Badge tone="neutral">{t.branches.closed}</Badge>
                ) : (
                  `${day.opensAt ?? '—'} – ${day.closesAt ?? '—'}`
                ),
              }))}
            />
          )}
        </Section>
      </Stack>
      {overlay === 'details' ? (
        <BranchEdit
          branch={branch}
          reload={reload}
          onClose={() => setOverlay(null)}
          onDone={finish}
        />
      ) : null}
      {overlay === 'hours' ? (
        <HoursEdit
          branch={branch}
          reload={reload}
          onClose={() => setOverlay(null)}
          onDone={finish}
        />
      ) : null}
      {overlay === 'status' ? (
        <BranchStatus
          branch={branch}
          reload={reload}
          onClose={() => setOverlay(null)}
          onDone={finish}
        />
      ) : null}
    </>
  );
}

/** Name and timezone (2 fields): only the changed ones are sent. */
function BranchEdit({
  branch,
  reload,
  onClose,
  onDone,
}: {
  branch: BranchResponse;
  reload: () => Promise<void>;
  onClose: () => void;
  onDone: Done;
}) {
  const { api, t } = useWorkforce();
  const [name, setName] = useState(branch.name);
  const [timezone, setTimezone] = useState(branch.timezone);
  const submit = useSubmit();
  const changed = name !== branch.name || timezone !== branch.timezone;

  async function save() {
    if (!changed) return;
    const body: BranchUpdateRequest = {
      expectedVersion: branch.version,
      ...(name !== branch.name ? { name } : {}),
      ...(timezone !== branch.timezone ? { timezone } : {}),
    };
    const ok = await submit.run(
      () => runMutation(() => api.post(`/api/v1/branches/${branch.id}`, body), reload),
      '',
    );
    if (ok) {
      await reload();
      onDone(t.common.saved);
    }
  }

  return (
    <FormDialog
      title={t.branches.editDetails}
      labels={formOverlayLabels(t, t.common.save)}
      busy={submit.pending}
      dirty={changed}
      submitDisabled={!changed || !name.trim() || !timezone.trim()}
      error={submit.error ? <ErrorState error={submit.error} t={t} /> : undefined}
      onClose={onClose}
      onSubmit={save}
    >
      <FormGrid>
        <Field label={t.common.name} required>
          {(control) => (
            <TextInput
              {...control}
              maxLength={200}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          )}
        </Field>
        <Field label={t.branches.timezone} required hint={t.branches.timezoneLocked}>
          {(control) => (
            <TextInput
              {...control}
              maxLength={64}
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
            />
          )}
        </Field>
      </FormGrid>
    </FormDialog>
  );
}

/** The week as one table of seven rows (day, closed, opens, closes) in a drawer. */
function HoursEdit({
  branch,
  reload,
  onClose,
  onDone,
}: {
  branch: BranchResponse;
  reload: () => Promise<void>;
  onClose: () => void;
  onDone: Done;
}) {
  const { api, t } = useWorkforce();
  const [days, setDays] = useState(() => editableHours(branch.hours));
  const submit = useSubmit();
  const changed = hoursChanged(branch.hours, days);

  const update = (isoWeekday: number, patch: Partial<BranchOperatingDay>) =>
    setDays((current) =>
      current.map((day) => (day.isoWeekday === isoWeekday ? { ...day, ...patch } : day)),
    );

  async function save() {
    if (!changed) return;
    const body: BranchHoursUpdateRequest = {
      expectedVersion: branch.version,
      days: days.map((day) =>
        day.isClosed
          ? { isoWeekday: day.isoWeekday, isClosed: true, opensAt: null, closesAt: null }
          : day,
      ),
    };
    const ok = await submit.run(
      () => runMutation(() => api.post(`/api/v1/branches/${branch.id}/hours`, body), reload),
      '',
    );
    if (ok) {
      await reload();
      onDone(t.common.saved);
    }
  }

  const label = (day: BranchOperatingDay) =>
    t.branches.weekdays[day.isoWeekday] ?? String(day.isoWeekday);
  return (
    <FormDrawer
      title={t.branches.editHours}
      labels={formOverlayLabels(t, t.branches.saveHours)}
      busy={submit.pending}
      dirty={changed}
      submitDisabled={!changed}
      error={submit.error ? <ErrorState error={submit.error} t={t} /> : undefined}
      onClose={onClose}
      onSubmit={save}
    >
      <Stack gap="page">
        {days.map((day) => (
          <div key={day.isoWeekday} role="group" aria-label={label(day)}>
            <Stack gap="block">
              <Cluster gap="inline">
                <strong>{label(day)}</strong>
                <CheckField
                  checked={day.isClosed}
                  label={t.branches.closed}
                  onChange={(event) =>
                    update(day.isoWeekday, {
                      isClosed: event.target.checked,
                      opensAt: event.target.checked ? null : (day.opensAt ?? '09:00'),
                      closesAt: event.target.checked ? null : (day.closesAt ?? '21:00'),
                    })
                  }
                />
              </Cluster>
              <FormGrid cols={2}>
                <TimeInput
                  aria-label={`${label(day)}: ${t.branches.opensAt}`}
                  value={day.opensAt ?? ''}
                  disabled={day.isClosed}
                  required={!day.isClosed}
                  onChange={(event) => update(day.isoWeekday, { opensAt: event.target.value })}
                />
                <TimeInput
                  aria-label={`${label(day)}: ${t.branches.closesAt}`}
                  value={day.closesAt ?? ''}
                  disabled={day.isClosed}
                  required={!day.isClosed}
                  onChange={(event) => update(day.isoWeekday, { closesAt: event.target.value })}
                />
              </FormGrid>
            </Stack>
          </div>
        ))}
      </Stack>
    </FormDrawer>
  );
}

/** Activate or deactivate the branch: a confirmation with the reason the API requires. */
function BranchStatus({
  branch,
  reload,
  onClose,
  onDone,
}: {
  branch: BranchResponse;
  reload: () => Promise<void>;
  onClose: () => void;
  onDone: Done;
}) {
  const { api, t } = useWorkforce();
  const deactivating = branch.isActive;
  return (
    <ConfirmDialog
      title={deactivating ? t.branches.deactivateTitle : t.branches.activateTitle}
      description={deactivating ? t.branches.deactivateBody : t.branches.activateBody}
      facts={[{ label: t.common.code, value: `${branch.code} · ${branch.name}` }]}
      tone={deactivating ? 'danger' : 'neutral'}
      confirmLabel={deactivating ? t.common.deactivate : t.common.activate}
      busyLabel={t.common.saving}
      cancelLabel={t.common.cancel}
      referenceLabel={t.errors.reference}
      reasonField={{
        label: t.branches.statusReason,
        required: true,
        requiredLabel: t.common.required,
        requiredMessage: t.common.form.reasonRequired,
      }}
      describeError={confirmError(t)}
      onCancel={onClose}
      onConfirm={async (reason) => {
        const outcome = await runMutation(
          () =>
            api.post(`/api/v1/branches/${branch.id}/status`, {
              expectedVersion: branch.version,
              isActive: !branch.isActive,
              reason: reason ?? '',
            }),
          reload,
        );
        if (!outcome.ok) throw outcome.error;
        await reload();
        onDone(t.common.saved);
      }}
    />
  );
}
