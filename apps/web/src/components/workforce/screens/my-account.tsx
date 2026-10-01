'use client';

import type {
  BranchSummary,
  CollaboratorWorkOccurrence,
  MyAccountResponse,
} from '@lucy-spa/contracts';
import {
  Button,
  DataTable,
  DateInput,
  DescriptionList,
  Field as KitField,
  FormDialog,
  FormGrid,
  ListSection,
  PasswordInput,
  Select,
  TextInput,
  type DataTableColumn,
  type DescriptionItem,
} from '@lucy-spa/ui';
import { useState } from 'react';
import { detailErrorMessage } from '../../../lib/workforce/employee-detail';
import { formatDate } from '../../../lib/workforce/format';
import { fill } from '../../../i18n/workforce';
import {
  collaboratorWorkCommands,
  payLabel,
  scheduleRange,
} from '../../../lib/workforce/collaborator-work';
import { businessToday, PASSWORD_LENGTH } from '../../../lib/workforce/employee-create';
import { formOverlayLabels } from '../../../lib/workforce/form-labels';
import { useClientPaging } from '../../../lib/workforce/use-client-paging';
import { useBranches } from '../data';
import { OTP_PATTERN } from '../../../lib/workforce/recovery';
import {
  changeOwnPassword,
  changePasswordErrorMessage,
  changePasswordProblem,
  emailChangeErrorMessage,
  emailChangeProblem,
  requestEmailChange,
  resendEmailChange,
  verifyEmailChange,
  EMPTY_CHANGE_PASSWORD,
  myAccountCommands,
  myProfileForm,
  myProfilePatch,
  type ChangePasswordForm,
  type MyProfileForm,
} from '../../../lib/workforce/my-account';
import { runMutation } from '../../../lib/workforce/workflows';
import { RecoveryEmailSection } from '../recovery-email';
import { useWorkforce } from '../session';
import {
  Badge,
  Empty,
  ErrorState,
  Loading,
  Notice,
  PageHeader,
  Section,
  useResource,
  useSubmit,
} from '../ui';
import { TITLE_TONE } from './employee-lifecycle';

/**
 * "Tài khoản của tôi / My Account" (follow-up Step 3). A self-service view over the same
 * authoritative profile that employee detail reads and writes; nothing here is a copy.
 * Account & Security holds the one email area (current email, verified change). The existing
 * recovery-email proof appears only while the stored email is unverified; the dashboard keeps
 * its own entry for now (a temporary second entry point to the same single feature).
 */
export function MyAccountScreen() {
  const { api, t } = useWorkforce();
  const account = useResource(() => myAccountCommands.get(api), [api]);
  return (
    <>
      <PageHeader title={t.myAccount.title} intro={t.myAccount.intro} />
      {account.loading && !account.data ? <Loading t={t} /> : null}
      {account.error ? (
        <ErrorState error={account.error} t={t} onRetry={() => void account.reload()} />
      ) : null}
      {account.data ? <MyAccountView account={account.data} reload={account.reload} /> : null}
      {/* One email area: the existing recovery-email proof only while the email is unproven. */}
      {account.data?.email && !account.data.email.verified ? <RecoveryEmailSection /> : null}
    </>
  );
}

type Overlay = 'profile' | 'email' | 'password';

