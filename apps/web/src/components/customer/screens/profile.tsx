'use client';

import type { CustomerProfileResponse } from '@lucy-spa/contracts';
import {
  Button,
  Card,
  CardHeader,
  DescriptionList,
  Field,
  FormDialog,
  FormGrid,
  Notice,
  PasswordInput,
  TextInput,
  type FormOverlayLabels,
} from '@lucy-spa/ui';
import { useId, useState } from 'react';
import { fill } from '../../../i18n/customer';
import {
  customerProfileDictionary,
  type CustomerProfileDictionary,
} from '../../../i18n/customer-profile';
import { ApiError } from '../../../lib/api/client';
import { customerErrorMessage } from '../../../lib/customer/booking';
import {
  birthdayText,
  emailErrorMessage,
  emailProblem,
  loadCustomerProfile,
  nameErrorMessage,
  nameProblem,
  NAME_MAX,
  OTP_PATTERN,
  phoneText,
  requestEmailChange,
  resendEmailChange,
  saveCustomerName,
  verifyEmailChange,
} from '../../../lib/customer/profile';
import { announceSessionChange } from '../../../lib/site-session';
import { Badge } from '../../workforce/ui';
import { AccountScreen } from '../account-frame';
import { useCustomer } from '../session';
import { LoadState, useFetch } from './bookings';

type Overlay = 'name' | 'email' | null;

/** The strings `FormDialog` takes as props, from the page's own dictionaries. */
function overlayLabels(
  text: CustomerProfileDictionary,
  common: { cancel: string; close: string },
  submit: string,
  submitting: string,
): FormOverlayLabels {
  return {
    close: common.close,
    cancel: common.cancel,
    submit,
    submitting,
    discardTitle: text.discardTitle,
    discardBody: text.discardBody,
    discardConfirm: text.discardConfirm,
    discardKeep: text.discardKeep,
  };
}

/**
 * "Hồ sơ": the member's own details (session 7b). The name is edited in a dialog; the sign-in email changes through a code sent to
 * the new address (the account email stays as it is until the code is entered); the phone (the customer key) and the birthday (it
 * protects the birthday gift) are shown only, and the page says who changes them.
 */
export function CustomerProfileScreen() {
  const { api, locale, t } = useCustomer();
  const text = customerProfileDictionary(locale);
  const profile = useFetch(() => loadCustomerProfile(api), 'profile');
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [done, setDone] = useState<string | null>(null);
  if (!profile.data) {
    return (
      <AccountScreen title={t.home.hubProfile} description={t.home.profileIntro} narrow>
        <LoadState error={profile.error} retry={profile.retry} />
      </AccountScreen>
    );
  }
  const data = profile.data;
  return (
    <AccountScreen title={t.home.hubProfile} description={t.home.profileIntro} narrow>
      {done ? <Notice tone="success">{done}</Notice> : null}
      <ProfileView
        profile={data}
        text={text}
        onEditName={() => {
          setDone(null);
          setOverlay('name');
        }}
        onChangeEmail={() => {
          setDone(null);
          setOverlay('email');
        }}
      />
      {overlay === 'name' ? (
        <NameDialog
          profile={data}
          text={text}
          onClose={() => setOverlay(null)}
          onRefreshed={profile.set}
          onSaved={(next) => {
            profile.set(next);
            setOverlay(null);
            setDone(text.saved);
            // The header menu and the greeting read the name from the session.
            announceSessionChange();
          }}
        />
      ) : null}
      {overlay === 'email' ? (
        <EmailDialog
          profile={data}
          text={text}
          onClose={() => setOverlay(null)}
          onChanged={(next, address) => {
            profile.set(next);
            setOverlay(null);
            setDone(fill(text.emailChanged, { email: address }));
            announceSessionChange();
          }}
        />
      ) : null}
    </AccountScreen>
  );
}

