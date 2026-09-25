'use client';

import type { EmployeeResponse, EmploymentResponse } from '@lucy-spa/contracts';
import { useState, type FormEvent } from 'react';
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
  promotionRequest,
  statusRequest,
  type DetailActions,
  type ProfileForm,
} from '../../../lib/workforce/employee-detail';
import { isCalendarDate, PASSWORD_LENGTH } from '../../../lib/workforce/employee-create';
import { formatDate, formatDateTime } from '../../../lib/workforce/format';
import { withReauthentication } from '../../../lib/workforce/reauth';
import { runMutation } from '../../../lib/workforce/workflows';
import { useReauthentication } from '../reauth-dialog';
import { useAccount, useWorkforce } from '../session';
import { Badge, Field, Notice, Section, SubmitButton, useSubmit, type Tone } from '../ui';
import { EMPLOYEE_STATUS_TONE } from './employees';

/**
 * Employee lifecycle sections of the detail screen (Employee management Step 3): profile,
 * employment classification (promotion, ending) and sign-in account (password reset,
 * status). Each action calls the existing command; the API authorizes every one again.
 */

const CLASSIFICATION_TONE: Record<string, Tone> = {
  TRAINEE: 'info',
  OFFICIAL_EMPLOYEE: 'success',
  ENDED: 'neutral',
};

type Submit = ReturnType<typeof useSubmit>;

function Feedback({ submit }: { submit: Submit }) {
  const { t } = useWorkforce();
  if (submit.error) return <Notice tone="error">{detailErrorMessage(submit.error, t)}</Notice>;
  if (submit.success) return <Notice tone="success">{submit.success}</Notice>;
  return null;
}

// ------------------------------------------------------------------ profile

export function ProfileSection({
  employee,
  actions,
  onChanged,
}: {
  employee: EmployeeResponse;
  actions: DetailActions;
  onChanged: () => Promise<void>;
}) {
  const { api, t, locale } = useWorkforce();
  const texts = t.employees.detail;
  const [form, setForm] = useState<ProfileForm>(() => profileForm(employee));
  const [unchanged, setUnchanged] = useState(false);
  const submit = useSubmit();
  const set = <K extends keyof ProfileForm>(key: K, value: ProfileForm[K]) => {
    setUnchanged(false);
    setForm((current) => ({ ...current, [key]: value }));
  };

  async function save(event: FormEvent) {
    event.preventDefault();
    const patch = profilePatch(employee, form);
    if (patch === null) {
      setUnchanged(true);
      return;
    }
    const ok = await submit.run(
      () => runMutation(() => employeeCommands.updateProfile(api, employee.id, patch), onChanged),
      t.common.saved,
    );
    if (ok) await onChanged();
  }

  return (
    <Section title={texts.profile}>
      <dl className="wf-facts">
        <dt>{texts.loginId}</dt>
        <dd>
          <strong id="employee-login-id">{employee.employeeId}</strong>{' '}
          <span className="wf-muted wf-small">{texts.loginIdHint}</span>
        </dd>
        <dt>{t.employees.fullName}</dt>
        <dd>{employee.fullName}</dd>
        <dt>{texts.phone}</dt>
        <dd>{employee.phone}</dd>
        <dt>{texts.email}</dt>
        <dd>
          {employee.email ?? '—'}
          {employee.email && !employee.emailVerified ? (
            <span className="wf-muted wf-small"> ({texts.emailUnverified})</span>
          ) : null}
        </dd>
        <dt>{texts.dateOfBirth}</dt>
        <dd>{formatDate(employee.dateOfBirth, locale)}</dd>
        <dt>{texts.address}</dt>
        <dd>{employee.address}</dd>
        <dt>{texts.locale}</dt>
        <dd>{texts.locales[employee.locale]}</dd>
      </dl>
      {actions.editProfile ? (
        <details className="wf-disclosure">
          <summary>{texts.editProfile}</summary>
          <form className="wf-form wf-member-form" onSubmit={(event) => void save(event)}>
            <p className="wf-hint">{texts.profileReadonlyNote}</p>
            <div className="wf-row">
              <Field id="profile-name" label={t.employees.fullName} required>
                <input
                  id="profile-name"
                  required
                  maxLength={200}
                  value={form.fullName}
                  onChange={(event) => set('fullName', event.target.value)}
                />
              </Field>
              <Field id="profile-dob" label={texts.dateOfBirth} required>
                <input
                  id="profile-dob"
                  type="date"
                  required
                  value={form.dateOfBirth}
                  onChange={(event) => set('dateOfBirth', event.target.value)}
                />
              </Field>
            </div>
            <div className="wf-row">
              <Field id="profile-address" label={texts.address} required>
                <input
                  id="profile-address"
                  required
                  maxLength={500}
                  value={form.address}
                  onChange={(event) => set('address', event.target.value)}
                />
              </Field>
              <Field id="profile-locale" label={texts.locale} required>
                <select
                  id="profile-locale"
                  value={form.locale}
                  onChange={(event) => set('locale', event.target.value === 'en' ? 'en' : 'vi')}
                >
                  <option value="vi">{texts.locales.vi}</option>
                  <option value="en">{texts.locales.en}</option>
                </select>
              </Field>
            </div>
            {unchanged ? <Notice tone="info">{texts.noChanges}</Notice> : null}
            <Feedback submit={submit} />
            <SubmitButton
              pending={submit.pending}
              label={t.common.save}
              pendingLabel={t.common.saving}
            />
          </form>
        </details>
      ) : null}
    </Section>
  );
}

