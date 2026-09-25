'use client';

import type {
  BranchSummary,
  EmployeeResponse,
  InitialEmploymentClassification,
} from '@lucy-spa/contracts';
import { useMemo, useRef, useState, type FormEvent } from 'react';
import { fill } from '../../../i18n/workforce';
import {
  businessToday,
  createEmployee,
  createErrorMessage,
  createProblems,
  creatableBranches,
  emptyCreateForm,
  needsStartReason,
  officialAvailability,
  oneAtATime,
  toCreateRequest,
  type CreateForm,
  type CreateProblem,
} from '../../../lib/workforce/employee-create';
import { useAccount, useWorkforce } from '../session';
import { Field, Notice, SubmitButton } from '../ui';

/**
 * "Add workforce member" form (Employee management Step 2). Only the fields of the existing
 * create API; the classification is an explicit choice and ENDED is never offered. No
 * salary, password, setup link, role, permission or skill: those are separate steps.
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
  // The submitter below is created once; it always reads the latest values from here.
  const latest = useRef({ form, api, t, branches, onCreated });
  latest.current = { form, api, t, branches, onCreated };

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
        const created = await createEmployee(current.api, request);
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
    const found = createProblems(form, availability, today);
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
    <form className="wf-form wf-member-form" noValidate onSubmit={submit} aria-label={texts.title}>
      <p className="wf-muted">{texts.intro}</p>
      <Notice tone="info">{texts.accountNote}</Notice>

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

      {problems.length > 0 ? (
        <Notice tone="error">
          {fill(texts.missing, {
            fields: [...new Set(problems.map(problemLabel))].join(', '),
          })}
          {problems.includes('official') && officialNote ? <> {officialNote}</> : null}
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
  );
}