/** The two cards and the note under them: pure, so every state can be drawn without a server. */
export function ProfileView({
  profile,
  text,
  onEditName,
  onChangeEmail,
}: {
  profile: CustomerProfileResponse;
  text: CustomerProfileDictionary;
  onEditName: () => void;
  onChangeEmail: () => void;
}) {
  const { t } = useCustomer();
  const heading = useId();
  const emailHeading = useId();
  return (
    <>
      <Card as="section" aria-labelledby={heading}>
        <CardHeader
          id={heading}
          title={text.personalTitle}
          actions={
            <Button variant="secondary" onClick={onEditName} aria-label={text.editTitle}>
              {text.edit}
            </Button>
          }
        />
        <DescriptionList
          items={[
            { label: t.home.name, value: profile.fullName },
            { label: text.phone, value: phoneText(profile.phone) },
            { label: text.birthday, value: birthdayText(profile.dateOfBirth) },
            {
              label: t.home.languagePref,
              value: profile.locale === 'vi' ? 'Tiếng Việt' : 'English',
            },
          ]}
        />
        <p className="ls-hint">{text.managedNote}</p>
      </Card>
      <Card as="section" aria-labelledby={emailHeading}>
        <CardHeader
          id={emailHeading}
          title={text.emailTitle}
          actions={
            <Button variant="secondary" onClick={onChangeEmail}>
              {text.changeEmail}
            </Button>
          }
        />
        <DescriptionList
          items={[
            {
              label: text.emailLabel,
              value: (
                <>
                  {profile.email.address}{' '}
                  <Badge tone={profile.email.verified ? 'success' : 'warning'}>
                    {profile.email.verified ? text.emailVerified : text.emailUnverified}
                  </Badge>
                </>
              ),
            },
          ]}
        />
      </Card>
    </>
  );
}

