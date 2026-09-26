'use client';

import type { MyAccountResponse } from '@lucy-spa/contracts';
import { useState, type FormEvent } from 'react';
import { detailErrorMessage } from '../../../lib/workforce/employee-detail';
import { formatDate } from '../../../lib/workforce/format';
import {
  changeOwnPassword,
  changePasswordErrorMessage,
  changePasswordProblem,
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
  Field,
  Loading,
  Notice,
  PageHeader,
  Section,
  SubmitButton,
  useResource,
  useSubmit,
} from '../ui';
import { TITLE_TONE } from './employee-lifecycle';

/**
 * "Tài khoản của tôi / My Account" (follow-up Step 3). A self-service view over the same
 * authoritative profile that employee detail reads and writes; nothing here is a copy.
 * Recovery email reuses the existing section and endpoints (it also stays on the dashboard
 * for now: a temporary second entry point to the same single feature).
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
      <RecoveryEmailSection />
    </>
  );
}

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
  return (
    <>
      <Section title={texts.personal}>
        <dl className="wf-facts">
          <dt>{t.employees.fullName}</dt>
          <dd>
            <strong>{account.fullName}</strong>
          </dd>
          <dt>{t.employees.titleColumn}</dt>
          <dd>
            <Badge tone={TITLE_TONE[account.title] ?? 'neutral'}>
              {t.employees.titles[account.title]}
            </Badge>
          </dd>
          {employee ? (
            <>
              <dt>{t.employees.classification}</dt>
              <dd>
                {employee.classification
                  ? t.employees.classifications[employee.classification]
                  : texts.notStarted}
              </dd>
              <dt>{detail.loginId}</dt>
              <dd>
                <strong id="my-login-id">{employee.employeeId}</strong>
              </dd>
            </>
          ) : null}
          <dt>{detail.phone}</dt>
          <dd>{account.phone ?? '—'}</dd>
          {employee ? (
            <>
              <dt>{detail.dateOfBirth}</dt>
              <dd>{formatDate(employee.dateOfBirth, locale)}</dd>
              <dt>{detail.address}</dt>
              <dd>{employee.address}</dd>
            </>
          ) : null}
          <dt>{detail.locale}</dt>
          <dd>{detail.locales[account.locale]}</dd>
        </dl>
        <ProfileEditor key={account.version} account={account} reload={reload} />
      </Section>
      {employee ? (
        <Section title={texts.work}>
          <p className="wf-hint">{texts.workReadonly}</p>
          <h3>{texts.branches}</h3>
          {employee.branches.length === 0 ? <Empty>{texts.noBranches}</Empty> : null}
          <ul className="wf-plain-list">
            {employee.branches.map((branch) => (
              <li key={branch.id}>
                {branch.name} <span className="wf-muted wf-small">({branch.code})</span>
              </li>
            ))}
          </ul>
          <h3>{texts.skills}</h3>
          {employee.skills.length === 0 ? <Empty>{texts.noSkills}</Empty> : null}
          <ul className="wf-plain-list">
            {employee.skills.map((skill) => (
              <li key={skill.id}>{locale === 'vi' ? skill.nameVi : skill.nameEn}</li>
            ))}
          </ul>
        </Section>
      ) : null}
      <Section title={texts.security}>
        <dl className="wf-facts">
          <dt>{texts.email}</dt>
          <dd>
            {account.email ? (
              <>
                {account.email.address}{' '}
                <Badge tone={account.email.verified ? 'success' : 'warning'}>
                  {account.email.verified ? texts.emailVerified : texts.emailUnverified}
                </Badge>
              </>
            ) : (
              texts.noEmail
            )}
          </dd>
          <dt>{texts.status}</dt>
          <dd>{employee ? t.employees.statuses[account.status] : texts.ownerStatus}</dd>
        </dl>
        <p className="wf-hint">{texts.emailReadonly}</p>
        <ChangePasswordSection />
      </Section>
    </>
  );
}

function ProfileEditor({
  account,
  reload,
}: {
  account: MyAccountResponse;
  reload: () => Promise<void>;
}) {
  const { api, t } = useWorkforce();
  const texts = t.myAccount;
  const detail = t.employees.detail;
  const [form, setForm] = useState<MyProfileForm>(() => myProfileForm(account));
  const [unchanged, setUnchanged] = useState(false);
  const submit = useSubmit();
  const set = <K extends keyof MyProfileForm>(key: K, value: MyProfileForm[K]) => {
    setUnchanged(false);
    setForm((current) => ({ ...current, [key]: value }));
  };

  async function save(event: FormEvent) {
    event.preventDefault();
    const patch = myProfilePatch(account, form);
    if (patch === null) {
      setUnchanged(true);
      return;
    }
    const ok = await submit.run(
      () => runMutation(() => myAccountCommands.updateProfile(api, patch), reload),
      t.common.saved,
    );
    if (ok) await reload();
  }

  return (
    <details className="wf-disclosure">
      <summary>{texts.edit}</summary>
      <form className="wf-form wf-member-form" onSubmit={(event) => void save(event)}>
        <p className="wf-hint">{account.employee ? texts.editNote : texts.ownerEditNote}</p>
        <div className="wf-row">
          <Field id="my-name" label={t.employees.fullName} required>
            <input
              id="my-name"
              required
              maxLength={200}
              value={form.fullName}
              onChange={(event) => set('fullName', event.target.value)}
            />
          </Field>
          <Field id="my-phone" label={detail.phone} required={account.employee !== null}>
            <input
              id="my-phone"
              type="tel"
              maxLength={32}
              autoComplete="tel"
              required={account.employee !== null}
              value={form.phone}
              onChange={(event) => set('phone', event.target.value)}
            />
          </Field>
        </div>
        {account.employee ? (
          <div className="wf-row">
            <Field id="my-dob" label={detail.dateOfBirth} required>
              <input
                id="my-dob"
                type="date"
                required
                value={form.dateOfBirth}
                onChange={(event) => set('dateOfBirth', event.target.value)}
              />
            </Field>
            <Field id="my-address" label={detail.address} required>
              <input
                id="my-address"
                required
                maxLength={500}
                value={form.address}
                onChange={(event) => set('address', event.target.value)}
              />
            </Field>
          </div>
        ) : null}
        <Field id="my-locale" label={detail.locale} required>
          <select
            id="my-locale"
            value={form.locale}
            onChange={(event) => set('locale', event.target.value === 'en' ? 'en' : 'vi')}
          >
            <option value="vi">{detail.locales.vi}</option>
            <option value="en">{detail.locales.en}</option>
          </select>
        </Field>
        {unchanged ? <Notice tone="info">{detail.noChanges}</Notice> : null}
        {submit.error ? <Notice tone="error">{detailErrorMessage(submit.error, t)}</Notice> : null}
        {submit.success ? (
          <Notice tone="success">
            {submit.success} {texts.savedNote}
          </Notice>
        ) : null}
        <SubmitButton
          pending={submit.pending}
          label={t.common.save}
          pendingLabel={t.common.saving}
        />
      </form>
    </details>
  );
}

/**
 * "Đổi mật khẩu / Change password" (follow-up Step 4): for a signed-in user who knows the
 * current password (not forgot-password). Passwords live only in this form's state and are
 * cleared after success; this device stays signed in, every other session is signed out.
 */