/** The loaded account (separated so it renders without a network in tests). */
export function MyAccountView({
  account,
  reload,
}: {
  account: MyAccountResponse;
  reload: () => Promise<void>;
}) {
  const { t, locale } = useWorkforce();
  const texts = t.myAccount;
  const detail = t.employees.detail;
  const employee = account.employee;
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const finish = (message: string) => {
    setOverlay(null);
    setDone(message);
  };

  const personal: DescriptionItem[] = [
    { label: t.employees.fullName, value: <strong>{account.fullName}</strong> },
    {
      label: t.employees.titleColumn,
      value: (
        <Badge tone={TITLE_TONE[account.title] ?? 'neutral'}>
          {t.employees.titles[account.title]}
        </Badge>
      ),
    },
    ...(employee
      ? [
          {
            label: t.employees.classification,
            value: employee.classification
              ? t.employees.classifications[employee.classification]
              : texts.notStarted,
          },
          { label: detail.loginId, value: <strong id="my-login-id">{employee.employeeId}</strong> },
        ]
      : []),
    { label: detail.phone, value: account.phone },
    ...(employee
      ? [
          { label: detail.dateOfBirth, value: formatDate(employee.dateOfBirth, locale) },
          { label: detail.address, value: employee.address },
        ]
      : []),
    { label: detail.locale, value: detail.locales[account.locale] },
  ];

  return (
    <>
      {done ? <Notice tone="success">{done}</Notice> : null}
      <Section
        title={texts.personal}
        actions={
          <Button variant="secondary" icon="edit" onClick={() => setOverlay('profile')}>
            {t.common.edit}
          </Button>
        }
      >
        <DescriptionList items={personal} columns={2} />
      </Section>
      {employee ? (
        <Section title={texts.work}>
          <p className="ls-hint">{texts.workReadonly}</p>
          <DescriptionList
            items={[
              {
                label: texts.branches,
                value:
                  employee.branches.length === 0 ? (
                    <span className="ls-hint">{texts.noBranches}</span>
                  ) : (
                    <ul className="ls-list-plain">
                      {employee.branches.map((branch) => (
                        <li key={branch.id}>
                          {branch.name} <span className="ls-hint">({branch.code})</span>
                        </li>
                      ))}
                    </ul>
                  ),
              },
              {
                label: texts.skills,
                value:
                  employee.skills.length === 0 ? (
                    <span className="ls-hint">{texts.noSkills}</span>
                  ) : (
                    <ul className="ls-list-plain">
                      {employee.skills.map((skill) => (
                        <li key={skill.id}>{locale === 'vi' ? skill.nameVi : skill.nameEn}</li>
                      ))}
                    </ul>
                  ),
              },
            ]}
          />
        </Section>
      ) : null}
      {account.title === 'COLLABORATOR' || employee?.classification === 'COLLABORATOR' ? (
        <MySchedule account={account} />
      ) : null}
      <Section
        title={texts.security}
        actions={
          <>
            <Button variant="secondary" onClick={() => setOverlay('email')}>
              {texts.changeEmail.title}
            </Button>
            <Button variant="secondary" onClick={() => setOverlay('password')}>
              {texts.changePassword.title}
            </Button>
          </>
        }
      >
        <DescriptionList
          items={[
            {
              label: texts.email,
              value: account.email ? (
                <>
                  {account.email.address}{' '}
                  <Badge tone={account.email.verified ? 'success' : 'warning'}>
                    {account.email.verified ? texts.emailVerified : texts.emailUnverified}
                  </Badge>
                </>
              ) : (
                texts.noEmail
              ),
            },
            {
              label: texts.status,
              value: employee ? t.employees.statuses[account.status] : texts.ownerStatus,
            },
          ]}
        />
      </Section>
      {overlay === 'profile' ? (
        <ProfileDialog
          account={account}
          reload={reload}
          onClose={() => setOverlay(null)}
          onDone={finish}
        />
      ) : null}
      {overlay === 'email' ? (
        <ChangeEmailDialog
          account={account}
          reload={reload}
          onClose={() => setOverlay(null)}
          onDone={finish}
        />
      ) : null}
      {overlay === 'password' ? (
        <ChangePasswordDialog onClose={() => setOverlay(null)} onDone={finish} />
      ) : null}
    </>
  );
}