function NameDialog({
  profile,
  text,
  onClose,
  onSaved,
  onRefreshed,
}: {
  profile: CustomerProfileResponse;
  text: CustomerProfileDictionary;
  onClose: () => void;
  onSaved: (next: CustomerProfileResponse) => void;
  onRefreshed: (next: CustomerProfileResponse) => void;
}) {
  const { api, t } = useCustomer();
  const [name, setName] = useState(profile.fullName);
  const [shown, setShown] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const problem = nameProblem(name);

  async function save() {
    if (pending) return;
    if (problem !== null) {
      setShown(true);
      return;
    }
    setPending(true);
    setError(null);
    try {
      onSaved(await saveCustomerName(api, profile.version, name));
    } catch (failure) {
      setError(failure);
      // Changed elsewhere: take the new version, keep what was typed, and say so.
      if (failure instanceof ApiError && failure.code === 'CONFLICT') {
        try {
          onRefreshed(await loadCustomerProfile(api));
        } catch {
          /* the message above already says to check and save again */
        }
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <FormDialog
      title={text.editTitle}
      labels={overlayLabels(text, t.common, text.save, text.saving)}
      busy={pending}
      dirty={name !== profile.fullName}
      error={
        error ? (
          <Notice tone="danger">
            {nameErrorMessage(error, text) ?? customerErrorMessage(error, t)}
          </Notice>
        ) : undefined
      }
      onClose={onClose}
      onSubmit={save}
    >
      <FormGrid>
        <Field
          label={t.home.name}
          hint={text.nameHint}
          required
          requiredLabel={t.common.required}
          error={shown && problem !== null ? text[problem] : undefined}
        >
          {(control) => (
            <TextInput
              {...control}
              // The page names the problem beside the field (H12), not the browser's own bubble.
              required={false}
              aria-required="true"
              autoComplete="name"
              maxLength={NAME_MAX}
              value={name}
              onChange={(event) => {
                setShown(false);
                setName(event.target.value);
              }}
            />
          )}
        </Field>
      </FormGrid>
    </FormDialog>
  );
}

type EmailStep = { kind: 'form' } | { kind: 'code'; flowToken: string; email: string };

/**
 * Current password and the new address send a code to the NEW address only; the account email changes when that code is verified.
 * The password lives in this form's state and is cleared after every request.
 */
function EmailDialog({
  profile,
  text,
  onClose,
  onChanged,
}: {
  profile: CustomerProfileResponse;
  text: CustomerProfileDictionary;
  onClose: () => void;
  onChanged: (next: CustomerProfileResponse, address: string) => void;
}) {
  const { api, t } = useCustomer();
  const [step, setStep] = useState<EmailStep>({ kind: 'form' });
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [shown, setShown] = useState(false);
  const [emailLeft, setEmailLeft] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const problem = emailProblem(password, email, profile.email.address);
  const coding = step.kind === 'code';
  // The new address: after a failed submit, or once the person left the field with something typed (the password is not its business).
  const addressProblem = emailProblem('x', email, profile.email.address);
  const emailMessage =
    addressProblem !== null &&
    addressProblem !== 'passwordRequired' &&
    (shown || (emailLeft && email.trim() !== ''))
      ? text[addressProblem]
      : undefined;

  /** One request at a time; a failure stays in the dialog with everything typed kept. */
  async function guarded(work: () => Promise<void>) {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await work();
    } catch (failure) {
      setError(failure);
    } finally {
      setPending(false);
    }
  }

  const send = () => {
    if (problem !== null) {
      setShown(true);
      return Promise.resolve();
    }
    const target = email.trim();
    return guarded(async () => {
      const flow = await requestEmailChange(api, password, target);
      setPassword('');
      setStep({ kind: 'code', flowToken: flow.flowToken, email: target });
      setInfo(fill(text.codeSent, { email: target }));
      setCode('');
    });
  };

  const resend = () =>
    guarded(async () => {
      if (step.kind !== 'code') return;
      await resendEmailChange(api, step.flowToken);
      setInfo(fill(text.resent, { email: step.email }));
    });

  const verify = () => {
    if (step.kind !== 'code') return Promise.resolve();
    if (!OTP_PATTERN.test(code.trim())) {
      setShown(true);
      return Promise.resolve();
    }
    return guarded(async () => {
      await verifyEmailChange(api, step.flowToken, code);
      onChanged(await loadCustomerProfile(api), step.email);
    });
  };

  const fieldProblem = shown
    ? coding
      ? OTP_PATTERN.test(code.trim())
        ? undefined
        : text.codeRequired
      : problem === null
        ? undefined
        : text[problem]
    : undefined;

  return (
    <FormDialog
      title={text.changeEmailTitle}
      description={text.changeEmailIntro}
      labels={overlayLabels(
        text,
        t.common,
        coding ? text.verify : text.sendCode,
        coding ? text.verifying : text.sendingCode,
      )}
      busy={pending}
      dirty={password !== '' || email !== '' || code !== '' || coding}
      error={
        error ? (
          <Notice tone="danger">
            {emailErrorMessage(error, text) ?? customerErrorMessage(error, t)}
          </Notice>
        ) : undefined
      }
      onClose={onClose}
      onSubmit={coding ? verify : send}
    >
      <FormGrid>
        {info ? <Notice tone="info">{info}</Notice> : null}
        {!coding ? (
          <>
            <Field
              label={text.currentPassword}
              required
              requiredLabel={t.common.required}
              error={shown && problem === 'passwordRequired' ? text.passwordRequired : undefined}
            >
              {(control) => (
                <PasswordInput
                  {...control}
                  required={false}
                  aria-required="true"
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
            </Field>
            <Field
              label={text.newEmail}
              required
              requiredLabel={t.common.required}
              error={emailMessage}
            >
              {(control) => (
                <TextInput
                  {...control}
                  required={false}
                  aria-required="true"
                  type="email"
                  inputMode="email"
                  maxLength={254}
                  autoComplete="email"
                  spellCheck={false}
                  autoCapitalize="none"
                  value={email}
                  // H12: the address is checked when the field is left, not only on submit.
                  onBlur={() => setEmailLeft(true)}
                  onChange={(event) => {
                    setShown(false);
                    setEmail(event.target.value);
                  }}
                />
              )}
            </Field>
          </>
        ) : (
          <Field
            label={text.code}
            required
            requiredLabel={t.common.required}
            error={fieldProblem}
            labelAction={
              <Button variant="ghost" disabled={pending} onClick={() => void resend()}>
                {text.resend}
              </Button>
            }
          >
            {(control) => (
              <TextInput
                {...control}
                required={false}
                aria-required="true"
                inputMode="numeric"
                autoComplete="one-time-code"
                spellCheck={false}
                pattern="[0-9]{6}"
                maxLength={6}
                value={code}
                onChange={(event) => {
                  setShown(false);
                  setCode(event.target.value);
                }}
              />
            )}
          </Field>
        )}
      </FormGrid>
    </FormDialog>
  );
}
