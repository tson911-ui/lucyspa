'use client';

import type {
  BranchSummary,
  EmployeeResponse,
  InitialEmploymentClassification,
} from '@lucy-spa/contracts';
import {
  Breadcrumbs,
  Card,
  CheckField,
  DateInput,
  Field,
  FormActions,
  FormGrid,
  FormSection,
  PasswordInput,
  Page,
  RadioGroup,
  Select,
  Stack,
  Textarea,
  TextInput,
} from '@lucy-spa/ui';
import Link from 'next/link';
import { useMemo, useRef, useState, type FormEvent } from 'react';
import { fill, type WorkforceDictionary } from '../../../i18n/workforce';
import { organizationDictionary } from '../../../i18n/organization';
import { withReauthentication } from '../../../lib/workforce/reauth';
import {
  businessToday,
  canOfferCreate,
  canProvisionAccess,
  createdMessage,
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
import { useBranches } from '../data';
import { useReauthentication } from '../reauth-dialog';
import { useAccount, useWorkforce } from '../session';
import { Button, ErrorState, Loading, Notice, PageHeader, useSuccessToast } from '../ui';

/**
 * "Add workforce member" on its own page (long form, contract FR9): `/employees/new`. After a
 * creation the member's page opens with a toast that says whether they can sign in yet.
 */
export function EmployeeCreateScreen() {
  const { api, t, locale, base, navigate } = useWorkforce();
  const { account } = useAccount();
  const notify = useSuccessToast();
  const branches = useBranches(api);
  const text = organizationDictionary(locale);
  const back = `${base}/employees`;

  return (
    <Page width="form">
      <PageHeader
        title={t.employees.create.title}
        breadcrumbs={
          <Breadcrumbs
            label={text.breadcrumbs}
            LinkComponent={Link}
            items={[{ label: t.employees.title, href: back }, { label: t.employees.create.title }]}
          />
        }
      />
      {!canOfferCreate(account) ? (
        <Notice tone="info">{t.errors.forbidden}</Notice>
      ) : branches.error ? (
        <ErrorState error={branches.error} t={t} onRetry={() => void branches.reload()} />
      ) : branches.data ? (
        <EmployeeCreateForm
          branches={branches.data}
          onCreated={(employee, classification) => {
            notify(createdMessage(employee, classification, t));
            navigate?.(`${base}/employees/${employee.id}`);
          }}
          onCancel={() => navigate?.(back)}
        />
      ) : (
        <Loading t={t} />
      )}
    </Page>
  );
}

/**
 * The form (Employee management Step 2). Only the fields of the existing create API; the
 * classification is an explicit choice and ENDED is never offered. Sign-in access can be set up
 * in the same atomic request (the employee code is the login ID, the creator sets an initial
 * password and confirms their own password when the API asks). No salary, setup link, role,
 * permission or skill: those are separate steps.
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
      <form noValidate onSubmit={submit} aria-label={texts.title}>
        <Stack gap="block">
          <Card as="section" aria-label={texts.title}>
            <Stack gap="page">
              <p className="ls-hint">{texts.intro}</p>

              <FormSection title={texts.personal}>
                <FormGrid cols={2}>
                  <Field label={texts.fields.employeeId} required hint={texts.employeeIdHint}>
                    {(control) => (
                      <TextInput
                        {...control}
                        maxLength={64}
                        autoComplete="off"
                        invalid={invalid('employeeId')}
                        value={form.employeeId}
                        onChange={(event) => set('employeeId', event.target.value)}
                      />
                    )}
                  </Field>
                  <Field label={texts.fields.fullName} required>
                    {(control) => (
                      <TextInput
                        {...control}
                        maxLength={200}
                        autoComplete="off"
                        invalid={invalid('fullName')}
                        value={form.fullName}
                        onChange={(event) => set('fullName', event.target.value)}
                      />
                    )}
                  </Field>
                  <Field label={texts.fields.dateOfBirth} required>
                    {(control) => (
                      <DateInput
                        {...control}
                        min="1900-01-01"
                        invalid={invalid('dateOfBirth')}
                        value={form.dateOfBirth}
                        onChange={(event) => set('dateOfBirth', event.target.value)}
                      />
                    )}
                  </Field>
                  <Field label={texts.fields.phone} required hint={texts.phoneHint}>
                    {(control) => (
                      <TextInput
                        {...control}
                        type="tel"
                        maxLength={32}
                        autoComplete="off"
                        invalid={invalid('phone')}
                        value={form.phone}
                        onChange={(event) => set('phone', event.target.value)}
                      />
                    )}
                  </Field>
                  <Field label={texts.fields.email} hint={texts.emailHint}>
                    {(control) => (
                      <TextInput
                        {...control}
                        type="email"
                        maxLength={254}
                        autoComplete="off"
                        value={form.email}
                        onChange={(event) => set('email', event.target.value)}
                      />
                    )}
                  </Field>
                  <Field label={texts.fields.locale} required>
                    {(control) => (
                      <Select
                        {...control}
                        value={form.locale}
                        onChange={(event) =>
                          set('locale', event.target.value === 'en' ? 'en' : 'vi')
                        }
                        options={[
                          { value: 'vi', label: 'Tiếng Việt' },
                          { value: 'en', label: 'English' },
                        ]}
                      />
                    )}
                  </Field>
                  <Field label={texts.fields.address} required full>
                    {(control) => (
                      <TextInput
                        {...control}
                        maxLength={500}
                        autoComplete="off"
                        invalid={invalid('address')}
                        value={form.address}
                        onChange={(event) => set('address', event.target.value)}
                      />
                    )}
                  </Field>
                </FormGrid>
              </FormSection>

              <FormSection title={texts.employment}>
                <FormGrid>
                  <RadioGroup
                    legend={texts.fields.classification}
                    name="new-classification"
                    required
                    invalid={problems.includes('classification') || problems.includes('official')}
                    value={form.classification === '' ? null : form.classification}
                    onValueChange={(value) =>
                      set(
                        'classification',
                        value === 'TRAINEE' ||
                          value === 'COLLABORATOR' ||
                          value === 'OFFICIAL_EMPLOYEE'
                          ? value
                          : '',
                      )
                    }
                    options={[
                      {
                        value: 'TRAINEE',
                        label: t.employees.classifications.TRAINEE,
                        hint: texts.traineeHint,
                      },
                      {
                        value: 'COLLABORATOR',
                        label: t.employees.classifications.COLLABORATOR,
                        hint: texts.collaboratorHint,
                      },
                      {
                        value: 'OFFICIAL_EMPLOYEE',
                        label: t.employees.classifications.OFFICIAL_EMPLOYEE,
                        hint: texts.officialHint,
                        disabled: availability !== 'allowed',
                      },
                    ]}
                  />
                  {officialNote ? (
                    <p className="ls-hint" id="new-official-note">
                      {officialNote}
                    </p>
                  ) : null}
                  <Field
                    label={texts.fields.employmentStartDate}
                    required
                    width="md"
                    hint={texts.startHint}
                  >
                    {(control) => (
                      <DateInput
                        {...control}
                        min="2000-01-01"
                        max="2100-12-31"
                        invalid={invalid('employmentStartDate')}
                        value={form.employmentStartDate}
                        onChange={(event) => set('employmentStartDate', event.target.value)}
                      />
                    )}
                  </Field>
                  {askReason ? (
                    <Field label={texts.fields.employmentReason} required hint={texts.reasonHint}>
                      {(control) => (
                        <Textarea
                          {...control}
                          maxLength={500}
                          rows={2}
                          invalid={invalid('employmentReason')}
                          value={form.employmentReason}
                          onChange={(event) => set('employmentReason', event.target.value)}
                        />
                      )}
                    </Field>
                  ) : null}
                </FormGrid>
              </FormSection>

              <FormSection title={texts.branches} description={texts.branchesHint}>
                {options.map((branch) => (
                  <CheckField
                    key={branch.id}
                    name="new-branches"
                    value={branch.id}
                    invalid={problems.includes('branchIds')}
                    checked={form.branchIds.includes(branch.id)}
                    label={`${branch.name} (${branch.code})`}
                    onChange={(event) =>
                      set(
                        'branchIds',
                        event.target.checked
                          ? [...form.branchIds, branch.id]
                          : form.branchIds.filter((id) => id !== branch.id),
                      )
                    }
                  />
                ))}
              </FormSection>

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
            </Stack>
          </Card>
          <FormActions
            cancel={
              <Button variant="secondary" onClick={onCancel} disabled={pending}>
                {t.common.cancel}
              </Button>
            }
            primary={
              <Button type="submit" variant="primary" loading={pending}>
                {pending ? texts.submitting : texts.submit}
              </Button>
            }
          />
        </Stack>
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
    <FormSection title={texts.accessSection}>
      <CheckField
        name="new-provision-access"
        label={texts.provisionAccess}
        hint={form.provisionAccess ? texts.provisionHint : undefined}
        checked={form.provisionAccess}
        onChange={(event) => set('provisionAccess', event.target.checked)}
      />
      {form.provisionAccess ? (
        <>
          <p>
            <strong>{texts.loginId}:</strong>{' '}
            {loginId ? (
              <output id="new-login-id">{loginId}</output>
            ) : (
              <span className="ls-hint">{texts.loginIdPending}</span>
            )}
          </p>
          {!accessAllowed ? <Notice tone="warning">{texts.accessNotAllowed}</Notice> : null}
          <FormGrid cols={2}>
            <Field label={texts.fields.initialPassword} required hint={texts.passwordHint}>
              {(control) => (
                <PasswordInput
                  {...control}
                  showLabel={t.auth.showPassword}
                  hideLabel={t.auth.hidePassword}
                  minLength={PASSWORD_LENGTH.min}
                  maxLength={PASSWORD_LENGTH.max}
                  autoComplete="new-password"
                  invalid={invalid('initialPassword')}
                  value={form.initialPassword}
                  onChange={(event) => set('initialPassword', event.target.value)}
                />
              )}
            </Field>
            <Field label={texts.fields.confirmPassword} required>
              {(control) => (
                <PasswordInput
                  {...control}
                  showLabel={t.auth.showPassword}
                  hideLabel={t.auth.hidePassword}
                  autoComplete="new-password"
                  invalid={invalid('confirmPassword')}
                  value={form.confirmPassword}
                  onChange={(event) => set('confirmPassword', event.target.value)}
                />
              )}
            </Field>
          </FormGrid>
        </>
      ) : (
        <Notice tone="info">{texts.accountNote}</Notice>
      )}
    </FormSection>
  );
}
