'use client';

import type {
  BranchSummary,
  EmployeeResponse,
  InitialEmploymentClassification,
} from '@lucy-spa/contracts';
import { useMemo, useRef, useState, type FormEvent } from 'react';
import { fill, type WorkforceDictionary } from '../../../i18n/workforce';
import { withReauthentication } from '../../../lib/workforce/reauth';
import {
  businessToday,
  canProvisionAccess,
  createEmployee,
  createErrorMessage,
  createProblems,
  creatableBranches,
  emptyCreateForm,
  loginIdPreview,
  needsStartReason,
  officialAvailability,
  oneAtATime,
  PASSWORD_LENGTH,
  toCreateRequest,
  type CreateForm,
  type CreateProblem,
} from '../../../lib/workforce/employee-create';
import { useReauthentication } from '../reauth-dialog';
import { useAccount, useWorkforce } from '../session';
import { Field, Notice, SubmitButton } from '../ui';

/**
 * "Add workforce member" form (Employee management Step 2). Only the fields of the existing
 * create API; the classification is an explicit choice and ENDED is never offered. Sign-in
 * access can be set up in the same atomic request (the employee code is the login ID, the
 * creator sets an initial password and confirms their own password when the API asks). No
 * salary, setup link, role, permission or skill: those are separate steps.
 */
