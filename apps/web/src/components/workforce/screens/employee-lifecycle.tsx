'use client';

import type {
  EmployeeResponse,
  EmploymentClassificationEntry,
  EmploymentResponse,
} from '@lucy-spa/contracts';
import {
  CheckField,
  ConfirmDialog,
  DataTable,
  DateInput,
  DescriptionList,
  Field,
  FormDialog,
  FormGrid,
  ListSection,
  PasswordInput,
  RadioGroup,
  Select,
  Stack,
  TextInput,
  type DataTableColumn,
} from '@lucy-spa/ui';
import { useState } from 'react';
import { fill } from '../../../i18n/workforce';
import {
  backdatedForNonOwner,
  credentialsRequest,
  detailErrorMessage,
  employeeCommands,
  employmentEnded,
  endAccessMessage,
  endingOutcome,
  endRequest,
  passwordProblem,
  profileForm,
  profilePatch,
  nextClassifications,
  latestClassification,
  promotionRequest,
  statusRequest,
  type ProfileForm,
} from '../../../lib/workforce/employee-detail';
import { isCalendarDate, PASSWORD_LENGTH } from '../../../lib/workforce/employee-create';
import { confirmError, formOverlayLabels } from '../../../lib/workforce/form-labels';
import { formatDate, formatDateTime } from '../../../lib/workforce/format';
import { withReauthentication } from '../../../lib/workforce/reauth';
import { runMutation } from '../../../lib/workforce/workflows';
import { useReauthentication } from '../reauth-dialog';
import { useAccount, useWorkforce } from '../session';
import { Badge, Notice, Section, useSubmit, type Tone } from '../ui';
import { EMPLOYEE_STATUS_TONE } from './employees';

/**
 * Employee lifecycle pieces of the detail screen (Employee management Step 3): profile,
 * employment classification (promotion, ending) and sign-in account (password reset,
 * status). The cards only show data; every change is a dialog opened from the page header
 * menu and calls the existing command. The API authorizes every command again.
 */

const CLASSIFICATION_TONE: Record<string, Tone> = {
  TRAINEE: 'info',
  COLLABORATOR: 'warning',
  OFFICIAL_EMPLOYEE: 'success',
  ENDED: 'neutral',
};

/** What a dialog calls when it succeeded: the page reloads, closes the dialog and shows a toast. */
type Done = (message: string) => void;

// ------------------------------------------------------------------ profile

export function ProfileSection({ employee }: { employee: EmployeeResponse }) {
  const { t, locale } = useWorkforce();
  const texts = t.employees.detail;
  return (
    <Section title={texts.profile}>
      <DescriptionList
        columns={2}
        items={[
          {
            label: texts.loginId,
            value: (
              <>
                <strong id="employee-login-id">{employee.employeeId}</strong>{' '}
                <span className="ls-hint">{texts.loginIdHint}</span>
              </>
            ),
          },
          { label: t.employees.fullName, value: employee.fullName },
          { label: texts.phone, value: employee.phone },
          {
            label: texts.email,
            value: employee.email ? (
              <>
                {employee.email}
                {!employee.emailVerified ? (
                  <span className="ls-hint"> ({texts.emailUnverified})</span>
                ) : null}
              </>
            ) : null,
          },
          { label: texts.dateOfBirth, value: formatDate(employee.dateOfBirth, locale) },
          { label: texts.address, value: employee.address },
          { label: texts.locale, value: texts.locales[employee.locale] },
        ]}
      />
    </Section>
  );
}