export function ChangePasswordSection() {
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

  async function change(event: FormEvent) {
    event.preventDefault();
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
    }, texts.done);
    // Never keep passwords around: cleared after success, current one cleared after a refusal.
    if (ok) setForm(EMPTY_CHANGE_PASSWORD);
    else setForm((current) => ({ ...current, current: '' }));
  }

  return (
    <details className="wf-disclosure">
      <summary>{texts.title}</summary>
      <form
        className="wf-form wf-member-form"
        autoComplete="off"
        onSubmit={(event) => void change(event)}
      >
        <p className="wf-hint">{texts.intro}</p>
        <Field id="change-current" label={texts.current} required>
          <input
            id="change-current"
            type="password"
            required
            maxLength={1024}
            autoComplete="current-password"
            value={form.current}
            onChange={(event) => set('current', event.target.value)}
          />
        </Field>
        <div className="wf-row">
          <Field id="change-next" label={texts.next} required hint={texts.hint}>
            <input
              id="change-next"
              type="password"
              required
              minLength={15}
              maxLength={128}
              autoComplete="new-password"
              aria-describedby="change-next-hint"
              value={form.next}
              onChange={(event) => set('next', event.target.value)}
            />
          </Field>
          <Field id="change-confirm" label={texts.confirm} required>
            <input
              id="change-confirm"
              type="password"
              required
              autoComplete="new-password"
              value={form.confirm}
              onChange={(event) => set('confirm', event.target.value)}
            />
          </Field>
        </div>
        {shown && problem !== null ? <Notice tone="error">{texts[problem]}</Notice> : null}
        {submit.error ? (
          <Notice tone="error">{changePasswordErrorMessage(submit.error, t)}</Notice>
        ) : null}
        {submit.success ? <Notice tone="success">{submit.success}</Notice> : null}
        <SubmitButton pending={submit.pending} label={texts.submit} pendingLabel={texts.pending} />
      </form>
    </details>
  );
}