export function EmployeeCreateForm({
  branches,
  onCreated,
  onCancel,
}: {
  branches: ReadonlyMap<string, BranchSummary> | null;
  onCreated: (employee: EmployeeResponse, classification: InitialEmploymentClassification) => void;
  onCancel: () => void;
}) {
  const { api, t, locale } = useWorkforce();
  const { account } = useAccount();
  const texts = t.employees.create;
  const options = useMemo(
    () => creatableBranches(account, branches?.values() ?? []),
    [account, branches],
  );
  const [form, setForm] = useState<CreateForm>(() =>
    // A single permitted branch is preselected; nothing else is assumed.
    emptyCreateForm(locale, options.length === 1 ? [options[0]!.id] : []),
  );
  const [problems, setProblems] = useState<CreateProblem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const availability = officialAvailability(account, form.branchIds);
  const today = businessToday(form.branchIds, branches);
  const askReason = needsStartReason(form, today);
  const accessOffered = canProvisionAccess(account, []);
  const accessAllowed = canProvisionAccess(account, form.branchIds);
  const { confirm, dialog } = useReauthentication();
  // The submitter below is created once; it always reads the latest values from here.
  const latest = useRef({ form, api, t, branches, onCreated, confirm });
  latest.current = { form, api, t, branches, onCreated, confirm };

  // One request at a time, whatever the number of clicks or Enter presses.
  const submitOnce = useRef(
    oneAtATime(async () => {
      const current = latest.current;
      setPending(true);
      setError(null);
      try {
        const request = toCreateRequest(
          current.form,
          businessToday(current.form.branchIds, current.branches),
        );
        // Setting up access needs a recent password confirmation of the creator: when the
        // API asks, the dialog confirms it and the same request is sent once more.
        const created = await withReauthentication(
          () => createEmployee(current.api, request),
          current.confirm,
        );
        current.onCreated(created, request.classification);
      } catch (failure) {
        setError(createErrorMessage(failure, current.t));
      } finally {
        setPending(false);
      }
    }),
  );

  function submit(event: FormEvent) {
    event.preventDefault();
    const found = createProblems(form, availability, today, accessAllowed);
    setProblems(found);
    if (found.length > 0) return;
    void submitOnce.current();
  }

  const set = <K extends keyof CreateForm>(key: K, value: CreateForm[K]) =>
    setForm((current) => ({ ...current, [key]: value }));
  const invalid = (problem: CreateProblem) => problems.includes(problem) || undefined;
  const problemLabel = (problem: CreateProblem) =>
    problem === 'official' ? texts.fields.classification : texts.fields[problem];
  const officialNote =
    availability === 'noPay'
      ? texts.officialNoPay
      : availability === 'noPayForBranches'
        ? texts.officialNoPayForBranches
        : null;

  if (options.length === 0 && branches !== null) {
    return <Notice tone="info">{texts.noBranches}</Notice>;
  }

  return (
    <>
      {/* Outside the form: the confirmation dialog has its own form. */}
      {dialog}
      <form
        className="wf-form wf-member-form"
        noValidate
        onSubmit={submit}
        aria-label={texts.title}
      >
        <p className="wf-muted">{texts.intro}</p>

        <fieldset className="wf-fieldset">
          <legend className="wf-legend">{texts.personal}</legend>
          <div className="wf-row">
            <Field
              id="new-employee-id"
              label={texts.fields.employeeId}
              required
              hint={texts.employeeIdHint}
            >
              <input
                id="new-employee-id"
                required
                maxLength={64}
                autoComplete="off"
                aria-invalid={invalid('employeeId')}
                aria-describedby="new-employee-id-hint"
                value={form.employeeId}
                onChange={(event) => set('employeeId', event.target.value)}
              />
            </Field>
            <Field id="new-full-name" label={texts.fields.fullName} required>
              <input
                id="new-full-name"
                required
                maxLength={200}
                autoComplete="off"
                aria-invalid={invalid('fullName')}
                value={form.fullName}
                onChange={(event) => set('fullName', event.target.value)}
              />
            </Field>
          </div>
          <div className="wf-row">
            <Field id="new-dob" label={texts.fields.dateOfBirth} required>
              <input
                id="new-dob"
                type="date"
                required
                min="1900-01-01"
                aria-invalid={invalid('dateOfBirth')}
                value={form.dateOfBirth}
                onChange={(event) => set('dateOfBirth', event.target.value)}
              />
            </Field>
            <Field id="new-phone" label={texts.fields.phone} required hint={texts.phoneHint}>
              <input
                id="new-phone"
                type="tel"
                required
                maxLength={32}
                autoComplete="off"
                aria-invalid={invalid('phone')}
                aria-describedby="new-phone-hint"
                value={form.phone}
                onChange={(event) => set('phone', event.target.value)}
              />
            </Field>
          </div>
          <div className="wf-row">
            <Field id="new-email" label={texts.fields.email} hint={texts.emailHint}>
              <input
                id="new-email"
                type="email"
                maxLength={254}
                autoComplete="off"
                aria-describedby="new-email-hint"
                value={form.email}
                onChange={(event) => set('email', event.target.value)}
              />
            </Field>
            <Field id="new-locale" label={texts.fields.locale} required>
              <select
                id="new-locale"
                value={form.locale}
                onChange={(event) => set('locale', event.target.value === 'en' ? 'en' : 'vi')}
              >
                <option value="vi">Tiếng Việt</option>
                <option value="en">English</option>
              </select>
            </Field>
          </div>
          <Field id="new-address" label={texts.fields.address} required>
            <input
              id="new-address"
              required
              maxLength={500}
              autoComplete="off"
              aria-invalid={invalid('address')}
              value={form.address}
              onChange={(event) => set('address', event.target.value)}
            />
          </Field>
        </fieldset>

        <fieldset className="wf-fieldset">
          <legend className="wf-legend">{texts.employment}</legend>
          <fieldset className="wf-choices">
            <legend>
              {texts.fields.classification}
              <span className="wf-required" aria-hidden="true">
                {' '}
                *
              </span>
            </legend>
            <label>
              <input
                type="radio"
                name="new-classification"
                value="TRAINEE"
                required
                checked={form.classification === 'TRAINEE'}
                onChange={() => set('classification', 'TRAINEE')}
              />
              <span>
                <strong>{t.employees.classifications.TRAINEE}</strong>
                <span className="wf-hint">{texts.traineeHint}</span>
              </span>
            </label>
            <label>
              <input
                type="radio"
                name="new-classification"
                value="COLLABORATOR"
                checked={form.classification === 'COLLABORATOR'}
                onChange={() => set('classification', 'COLLABORATOR')}
              />
              <span>
                <strong>{t.employees.classifications.COLLABORATOR}</strong>
                <span className="wf-hint">{texts.collaboratorHint}</span>
              </span>
            </label>
            <label>
              <input
                type="radio"
                name="new-classification"
                value="OFFICIAL_EMPLOYEE"
                disabled={availability !== 'allowed'}
                aria-describedby={officialNote ? 'new-official-note' : undefined}
                checked={form.classification === 'OFFICIAL_EMPLOYEE'}
                onChange={() => set('classification', 'OFFICIAL_EMPLOYEE')}
              />
              <span>
                <strong>{t.employees.classifications.OFFICIAL_EMPLOYEE}</strong>
                <span className="wf-hint">{texts.officialHint}</span>
              </span>
            </label>
            {officialNote ? (
              <p className="wf-hint" id="new-official-note">
                {officialNote}
              </p>
            ) : null}
          </fieldset>
          <div className="wf-row">
            <Field
              id="new-start"
              label={texts.fields.employmentStartDate}
              required
              hint={texts.startHint}
            >
              <input
                id="new-start"
                type="date"
                required
                min="2000-01-01"
                max="2100-12-31"
                aria-invalid={invalid('employmentStartDate')}
                aria-describedby="new-start-hint"
                value={form.employmentStartDate}
                onChange={(event) => set('employmentStartDate', event.target.value)}
              />
            </Field>
          </div>
          {askReason ? (
            <Field
              id="new-start-reason"
              label={texts.fields.employmentReason}
              required
              hint={texts.reasonHint}
            >
              <textarea
                id="new-start-reason"
                required
                maxLength={500}
                rows={2}
                aria-invalid={invalid('employmentReason')}
                aria-describedby="new-start-reason-hint"
                value={form.employmentReason}
                onChange={(event) => set('employmentReason', event.target.value)}
              />
            </Field>
          ) : null}
        </fieldset>

        <fieldset className="wf-checklist">
          <legend className="wf-legend">
            {texts.branches}
            <span className="wf-required" aria-hidden="true">
              {' '}
              *
            </span>
          </legend>
          <p className="wf-hint">{texts.branchesHint}</p>
          {options.map((branch) => (
            <label key={branch.id}>
              <input
                type="checkbox"
                name="new-branches"
                value={branch.id}
                checked={form.branchIds.includes(branch.id)}
                onChange={(event) =>
                  set(
                    'branchIds',
                    event.target.checked
                      ? [...form.branchIds, branch.id]
                      : form.branchIds.filter((id) => id !== branch.id),
                  )
                }
              />
              {branch.name} <span className="wf-muted wf-small">({branch.code})</span>
            </label>
          ))}
        </fieldset>

        {accessOffered ? (
          <AccessFields
            form={form}
            set={set}
            accessAllowed={accessAllowed}
            invalid={invalid}
            t={t}
          />
        ) : (
          <Notice tone="info">{texts.accountNote}</Notice>
        )}

        {problems.length > 0 ? (
          <Notice tone="error">
            {fill(texts.missing, {
              fields: [...new Set(problems.map(problemLabel))].join(', '),
            })}
            {problems.includes('official') && officialNote ? <> {officialNote}</> : null}
            {problems.includes('access') ? <> {texts.accessNotAllowed}</> : null}
            {problems.includes('initialPassword') ? <> {texts.passwordHint}</> : null}
          </Notice>
        ) : null}
        {error ? <Notice tone="error">{error}</Notice> : null}
        <div className="wf-form-actions">
          <SubmitButton pending={pending} label={texts.submit} pendingLabel={texts.submitting} />
          <button type="button" className="wf-button" onClick={onCancel} disabled={pending}>
            {t.common.cancel}
          </button>
        </div>
      </form>
    </>
  );
}