/** Edit the profile: only the fields the profile command supports, only those that changed. */
export function ProfileDialog({
  employee,
  onClose,
  onDone,
  reload,
}: {
  employee: EmployeeResponse;
  onClose: () => void;
  onDone: Done;
  reload: () => Promise<void>;
}) {
  const { api, t } = useWorkforce();
  const texts = t.employees.detail;
  const [form, setForm] = useState<ProfileForm>(() => profileForm(employee));
  const submit = useSubmit();
  const patch = profilePatch(employee, form);
  const set = <K extends keyof ProfileForm>(key: K, value: ProfileForm[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  async function save() {
    if (patch === null) return;
    const ok = await submit.run(
      () => runMutation(() => employeeCommands.updateProfile(api, employee.id, patch), reload),
      '',
    );
    if (ok) {
      await reload();
      onDone(t.common.saved);
    }
  }

  return (
    <FormDialog
      title={texts.editProfile}
      labels={formOverlayLabels(t, t.common.save)}
      busy={submit.pending}
      dirty={patch !== null}
      submitDisabled={patch === null}
      error={submitError(submit.error, t)}
      onClose={onClose}
      onSubmit={save}
    >
      <FormGrid cols={2}>
        <Field label={t.employees.fullName} required>
          {(control) => (
            <TextInput
              {...control}
              maxLength={200}
              value={form.fullName}
              onChange={(event) => set('fullName', event.target.value)}
            />
          )}
        </Field>
        <Field label={texts.phone} required>
          {(control) => (
            <TextInput
              {...control}
              type="tel"
              maxLength={32}
              autoComplete="off"
              value={form.phone}
              onChange={(event) => set('phone', event.target.value)}
            />
          )}
        </Field>
        <Field label={texts.dateOfBirth} required>
          {(control) => (
            <DateInput
              {...control}
              value={form.dateOfBirth}
              onChange={(event) => set('dateOfBirth', event.target.value)}
            />
          )}
        </Field>
        <Field label={texts.locale} required>
          {(control) => (
            <Select
              {...control}
              value={form.locale}
              onChange={(event) => set('locale', event.target.value === 'en' ? 'en' : 'vi')}
              options={[
                { value: 'vi', label: texts.locales.vi },
                { value: 'en', label: texts.locales.en },
              ]}
            />
          )}
        </Field>
        <Field label={texts.address} required full hint={texts.profileReadonlyNote}>
          {(control) => (
            <TextInput
              {...control}
              maxLength={500}
              value={form.address}
              onChange={(event) => set('address', event.target.value)}
            />
          )}
        </Field>
      </FormGrid>
    </FormDialog>
  );
}

/** The failed request as the dialog's error summary (null while there is none). */
function submitError(error: unknown, t: ReturnType<typeof useWorkforce>['t']) {
  return error ? <Notice tone="error">{detailErrorMessage(error, t)}</Notice> : undefined;
}

// ------------------------------------------------------------------ employment

export const TITLE_TONE: Record<string, Tone> = {
  MANAGER: 'success',
  EMPLOYEE: 'success',
  COLLABORATOR: 'warning',
  TRAINEE: 'info',
  NOT_STARTED: 'neutral',
  ENDED: 'neutral',
  OWNER: 'info',
};

/** The authoritative, server-derived title (never recomputed in the browser). */
export function TitleBadge({ employment }: { employment: EmploymentResponse | null }) {
  const { t } = useWorkforce();
  if (!employment) return null;
  return (
    <Badge tone={TITLE_TONE[employment.title] ?? 'neutral'}>
      {t.employees.titles[employment.title]}
    </Badge>
  );
}

export function ClassificationBadge({ employment }: { employment: EmploymentResponse | null }) {
  const { t } = useWorkforce();
  const current = employment?.current?.classification;
  if (!current) return <Badge tone="neutral">{t.employees.detail.notStarted}</Badge>;
  return (
    <Badge tone={CLASSIFICATION_TONE[current] ?? 'neutral'}>
      {t.employees.classifications[current]}
    </Badge>
  );
}

/** Current classification in a card, the recorded notices and the classification history table. */
export function EmploymentSection({
  employment,
  timeZone,
}: {
  employment: EmploymentResponse;
  /** Recording times are shown in the employee's (first) branch timezone. */
  timeZone: string;
}) {
  const { t, locale } = useWorkforce();
  const texts = t.employees.detail;
  const current = employment.current;
  const upcoming = employment.history.filter((entry) => entry.effectiveDate > employment.today);
  const columns: DataTableColumn<EmploymentClassificationEntry>[] = [
    {
      key: 'effectiveFrom',
      header: texts.effectiveFrom,
      mobileTitle: true,
      cell: (entry) => formatDate(entry.effectiveDate, locale),
    },
    {
      key: 'classification',
      header: t.employees.classification,
      cell: (entry) => t.employees.classifications[entry.classification],
    },
    {
      key: 'reason',
      header: texts.historyReason,
      truncate: true,
      width: 'lg',
      cell: (entry) => entry.reason ?? '—',
    },
    {
      key: 'recordedAt',
      header: texts.recordedAt,
      hideBelow: 'md',
      cell: (entry) => formatDateTime(entry.recordedAt, timeZone, locale),
    },
  ];
  return (
    <Stack gap="page">
      {upcoming.map((entry) => (
        <Notice key={entry.effectiveDate} tone="info">
          {fill(texts.upcoming, {
            label: t.employees.classifications[entry.classification],
            date: formatDate(entry.effectiveDate, locale),
          })}
        </Notice>
      ))}
      {employmentEnded(employment) && current ? (
        <Notice tone="warning">
          {fill(texts.endedNotice, { date: formatDate(current.effectiveDate, locale) })}
        </Notice>
      ) : null}
      <Section title={texts.employment}>
        <DescriptionList
          columns={2}
          items={[
            {
              label: texts.currentClassification,
              value: <ClassificationBadge employment={employment} />,
            },
            {
              label: texts.effectiveFrom,
              value: current ? formatDate(current.effectiveDate, locale) : null,
            },
            {
              label: texts.payrollEligible,
              value: employment.payrollEligibleToday ? texts.yes : texts.no,
            },
          ]}
        />
      </Section>
      <ListSection title={texts.history}>
        <DataTable
          mode="client"
          caption={texts.history}
          columns={columns}
          rows={[...employment.history].reverse()}
          rowKey={(entry) => entry.effectiveDate}
          paging={{ off: 'Classification only moves forward: a member has a handful of entries.' }}
        />
      </ListSection>
    </Stack>
  );
}

/** Move the classification forward (never back, never after ENDED). */
export function PromoteDialog({
  employee,
  employment,
  onClose,
  onDone,
  reload,
}: {
  employee: EmployeeResponse;
  employment: EmploymentResponse;
  onClose: () => void;
  onDone: Done;
  reload: () => Promise<void>;
}) {
  const { api, t, locale } = useWorkforce();
  const { account } = useAccount();
  const texts = t.employees.detail;
  const options = nextClassifications(latestClassification(employment));
  // An explicit choice; preselected only when there is a single possible target.
  const [target, setTarget] = useState<(typeof options)[number] | ''>(
    options.length === 1 ? options[0]! : '',
  );
  const [date, setDate] = useState(employment.today);
  const [reason, setReason] = useState('');
  const submit = useSubmit();
  const ownerOnly = backdatedForNonOwner(account, date, employment.today);

  async function save() {
    if (target === '' || !isCalendarDate(date) || reason.trim() === '' || ownerOnly) return;
    const ok = await submit.run(
      () =>
        runMutation(
          () =>
            employeeCommands.promote(
              api,
              employee.id,
              promotionRequest(employment.version, target, date, reason),
            ),
          reload,
        ),
      '',
    );
    if (ok) {
      await reload();
      onDone(
        fill(texts.promoted, {
          label: t.employees.classifications[target],
          date: formatDate(date, locale),
        }),
      );
    }
  }

  return (
    <FormDialog
      title={texts.promote}
      labels={formOverlayLabels(t, texts.promote)}
      busy={submit.pending}
      dirty={reason !== '' || date !== employment.today}
      submitDisabled={target === '' || ownerOnly || reason.trim() === ''}
      error={submitError(submit.error, t)}
      onClose={onClose}
      onSubmit={save}
    >
      <FormGrid>
        <p className="ls-hint">{texts.promoteHint}</p>
        <RadioGroup
          legend={texts.changeTo}
          name="promote-target"
          required
          value={target === '' ? null : target}
          onValueChange={(value) => setTarget(options.find((option) => option === value) ?? '')}
          options={options.map((option) => ({
            value: option,
            label: t.employees.classifications[option],
          }))}
        />
        <Field
          label={texts.effectiveDate}
          required
          width="md"
          {...(ownerOnly ? { error: texts.backdateOwnerOnly } : {})}
        >
          {(control) => (
            <DateInput
              {...control}
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          )}
        </Field>
        <Field label={t.common.reason} required>
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

/** End employment: states the access consequence before confirmation; nothing is deleted. */
export function EndDialog({
  employee,
  employment,
  canDisable,
  onClose,
  onDone,
  reload,
}: {
  employee: EmployeeResponse;
  employment: EmploymentResponse;
  canDisable: boolean;
  onClose: () => void;
  onDone: Done;
  reload: () => Promise<void>;
}) {
  const { api, t } = useWorkforce();
  const { account } = useAccount();
  const texts = t.employees.detail;
  const [date, setDate] = useState(employment.today);
  const [reason, setReason] = useState('');
  const [disableAccess, setDisableAccess] = useState(canDisable);
  const submit = useSubmit();
  const ownerOnly = backdatedForNonOwner(account, date, employment.today);
  const outcome = endingOutcome(date, employment.today, disableAccess, employee.status);

  async function save() {
    if (!isCalendarDate(date) || reason.trim() === '' || ownerOnly) return;
    let message = '';
    const ok = await submit.run(async () => {
      const result = await runMutation(
        () =>
          employeeCommands.endEmployment(
            api,
            employee.id,
            endRequest(employment.version, date, reason, disableAccess),
          ),
        reload,
      );
      if (result.ok) message = endAccessMessage(result.value.access, t);
      return result;
    }, '');
    if (ok) {
      await reload();
      onDone(message);
    }
  }

  return (
    <FormDialog
      title={texts.end}
      labels={formOverlayLabels(t, texts.endConfirm)}
      busy={submit.pending}
      dirty={reason !== ''}
      submitDisabled={ownerOnly || reason.trim() === ''}
      error={submitError(submit.error, t)}
      onClose={onClose}
      onSubmit={save}
    >
      <FormGrid>
        <p className="ls-hint">{texts.endHint}</p>
        <Field
          label={texts.effectiveDate}
          required
          width="md"
          {...(ownerOnly ? { error: texts.backdateOwnerOnly } : {})}
        >
          {(control) => (
            <DateInput
              {...control}
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          )}
        </Field>
        <Field label={t.common.reason} required>
          {(control) => (
            <TextInput
              {...control}
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          )}
        </Field>
        <CheckField
          name="end-disable-access"
          label={texts.disableAccess}
          checked={disableAccess}
          disabled={!canDisable}
          onChange={(event) => setDisableAccess(event.target.checked)}
          {...(!canDisable ? { hint: texts.noStatusPermission } : {})}
        />
        {/* The exact consequence, before confirmation (no scheduler for future dates). */}
        <Notice tone={outcome === 'FUTURE_NO_AUTO_DISABLE' ? 'warning' : 'info'}>
          {texts.outcome[outcome]}
        </Notice>
      </FormGrid>
    </FormDialog>
  );
}

// ------------------------------------------------------------------ sign-in account

export function AccessSection({
  employee,
  employment,
}: {
  employee: EmployeeResponse;
  employment: EmploymentResponse | null;
}) {
  const { t } = useWorkforce();
  const texts = t.employees.detail;
  const ended = employment ? employmentEnded(employment) : false;
  return (
    <Section title={texts.account}>
      <DescriptionList
        columns={2}
        items={[
          { label: texts.loginId, value: <strong>{employee.employeeId}</strong> },
          {
            label: texts.accountStatus,
            value: (
              <>
                <Badge tone={EMPLOYEE_STATUS_TONE[employee.status]}>
                  {t.employees.statuses[employee.status]}
                </Badge>{' '}
                <span className="ls-hint">{texts.statusHelp[employee.status]}</span>
              </>
            ),
          },
        ]}
      />
      {ended ? <p className="ls-hint">{texts.endedNoAccessChanges}</p> : null}
    </Section>
  );
}

/** Set or reset the sign-in password; the actor confirms their own password when the API asks. */
export function PasswordDialog({
  employee,
  onClose,
  onDone,
  reload,
}: {
  employee: EmployeeResponse;
  onClose: () => void;
  onDone: Done;
  reload: () => Promise<void>;
}) {
  const { api, t } = useWorkforce();
  const texts = t.employees.detail;
  const { confirm, dialog } = useReauthentication();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<'length' | 'mismatch' | null>(null);
  const submit = useSubmit();
  const title = employee.status === 'PENDING_SETUP' ? texts.setPassword : texts.resetPassword;

  async function save() {
    const found = passwordProblem(password, confirmation);
    setProblem(found);
    if (found !== null || reason.trim() === '') return;
    const request = credentialsRequest(employee.version, password, reason);
    const ok = await submit.run(
      () =>
        runMutation(
          // The actor confirms THEIR OWN password when the API asks (fresh reauthentication).
          () =>
            withReauthentication(
              () => employeeCommands.setCredentials(api, employee.id, request),
              confirm,
            ),
          reload,
        ),
      '',
    );
    // The password is never kept or shown again.
    setPassword('');
    setConfirmation('');
    if (ok) {
      await reload();
      onDone(fill(texts.passwordSet, { code: employee.employeeId }));
    }
  }

  const problems =
    problem === 'length' ? (
      <Notice tone="error">{texts.passwordLength}</Notice>
    ) : problem === 'mismatch' ? (
      <Notice tone="error">{texts.passwordMismatch}</Notice>
    ) : (
      submitError(submit.error, t)
    );

  return (
    <>
      {dialog}
      <FormDialog
        title={title}
        labels={formOverlayLabels(t, title)}
        busy={submit.pending}
        dirty={password !== '' || confirmation !== '' || reason !== ''}
        submitDisabled={reason.trim() === ''}
        error={problems}
        onClose={onClose}
        onSubmit={save}
      >
        <FormGrid>
          <p className="ls-hint">{fill(texts.resetHint, { code: employee.employeeId })}</p>
          <Field label={texts.newPassword} required hint={texts.passwordHint}>
            {(control) => (
              <PasswordInput
                {...control}
                showLabel={t.auth.showPassword}
                hideLabel={t.auth.hidePassword}
                minLength={PASSWORD_LENGTH.min}
                maxLength={PASSWORD_LENGTH.max}
                autoComplete="new-password"
                invalid={problem === 'length'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            )}
          </Field>
          <Field label={texts.confirmPassword} required>
            {(control) => (
              <PasswordInput
                {...control}
                showLabel={t.auth.showPassword}
                hideLabel={t.auth.hidePassword}
                autoComplete="new-password"
                invalid={problem === 'mismatch'}
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
              />
            )}
          </Field>
          <Field label={t.common.reason} required>
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
    </>
  );
}

/** Disable or re-enable sign-in: a confirmation with a required reason. */
export function StatusDialog({
  employee,
  onClose,
  onDone,
  reload,
}: {
  employee: EmployeeResponse;
  onClose: () => void;
  onDone: Done;
  reload: () => Promise<void>;
}) {
  const { api, t } = useWorkforce();
  const texts = t.employees.detail;
  const next = employee.status === 'INACTIVE' ? 'ACTIVE' : 'INACTIVE';
  const disabling = next === 'INACTIVE';
  return (
    <ConfirmDialog
      title={disabling ? texts.deactivateTitle : texts.reactivateTitle}
      description={texts.statusHelp[next]}
      facts={[{ label: texts.loginId, value: `${employee.fullName} · ${employee.employeeId}` }]}
      tone={disabling ? 'danger' : 'neutral'}
      confirmLabel={disabling ? texts.deactivate : texts.reactivate}
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
            employeeCommands.changeStatus(
              api,
              employee.id,
              statusRequest(employee.version, next, reason ?? ''),
            ),
          reload,
        );
        if (!outcome.ok) throw outcome.error;
        await reload();
        onDone(disabling ? texts.deactivated : texts.reactivated);
      }}
    />
  );
}
