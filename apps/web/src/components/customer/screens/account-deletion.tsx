'use client';

import type { AccountDeletionCheckResponse } from '@lucy-spa/contracts';
import { Button, buttonClass, Card, CardHeader, Field, Notice, PasswordInput } from '@lucy-spa/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useState, type FormEvent } from 'react';
import { fill } from '../../../i18n/customer';
import {
  customerProfileDictionary,
  type CustomerProfileDictionary,
} from '../../../i18n/customer-profile';
import type { Locale } from '../../../i18n/locales';
import {
  adviceTemplate,
  aroundCode,
  deleteAccount,
  deletionErrorMessage,
  loadDeletionCheck,
  orderHref,
  REFUND_POLICY_SLUG,
  sessionsLeft,
} from '../../../lib/customer/account-deletion';
import { customerErrorMessage, formatDateTime } from '../../../lib/customer/booking';
import { NAV_TRANSITION } from '../../../lib/nav-transition';
import { announceSessionChange } from '../../../lib/site-session';
import { AccountScreen } from '../account-frame';
import { useCustomer } from '../session';
import { LoadState, useFetch } from './bookings';

/**
 * Session 10 A2: "Xóa tài khoản". One page: what stops the deletion now (with what to do), what is deleted, what the shop keeps, what is
 * lost; then the current password and the destructive outline button. The destructive button is never the primary, never the default
 * (Enter in the password field does not delete) and never the first focus; Cancel comes first.
 */
export function CustomerAccountDeletionScreen() {
  const { api, locale } = useCustomer();
  const text = customerProfileDictionary(locale);
  const check = useFetch(() => loadDeletionCheck(api), 'account-deletion');
  // A blocker appeared between the check and the press: the page reads the check again and says why above it.
  const [changed, setChanged] = useState(false);
  return (
    <AccountScreen
      title={text.deletion.title}
      description={text.deletion.intro}
      backLabel={text.deletion.back}
      narrow
    >
      {changed ? <Notice tone="warning">{text.deletion.blockedNow}</Notice> : null}
      {check.data ? (
        <DeletionView
          check={check.data}
          text={text}
          locale={locale}
          onBlocked={() => {
            setChanged(true);
            check.retry();
          }}
        />
      ) : (
        <LoadState error={check.error} retry={check.retry} />
      )}
    </AccountScreen>
  );
}

/** The explanation and, when nothing blocks, the confirmation. Pure apart from the form, so every state draws without a server. */
export function DeletionView({
  check,
  text,
  locale,
  onBlocked,
}: {
  check: AccountDeletionCheckResponse;
  text: CustomerProfileDictionary;
  locale: Locale;
  onBlocked: () => void;
}) {
  return (
    <>
      {check.canDelete ? null : <Blockers check={check} text={text.deletion} locale={locale} />}
      <Consequences check={check} text={text.deletion} locale={locale} />
      {check.canDelete ? <ConfirmDeletion text={text} onBlocked={onBlocked} /> : null}
    </>
  );
}