/** Edit the self-editable fields (name, phone, language; employees also date of birth and address). */
export function ProfileDialog({
  account,
  reload,
  onClose,
  onDone,
}: {
  account: MyAccountResponse;
  reload: () => Promise<void>;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const { api, t } = useWorkforce();
  const texts = t.myAccount;
  const detail = t.employees.detail;
  const [initial] = useState(() => myProfileForm(account));
  const [form, setForm] = useState<MyProfileForm>(initial);
  const [unchanged, setUnchanged] = useState(false);
  const submit = useSubmit();
  const set = <K extends keyof MyProfileForm>(key: K, value: MyProfileForm[K]) => {
    setUnchanged(false);
    setForm((current) => ({ ...current, [key]: value }));
  };

  async function save() {
    const patch = myProfilePatch(account, form);
    if (patch === null) {
      setUnchanged(true);
      return;
    }
    const ok = await submit.run(
      () => runMutation(() => myAccountCommands.updateProfile(api, patch), reload),
      '',
    );
    if (ok) {
      await reload();
      onDone(`${t.common.saved} ${texts.savedNote}`);
    }
  }

  return (
    <FormDialog
      title={texts.edit}
      description={account.employee ? texts.editNote : texts.ownerEditNote}
      size="lg"
      labels={formOverlayLabels(t, t.common.save)}
      busy={submit.pending}
      dirty={(Object.keys(form) as (keyof MyProfileForm)[]).some(
        (key) => form[key] !== initial[key],
      )}
      error={
        unchanged ? (
          <Notice tone="info">{detail.noChanges}</Notice>
        ) : submit.error ? (
          <Notice tone="error">{detailErrorMessage(submit.error, t)}</Notice>
        ) : undefined
      }
      onClose={onClose}
      onSubmit={save}
    >
      <FormGrid cols={2}>
        <KitField
          id="my-name"
          label={t.employees.fullName}
          required
          requiredLabel={t.common.required}
        >
          {(control) => (
            <TextInput
              {...control}
              maxLength={200}
              value={form.fullName}
              onChange={(event) => set('fullName', event.target.value)}
            />
          )}
        </KitField>
        <KitField
          id="my-phone"
          label={detail.phone}
          {...(account.employee ? { required: true, requiredLabel: t.common.required } : {})}
        >
          {(control) => (
            <TextInput
              {...control}
              type="tel"
              maxLength={32}
              autoComplete="tel"
              value={form.phone}
              onChange={(event) => set('phone', event.target.value)}
            />
          )}
        </KitField>
        {account.employee ? (
          <>
            <KitField
              id="my-dob"
              label={detail.dateOfBirth}
              required
              requiredLabel={t.common.required}
            >
              {(control) => (
                <DateInput
                  {...control}
                  value={form.dateOfBirth}
                  onChange={(event) => set('dateOfBirth', event.target.value)}
                />
              )}
            </KitField>
            <KitField
              id="my-address"
              label={detail.address}
              required
              requiredLabel={t.common.required}
            >
              {(control) => (
                <TextInput
                  {...control}
                  maxLength={500}
                  value={form.address}
                  onChange={(event) => set('address', event.target.value)}
                />
              )}
            </KitField>
          </>
        ) : null}
        <KitField id="my-locale" label={detail.locale} required requiredLabel={t.common.required}>
          {(control) => (
            <Select
              {...control}
              value={form.locale}
              options={[
                { value: 'vi', label: detail.locales.vi },
                { value: 'en', label: detail.locales.en },
              ]}
              onChange={(event) => set('locale', event.target.value === 'en' ? 'en' : 'vi')}
            />
          )}
        </KitField>
      </FormGrid>
    </FormDialog>
  );
}

/**
 * "Đổi mật khẩu / Change password" (follow-up Step 4): for a signed-in user who knows the
 * current password (not forgot-password). Passwords live only in this form's state and are
 * cleared after success; this device stays signed in, every other session is signed out.
 */
export function ChangePasswordDialog({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const { api, t } = useWorkforce();
  const texts = t.myAccount.changePassword;
  const [form, setForm] = useState<ChangePasswordForm>(EMPTY_CHANGE_PASSWORD);
  const [shown, setShown] = useState(false);
  const submit = useSubmit();
  const problem = changePasswordProblem(form);
  const set = (key: keyof ChangePasswordForm, value: string) => {
    setShown(false);
    setForm((current) => ({ ...current, [key]: value }));
  };

  async function change() {
    if (problem !== null) {
      setShown(true);
      return;
    }
    const ok = await submit.run(async () => {
      try {
        await changeOwnPassword(api, form);
        return { ok: true };
      } catch (error) {
        return { ok: false, error };
      }
    }, '');
    // Never keep passwords around: cleared after success, current one cleared after a refusal.
    if (ok) {
      setForm(EMPTY_CHANGE_PASSWORD);
      onDone(texts.done);
    } else setForm((current) => ({ ...current, current: '' }));
  }

  return (
    <FormDialog
      title={texts.title}
      description={texts.intro}
      labels={{ ...formOverlayLabels(t, texts.submit), submitting: texts.pending }}
      busy={submit.pending}
      dirty={form.current !== '' || form.next !== '' || form.confirm !== ''}
      error={
        shown && problem !== null ? (
          <Notice tone="error">{texts[problem]}</Notice>
        ) : submit.error ? (
          <Notice tone="error">{changePasswordErrorMessage(submit.error, t)}</Notice>
        ) : undefined
      }
      onClose={onClose}
      onSubmit={change}
    >
      <FormGrid>
        <KitField
          id="change-current"
          label={texts.current}
          required
          requiredLabel={t.common.required}
        >
          {(control) => (
            <PasswordInput
              {...control}
              showLabel={t.auth.showPassword}
              hideLabel={t.auth.hidePassword}
              maxLength={1024}
              autoComplete="current-password"
              value={form.current}
              onChange={(event) => set('current', event.target.value)}
            />
          )}
        </KitField>
        <KitField
          id="change-next"
          label={texts.next}
          required
          requiredLabel={t.common.required}
          hint={texts.hint}
        >
          {(control) => (
            <PasswordInput
              {...control}
              showLabel={t.auth.showPassword}
              hideLabel={t.auth.hidePassword}
              minLength={PASSWORD_LENGTH.min}
              maxLength={PASSWORD_LENGTH.max}
              autoComplete="new-password"
              value={form.next}
              onChange={(event) => set('next', event.target.value)}
            />
          )}
        </KitField>
        <KitField
          id="change-confirm"
          label={texts.confirm}
          required
          requiredLabel={t.common.required}
        >
          {(control) => (
            <PasswordInput
              {...control}
              showLabel={t.auth.showPassword}
              hideLabel={t.auth.hidePassword}
              autoComplete="new-password"
              value={form.confirm}
              onChange={(event) => set('confirm', event.target.value)}
            />
          )}
        </KitField>
      </FormGrid>
    </FormDialog>
  );
}

type EmailStep = { kind: 'form' } | { kind: 'code'; flowToken: string; email: string };

/**
 * "Đổi email / Change email" (follow-up Step 5). Current password + new address sends a code
 * to the NEW address; the account email changes only when that code is verified. The
 * password lives only in this form's state and is cleared after every request.
 */
export function ChangeEmailDialog({
  account,
  reload,
  onClose,
  onDone,
}: {
  account: MyAccountResponse;
  reload: () => Promise<void>;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const { api, t } = useWorkforce();
  const texts = t.myAccount.changeEmail;
  const [step, setStep] = useState<EmailStep>({ kind: 'form' });
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [shown, setShown] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const submit = useSubmit();
  const problem = emailChangeProblem(password, email, account.email?.address ?? null);

  async function send() {
    if (problem !== null) {
      setShown(true);
      return;
    }
    const target = email.trim();
    const result: { flowToken?: string } = {};
    await submit.run(async () => {
      try {
        result.flowToken = (await requestEmailChange(api, password, target)).flowToken;
        return { ok: true };
      } catch (error) {
        return { ok: false, error };
      }
    }, '');
    setPassword('');
    if (result.flowToken) {
      setStep({ kind: 'code', flowToken: result.flowToken, email: target });
      setInfo(fill(texts.codeSent, { email: target }));
      setCode('');
    }
  }

  async function resend() {
    if (step.kind !== 'code') return;
    const ok = await submit.run(async () => {
      try {
        await resendEmailChange(api, step.flowToken);
        return { ok: true };
      } catch (error) {
        return { ok: false, error };
      }
    }, '');
    if (ok) setInfo(fill(texts.resent, { email: step.email }));
  }

  async function verify() {
    if (step.kind !== 'code' || !OTP_PATTERN.test(code.trim())) return;
    const ok = await submit.run(async () => {
      try {
        await verifyEmailChange(api, step.flowToken, code);
        return { ok: true };
      } catch (error) {
        return { ok: false, error };
      }
    }, '');
    if (ok) {
      await reload();
      onDone(fill(texts.done, { email: step.email }));
    }
  }

  const coding = step.kind === 'code';
  return (
    <FormDialog
      title={texts.title}
      description={texts.intro}
      labels={{
        ...formOverlayLabels(t, coding ? texts.verify : texts.send),
        submitting: coding ? texts.verifying : texts.sending,
      }}
      busy={submit.pending}
      dirty={password !== '' || email !== '' || code !== '' || coding}
      error={
        submit.error ? (
          <Notice tone="error">{emailChangeErrorMessage(submit.error, t)}</Notice>
        ) : shown && problem !== null ? (
          <Notice tone="error">{texts[problem]}</Notice>
        ) : undefined
      }
      onClose={onClose}
      onSubmit={coding ? verify : send}
    >
      <FormGrid>
        {info ? <Notice tone="info">{info}</Notice> : null}
        {!coding ? (
          <>
            <KitField
              id="email-current-password"
              label={texts.current}
              required
              requiredLabel={t.common.required}
            >
              {(control) => (
                <PasswordInput
                  {...control}
                  showLabel={t.auth.showPassword}
                  hideLabel={t.auth.hidePassword}
                  maxLength={1024}
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => {
                    setShown(false);
                    setPassword(event.target.value);
                  }}
                />
              )}
            </KitField>
            <KitField
              id="email-new"
              label={texts.newEmail}
              required
              requiredLabel={t.common.required}
            >
              {(control) => (
                <TextInput
                  {...control}
                  type="email"
                  maxLength={254}
                  autoComplete="email"
                  value={email}
                  onChange={(event) => {
                    setShown(false);
                    setEmail(event.target.value);
                  }}
                />
              )}
            </KitField>
          </>
        ) : (
          <KitField
            id="email-code"
            label={texts.code}
            required
            requiredLabel={t.common.required}
            labelAction={
              <Button variant="ghost" disabled={submit.pending} onClick={() => void resend()}>
                {texts.resend}
              </Button>
            }
          >
            {(control) => (
              <TextInput
                {...control}
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
            )}
          </KitField>
        )}
      </FormGrid>
    </FormDialog>
  );
}

/**
 * "Lịch làm việc / Work schedule" for a signed-in collaborator (follow-up Step 6): their own
 * occurrences and own agreed pay, read-only. Not payroll and not an income total.
 */
function MySchedule({ account }: { account: MyAccountResponse }) {
  const { api } = useWorkforce();
  const branches = useBranches(api);
  const today = businessToday(
    account.employee?.branches.map((branch) => branch.id) ?? [],
    branches.data ?? null,
  );
  const range = scheduleRange(today);
  const mine = useResource(
    () => collaboratorWorkCommands.mine(api, range.from, range.to),
    [api, range.from, range.to],
  );
  return <MyScheduleView items={mine.data?.items ?? null} branches={branches.data} />;
}

export function MyScheduleView({
  items,
  branches,
}: {
  items: CollaboratorWorkOccurrence[] | null;
  branches: ReadonlyMap<string, BranchSummary> | null;
}) {
  const { t, locale } = useWorkforce();
  const texts = t.myAccount.schedule;
  const work = t.collaboratorWork;
  const paging = useClientPaging(t, texts.title);
  const columns: DataTableColumn<CollaboratorWorkOccurrence>[] = [
    {
      key: 'date',
      header: work.workDate,
      mobileTitle: true,
      cell: (row) => formatDate(row.workDate, locale),
    },
    {
      key: 'branch',
      header: work.branch,
      truncate: true,
      cell: (row) => branches?.get(row.branchId)?.name ?? '—',
    },
    { key: 'mode', header: work.mode, cell: (row) => work.modes[row.mode] },
    {
      key: 'time',
      header: work.time,
      numeric: true,
      cell: (row) => `${row.startTime}–${row.endTime}`,
    },
    { key: 'pay', header: work.pay, numeric: true, cell: (row) => payLabel(row, t, locale) },
    { key: 'status', header: work.status, cell: (row) => work.statuses[row.status] },
  ];
  return (
    <ListSection title={texts.title}>
      <p className="ls-hint">{texts.intro}</p>
      {items === null ? <Loading t={t} /> : null}
      {items !== null && items.length === 0 ? <Empty>{texts.empty}</Empty> : null}
      {items !== null && items.length > 0 ? (
        <DataTable
          mode="client"
          caption={fill(t.common.list.table, { list: texts.title })}
          columns={columns}
          rows={items}
          rowKey={(row) => row.id}
          paging={paging}
        />
      ) : null}
    </ListSection>
  );
}