// ------------------------------------------------------------------ employment

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

export function EmploymentSection({
  employee,
  employment,
  actions,
  timeZone,
  onChanged,
}: {
  employee: EmployeeResponse;
  employment: EmploymentResponse;
  actions: DetailActions;
  /** Recording times are shown in the employee's (first) branch timezone. */
  timeZone: string;
  onChanged: () => Promise<void>;
}) {
  const { t, locale } = useWorkforce();
  const texts = t.employees.detail;
  const current = employment.current;
  const upcoming = employment.history.filter((entry) => entry.effectiveDate > employment.today);
  const ended = employmentEnded(employment);
  // Kept here: after a promotion or ending the action itself is no longer offered.
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <Section title={texts.employment}>
      <dl className="wf-facts">
        <dt>{texts.currentClassification}</dt>
        <dd>
          <ClassificationBadge employment={employment} />
        </dd>
        <dt>{texts.effectiveFrom}</dt>
        <dd>{current ? formatDate(current.effectiveDate, locale) : '—'}</dd>
        <dt>{texts.payrollEligible}</dt>
        <dd>{employment.payrollEligibleToday ? texts.yes : texts.no}</dd>
      </dl>
      {upcoming.map((entry) => (
        <Notice key={entry.effectiveDate} tone="info">
          {fill(texts.upcoming, {
            label: t.employees.classifications[entry.classification],
            date: formatDate(entry.effectiveDate, locale),
          })}
        </Notice>
      ))}
      {ended && current ? (
        <Notice tone="warning">
          {fill(texts.endedNotice, { date: formatDate(current.effectiveDate, locale) })}
        </Notice>
      ) : null}
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      <h3>{texts.history}</h3>
      <table className="wf-table">
        <thead>
          <tr>
            <th scope="col">{texts.effectiveFrom}</th>
            <th scope="col">{t.employees.classification}</th>
            <th scope="col">{texts.historyReason}</th>
            <th scope="col">{texts.recordedAt}</th>
          </tr>
        </thead>
        <tbody>
          {[...employment.history].reverse().map((entry) => (
            <tr key={entry.effectiveDate}>
              <td data-label={texts.effectiveFrom}>{formatDate(entry.effectiveDate, locale)}</td>
              <td data-label={t.employees.classification}>
                {t.employees.classifications[entry.classification]}
              </td>
              <td data-label={texts.historyReason}>{entry.reason ?? '—'}</td>
              <td data-label={texts.recordedAt}>
                {formatDateTime(entry.recordedAt, timeZone, locale)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {actions.promote ? (
        <PromoteForm
          employee={employee}
          employment={employment}
          onDone={setNotice}
          onChanged={onChanged}
        />
      ) : null}
      {actions.end ? (
        <EndForm
          employee={employee}
          employment={employment}
          canDisable={actions.disableWhenEnding}
          onDone={setNotice}
          onChanged={onChanged}
        />
      ) : null}
    </Section>
  );
}

function PromoteForm({
  employee,
  employment,
  onDone,
  onChanged,
}: {
  employee: EmployeeResponse;
  employment: EmploymentResponse;
  onDone: (message: string) => void;
  onChanged: () => Promise<void>;
}) {
  const { api, t, locale } = useWorkforce();
  const { account } = useAccount();
  const texts = t.employees.detail;
  const [date, setDate] = useState(employment.today);
  const [reason, setReason] = useState('');
  const submit = useSubmit();
  const ownerOnly = backdatedForNonOwner(account, date, employment.today);

  async function promote(event: FormEvent) {
    event.preventDefault();
    if (!isCalendarDate(date) || reason.trim() === '' || ownerOnly) return;
    const ok = await submit.run(
      () =>
        runMutation(
          () =>
            employeeCommands.promote(
              api,
              employee.id,
              promotionRequest(employment.version, date, reason),
            ),
          onChanged,
        ),
      '',
    );
    if (ok) {
      onDone(fill(texts.promoted, { date: formatDate(date, locale) }));
      await onChanged();
    }
  }

  return (
    <details className="wf-disclosure">
      <summary>{texts.promote}</summary>
      <form className="wf-form wf-member-form" onSubmit={(event) => void promote(event)}>
        <p className="wf-hint">{texts.promoteHint}</p>
        <div className="wf-row">
          <Field id="promote-date" label={texts.effectiveDate} required>
            <input
              id="promote-date"
              type="date"
              required
              value={date}
              aria-invalid={ownerOnly || undefined}
              onChange={(event) => setDate(event.target.value)}
            />
          </Field>
          <Field id="promote-reason" label={t.common.reason} required>
            <input
              id="promote-reason"
              required
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
        </div>
        {ownerOnly ? <Notice tone="warning">{texts.backdateOwnerOnly}</Notice> : null}
        <Feedback submit={submit} />
        <SubmitButton
          pending={submit.pending}
          label={texts.promote}
          pendingLabel={t.common.saving}
          disabled={ownerOnly || reason.trim() === ''}
        />
      </form>
    </details>
  );
}

export function EndForm({
  employee,
  employment,
  canDisable,
  onDone,
  onChanged,
}: {
  employee: EmployeeResponse;
  employment: EmploymentResponse;
  canDisable: boolean;
  onDone: (message: string) => void;
  onChanged: () => Promise<void>;
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

  async function end(event: FormEvent) {
    event.preventDefault();
    if (!isCalendarDate(date) || reason.trim() === '' || ownerOnly) return;
    let message = '';
    const ok = await submit.run(async () => {
      const outcome = await runMutation(
        () =>
          employeeCommands.endEmployment(
            api,
            employee.id,
            endRequest(employment.version, date, reason, disableAccess),
          ),
        onChanged,
      );
      if (outcome.ok) message = endAccessMessage(outcome.value.access, t);
      return outcome;
    }, '');
    if (ok) {
      onDone(message);
      await onChanged();
    }
  }

  return (
    <details className="wf-disclosure">
      <summary>{texts.end}</summary>
      <form className="wf-form wf-member-form" onSubmit={(event) => void end(event)}>
        <p className="wf-hint">{texts.endHint}</p>
        <div className="wf-row">
          <Field id="end-date" label={texts.effectiveDate} required>
            <input
              id="end-date"
              type="date"
              required
              value={date}
              aria-invalid={ownerOnly || undefined}
              onChange={(event) => setDate(event.target.value)}
            />
          </Field>
          <Field id="end-reason" label={t.common.reason} required>
            <input
              id="end-reason"
              required
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
        </div>
        <div className="wf-checklist">
          <label>
            <input
              type="checkbox"
              name="end-disable-access"
              checked={disableAccess}
              disabled={!canDisable}
              onChange={(event) => setDisableAccess(event.target.checked)}
            />
            {texts.disableAccess}
          </label>
        </div>
        {!canDisable ? <p className="wf-hint">{texts.noStatusPermission}</p> : null}
        {/* The exact consequence, before confirmation (no scheduler for future dates). */}
        <Notice tone={outcome === 'FUTURE_NO_AUTO_DISABLE' ? 'warning' : 'info'}>
          {texts.outcome[outcome]}
        </Notice>
        {ownerOnly ? <Notice tone="warning">{texts.backdateOwnerOnly}</Notice> : null}
        <Feedback submit={submit} />
        <SubmitButton
          pending={submit.pending}
          label={texts.endConfirm}
          pendingLabel={t.common.saving}
          tone="danger"
          disabled={ownerOnly || reason.trim() === ''}
        />
      </form>
    </details>
  );
}

// ------------------------------------------------------------------ sign-in account

export function AccessSection({
  employee,
  employment,
  actions,
  onChanged,
}: {
  employee: EmployeeResponse;
  employment: EmploymentResponse | null;
  actions: DetailActions;
  onChanged: () => Promise<void>;
}) {
  const { t } = useWorkforce();
  const texts = t.employees.detail;
  const ended = employment ? employmentEnded(employment) : false;
  return (
    <Section title={texts.account}>
      <dl className="wf-facts">
        <dt>{texts.loginId}</dt>
        <dd>
          <strong>{employee.employeeId}</strong>
        </dd>
        <dt>{texts.accountStatus}</dt>
        <dd>
          <Badge tone={EMPLOYEE_STATUS_TONE[employee.status]}>
            {t.employees.statuses[employee.status]}
          </Badge>{' '}
          <span className="wf-muted wf-small">{texts.statusHelp[employee.status]}</span>
        </dd>
      </dl>
      {ended ? <p className="wf-hint">{texts.endedNoAccessChanges}</p> : null}
      {actions.resetPassword ? <PasswordForm employee={employee} onChanged={onChanged} /> : null}
      {actions.deactivate || actions.reactivate ? (
        <StatusForm employee={employee} onChanged={onChanged} />
      ) : null}
    </Section>
  );
}

export function PasswordForm({
  employee,
  onChanged,
}: {
  employee: EmployeeResponse;
  onChanged: () => Promise<void>;
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

  async function save(event: FormEvent) {
    event.preventDefault();
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
          onChanged,
        ),
      fill(texts.passwordSet, { code: employee.employeeId }),
    );
    // The password is never kept or shown again.
    setPassword('');
    setConfirmation('');
    if (ok) {
      setReason('');
      await onChanged();
    }
  }

  return (
    <>
      {dialog}
      <details className="wf-disclosure">
        <summary>{title}</summary>
        <form className="wf-form wf-member-form" onSubmit={(event) => void save(event)}>
          <p className="wf-hint">{fill(texts.resetHint, { code: employee.employeeId })}</p>
          <div className="wf-row">
            <Field id="reset-password" label={texts.newPassword} required hint={texts.passwordHint}>
              <input
                id="reset-password"
                type="password"
                required
                minLength={PASSWORD_LENGTH.min}
                maxLength={PASSWORD_LENGTH.max}
                autoComplete="new-password"
                aria-invalid={problem === 'length' || undefined}
                aria-describedby="reset-password-hint"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </Field>
            <Field id="reset-password-confirm" label={texts.confirmPassword} required>
              <input
                id="reset-password-confirm"
                type="password"
                required
                autoComplete="new-password"
                aria-invalid={problem === 'mismatch' || undefined}
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
              />
            </Field>
          </div>
          <Field id="reset-reason" label={t.common.reason} required>
            <input
              id="reset-reason"
              required
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
          {problem === 'length' ? <Notice tone="error">{texts.passwordLength}</Notice> : null}
          {problem === 'mismatch' ? <Notice tone="error">{texts.passwordMismatch}</Notice> : null}
          <Feedback submit={submit} />
          <SubmitButton
            pending={submit.pending}
            label={title}
            pendingLabel={t.common.saving}
            disabled={reason.trim() === ''}
          />
        </form>
      </details>
    </>
  );
}

function StatusForm({
  employee,
  onChanged,
}: {
  employee: EmployeeResponse;
  onChanged: () => Promise<void>;
}) {
  const { api, t } = useWorkforce();
  const texts = t.employees.detail;
  const [reason, setReason] = useState('');
  const submit = useSubmit();
  const next = employee.status === 'INACTIVE' ? 'ACTIVE' : 'INACTIVE';
  const label = next === 'INACTIVE' ? texts.deactivate : texts.reactivate;

  async function save(event: FormEvent) {
    event.preventDefault();
    if (reason.trim() === '') return;
    const ok = await submit.run(
      () =>
        runMutation(
          () =>
            employeeCommands.changeStatus(
              api,
              employee.id,
              statusRequest(employee.version, next, reason),
            ),
          onChanged,
        ),
      next === 'INACTIVE' ? texts.deactivated : texts.reactivated,
    );
    if (ok) {
      setReason('');
      await onChanged();
    }
  }

  return (
    <details className="wf-disclosure">
      <summary>{label}</summary>
      <form className="wf-form wf-member-form" onSubmit={(event) => void save(event)}>
        <Field id="status-reason" label={t.common.reason} required>
          <input
            id="status-reason"
            required
            maxLength={500}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
        <Feedback submit={submit} />
        <SubmitButton
          pending={submit.pending}
          label={label}
          pendingLabel={t.common.saving}
          tone={next === 'INACTIVE' ? 'danger' : 'primary'}
          disabled={reason.trim() === ''}
        />
      </form>
    </details>
  );
}