/**
 * "Cấp tài khoản đăng nhập ngay": the employee code is shown as the login ID (never a second
 * identifier) and the creator sets an initial password under the existing policy.
 */
export function AccessFields({
  form,
  set,
  accessAllowed,
  invalid,
  t,
}: {
  form: CreateForm;
  set: <K extends keyof CreateForm>(key: K, value: CreateForm[K]) => void;
  accessAllowed: boolean;
  invalid: (problem: CreateProblem) => true | undefined;
  t: WorkforceDictionary;
}) {
  const texts = t.employees.create;
  const loginId = loginIdPreview(form.employeeId);
  return (
    <fieldset className="wf-fieldset">
      <legend className="wf-legend">{texts.accessSection}</legend>
      <div className="wf-checklist">
        <label>
          <input
            type="checkbox"
            name="new-provision-access"
            checked={form.provisionAccess}
            onChange={(event) => set('provisionAccess', event.target.checked)}
          />
          {texts.provisionAccess}
        </label>
      </div>
      {form.provisionAccess ? (
        <>
          <p className="wf-hint">{texts.provisionHint}</p>
          <p>
            <strong>{texts.loginId}:</strong>{' '}
            {loginId ? (
              <output id="new-login-id" className="wf-emphasis">
                {loginId}
              </output>
            ) : (
              <span className="wf-muted">{texts.loginIdPending}</span>
            )}
          </p>
          {!accessAllowed ? <Notice tone="warning">{texts.accessNotAllowed}</Notice> : null}
          <div className="wf-row">
            <Field
              id="new-password"
              label={texts.fields.initialPassword}
              required
              hint={texts.passwordHint}
            >
              <input
                id="new-password"
                type="password"
                required
                minLength={PASSWORD_LENGTH.min}
                maxLength={PASSWORD_LENGTH.max}
                autoComplete="new-password"
                aria-invalid={invalid('initialPassword')}
                aria-describedby="new-password-hint"
                value={form.initialPassword}
                onChange={(event) => set('initialPassword', event.target.value)}
              />
            </Field>
            <Field id="new-password-confirm" label={texts.fields.confirmPassword} required>
              <input
                id="new-password-confirm"
                type="password"
                required
                autoComplete="new-password"
                aria-invalid={invalid('confirmPassword')}
                value={form.confirmPassword}
                onChange={(event) => set('confirmPassword', event.target.value)}
              />
            </Field>
          </div>
        </>
      ) : (
        <Notice tone="info">{texts.accountNote}</Notice>
      )}
    </fieldset>
  );
}