function Blockers({
  check,
  text,
  locale,
}: {
  check: AccountDeletionCheckResponse;
  text: CustomerProfileDictionary['deletion'];
  locale: Locale;
}) {
  const { base } = useCustomer();
  const heading = useId();
  const { combos, orders, atSpa, openReturns } = check.blockers;
  return (
    <Card as="section" aria-labelledby={heading} className="ls-acct-del">
      <CardHeader id={heading} title={text.blockedTitle} description={text.blockedIntro} />
      {combos.length > 0 ? (
        <div className="ls-acct-del-block">
          <p>{fill(text.combos, { count: sessionsLeft(check) })}</p>
          <ul className="ls-acct-del-list">
            {combos.map((combo) => (
              <li key={combo.id}>
                {fill(text.comboItem, {
                  name: locale === 'vi' ? combo.nameVi : combo.nameEn,
                  count: combo.sessionsLeft,
                })}
              </li>
            ))}
          </ul>
          <p className="ls-acct-del-links">
            <Link href={`${base}/loyalty`} transitionTypes={NAV_TRANSITION}>
              {text.seeCombos}
            </Link>
            <Link href={`/${locale}/${REFUND_POLICY_SLUG}`} transitionTypes={NAV_TRANSITION}>
              {text.refundPolicy}
            </Link>
          </p>
        </div>
      ) : null}
      {orders.length > 0 ? (
        <div className="ls-acct-del-block">
          <p>{text.orders}</p>
          <ul className="ls-acct-del-list">
            {orders.map((order) => {
              const href = orderHref(order, base);
              return (
                <li key={order.id}>
                  <p>
                    <WithCode template={adviceTemplate(order, text)} code={order.code} />
                  </p>
                  {/* Its own line with the 44 px link sizing, never a small inline target. */}
                  {href ? (
                    <p className="ls-acct-del-links">
                      <Link href={href} transitionTypes={NAV_TRANSITION}>
                        <WithCode template={text.seeOrder} code={order.code} />
                      </Link>
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      {atSpa ? (
        <div className="ls-acct-del-block">
          <p>{text.atSpa}</p>
        </div>
      ) : null}
      {openReturns > 0 ? (
        <div className="ls-acct-del-block">
          <p>{fill(text.returns, { count: openReturns })}</p>
        </div>
      ) : null}
    </Card>
  );
}

/** A sentence with an order code in it; the code is an identifier, so page translation leaves it alone. */
function WithCode({ template, code }: { template: string; code: string }) {
  const [before, after] = aroundCode(template);
  // One inline box: inside a flex link each text run would be its own item and the space before the code would be dropped
  // ("Xem đơnON000026", E4 review).
  return (
    <span>
      {before}
      <span translate="no">{code}</span>
      {after}
    </span>
  );
}

/** Built once, not on every render. */
const POINTS: Record<Locale, Intl.NumberFormat> = {
  vi: new Intl.NumberFormat('vi-VN'),
  en: new Intl.NumberFormat('en-GB'),
};

function Consequences({
  check,
  text,
  locale,
}: {
  check: AccountDeletionCheckResponse;
  text: CustomerProfileDictionary['deletion'];
  locale: Locale;
}) {
  const removed = useId();
  const kept = useId();
  const lost = useId();
  const number = POINTS[locale];
  const { points, upcomingBookings } = check.losses;
  return (
    <Card className="ls-acct-del">
      <section className="ls-acct-del-block" aria-labelledby={removed}>
        <h2 id={removed} className="ls-card-title">
          {text.removedTitle}
        </h2>
        <ul className="ls-acct-del-list">
          {text.removed.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>
      <section className="ls-acct-del-block" aria-labelledby={kept}>
        <h2 id={kept} className="ls-card-title">
          {text.keptTitle}
        </h2>
        <ul className="ls-acct-del-list">
          {text.kept.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>
      <section className="ls-acct-del-block" aria-labelledby={lost}>
        <h2 id={lost} className="ls-card-title">
          {text.lostTitle}
        </h2>
        <ul className="ls-acct-del-list">
          <li>{text.lostAlways}</li>
          {points && points.spa + points.beauty > 0 ? (
            <li>
              {fill(text.lostPoints, {
                spa: number.format(points.spa),
                beauty: number.format(points.beauty),
              })}
            </li>
          ) : null}
        </ul>
        {upcomingBookings.length > 0 ? (
          <>
            <p>{text.lostBookings}</p>
            <ul className="ls-acct-del-list">
              {upcomingBookings.map((booking) => (
                <li key={booking.id}>
                  {formatDateTime(booking.startsAt, booking.branch.timezone, locale)}:{' '}
                  {booking.serviceNames
                    .map((name) => (locale === 'vi' ? name.vi : name.en))
                    .join(', ')}
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </section>
    </Card>
  );
}

/**
 * The password and the two footer actions. The form exists for password managers and labels only: submitting it (Enter) does nothing,
 * so the destructive action needs a deliberate press of its own button. The password lives in this state and is cleared on failure.
 */
function ConfirmDeletion({
  text,
  onBlocked,
}: {
  text: CustomerProfileDictionary;
  onBlocked: () => void;
}) {
  const { api, base, t } = useCustomer();
  const router = useRouter();
  const heading = useId();
  const passwordId = useId();
  const [password, setPassword] = useState('');
  const [shown, setShown] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const missing = password === '';

  async function confirm() {
    if (pending) return;
    if (missing) {
      setShown(true);
      // The message is beside the field; the focus goes there too.
      document.getElementById(passwordId)?.focus();
      return;
    }
    setPending(true);
    setError(null);
    try {
      await deleteAccount(api, password);
      router.replace(`${base}/deleted`);
      // The header and the member area learn the session ended (the CSRF context was dropped, so they read "signed out").
      announceSessionChange();
    } catch (failure) {
      setError(failure);
      setPassword('');
      setPending(false);
      if (Reflect.get(Object(failure), 'code') === 'ACCOUNT_DELETION_BLOCKED') onBlocked();
    }
  }

  const ignoreEnter = (event: FormEvent) => event.preventDefault();
  return (
    <Card as="section" aria-labelledby={heading} className="ls-acct-del">
      <CardHeader
        id={heading}
        title={text.deletion.confirmTitle}
        description={text.deletion.confirmIntro}
      />
      <form className="ls-acct-del-form" onSubmit={ignoreEnter} noValidate>
        {error ? (
          <Notice tone="danger">
            {deletionErrorMessage(error, text) ?? customerErrorMessage(error, t)}
          </Notice>
        ) : null}
        <Field
          id={passwordId}
          label={text.currentPassword}
          required
          requiredLabel={t.common.required}
          error={shown && missing ? text.passwordRequired : undefined}
        >
          {(control) => (
            <PasswordInput
              {...control}
              required={false}
              aria-required="true"
              showLabel={t.auth.showPassword}
              hideLabel={t.auth.hidePassword}
              maxLength={1024}
              name="current-password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => {
                setShown(false);
                setPassword(event.target.value);
              }}
            />
          )}
        </Field>
        <div className="ls-acct-del-footer">
          <Link
            href={`${base}/profile`}
            className={buttonClass('neutral')}
            transitionTypes={NAV_TRANSITION}
          >
            {t.common.cancel}
          </Link>
          <Button
            type="button"
            variant="danger-outline"
            icon="trash"
            loading={pending}
            onClick={() => void confirm()}
          >
            {pending ? text.deletion.deleting : text.deletion.confirm}
          </Button>
        </div>
      </form>
    </Card>
  );
}
