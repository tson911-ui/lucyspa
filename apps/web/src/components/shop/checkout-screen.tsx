'use client';

import type {
  CustomerAddressListResponse,
  CustomerAddressResponse,
  OnlineCartResponse,
  OnlineOrderResponse,
  OnlinePaymentResponse,
} from '@lucy-spa/contracts';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  CheckField,
  ConfirmDialog,
  DescriptionList,
  EmptyState,
  Field,
  Icon,
  Notice,
  Page,
  PageHeader,
  Stack,
  TextInput,
  buttonClass,
  focusFirstInvalid,
} from '@lucy-spa/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { getShopText } from '../../i18n/online-shop';
import { ApiError } from '../../lib/api/client';
import { customerErrorMessage } from '../../lib/customer/booking';
import { formatVnd } from '../../lib/customer/invoice';
import { fill } from '../../lib/fill';
import {
  EMPTY_ADDRESS,
  addressFieldOf,
  addressProblems,
  announceCartChange,
  checkoutRequest,
  draftFromProfile,
  draftFromSaved,
  needsCart,
  newRequestId,
  policyParagraphs,
  promiseNumbers,
  reloadsPolicy,
  shopErrorMessage,
  voucherOf,
  type AddressDraft,
  type AddressField,
  type QuoteResponse,
} from '../../lib/shop/online';
import { useCustomer } from '../customer/session';
import { LoadState, useFetch } from '../customer/screens/bookings';
import { CheckoutAddress } from './checkout-address';
import { lineName } from './cart-screen';
import { isOpen, useOnlineSales } from './shop-data';

type Phase = 'idle' | 'placing' | 'redirecting';

/**
 * "Thanh toán" (Phase 6 P6-19): the delivery address, an optional voucher, the quote of the order, the policy the customer must
 * accept, and one button that places the order and sends the customer to PayOS. One request id is kept for the whole attempt, and
 * the order, once placed, is kept too, so a double click, a retry or a failed payment link never places a second order; the cart
 * is emptied by the first successful placement. Every refusal is shown in words; the server decides all of it again.
 */
export function CheckoutScreen() {
  const { api, t, locale, base } = useCustomer();
  const s = getShopText(locale);
  const c = s.checkout;
  const router = useRouter();
  const { sales, reload: reloadSales } = useOnlineSales();
  const cartRead = useFetch(() => api.get<OnlineCartResponse>('/api/v1/me/cart'), 'checkout-cart');
  const addressRead = useFetch(
    () => api.get<CustomerAddressListResponse>('/api/v1/me/addresses'),
    'checkout-addresses',
  );
  const formRef = useRef<HTMLFormElement | null>(null);
  const requestId = useRef<string>(newRequestId());
  const placed = useRef<OnlineOrderResponse | null>(null);

  const [saved, setSaved] = useState<CustomerAddressResponse[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<AddressDraft>(EMPTY_ADDRESS);
  const [saveAddress, setSaveAddress] = useState(true);
  const [voucherInput, setVoucherInput] = useState('');
  const [voucher, setVoucher] = useState<string | null>(null);
  const [voucherNote, setVoucherNote] = useState<{
    tone: 'success' | 'info' | 'danger';
    text: string;
  } | null>(null);
  const [checking, setChecking] = useState(false);
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [quoteFailure, setQuoteFailure] = useState<{ message: string; cart: boolean } | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [policyError, setPolicyError] = useState<string | null>(null);
  const [problems, setProblems] = useState<Partial<Record<AddressField, true>>>({});
  const [phase, setPhase] = useState<Phase>('idle');
  const [failure, setFailure] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<CustomerAddressResponse | null>(null);

  // The saved addresses and the profile arrive once: the first saved address (or the profile) fills the form.
  useEffect(() => {
    const data = addressRead.data;
    if (!data || saved !== null) return;
    setSaved(data.addresses);
    const first = data.addresses[0];
    if (first) {
      setSelected(first.id);
      setDraft(draftFromSaved(first));
    } else {
      setDraft(draftFromProfile(data.profile));
    }
  }, [addressRead.data, saved]);

  // The quote is read when the page opens and when the voucher changes. It saves nothing.
  const readQuote = useCallback(
    async (code: string | null): Promise<boolean> => {
      setChecking(true);
      try {
        const next = await api.post<QuoteResponse>('/api/v1/me/checkout/quote', {
          ...(code ? { voucherCode: code } : {}),
        });
        setQuote(next);
        setQuoteFailure(null);
        setVoucherNote(
          code && next.voucherEffective === false
            ? { tone: 'info', text: c.voucherNotEffective }
            : code && next.voucherEffective
              ? {
                  tone: 'success',
                  text: fill(c.voucherApplied, { amount: formatVnd(next.discountVnd, locale) }),
                }
              : null,
        );
        return true;
      } catch (error) {
        if (error instanceof ApiError && error.code === 'VOUCHER_INVALID' && code) {
          // The code is refused: the order is priced without it, and the field says why.
          setVoucher(null);
          const ok = await readQuote(null);
          setVoucherNote({ tone: 'danger', text: s.errors.VOUCHER_INVALID });
          return ok;
        }
        setQuote(null);
        setQuoteFailure({
          message: shopErrorMessage(error, s.errors, (e) => customerErrorMessage(e, t)),
          cart:
            needsCart(error) || (error instanceof ApiError && error.code === 'ONLINE_UNPAID_LIMIT'),
        });
        return false;
      } finally {
        setChecking(false);
      }
    },
    [api, c, locale, s.errors, t],
  );
  useEffect(() => {
    void readQuote(null);
  }, [readQuote]);

  const cart = cartRead.data;
  if (sales === null || (!cart && !cartRead.error) || (!addressRead.data && !addressRead.error)) {
    return (
      <Page>
        <PageHeader title={c.title} description={c.intro} />
        <LoadState error={cartRead.error} retry={cartRead.retry} />
      </Page>
    );
  }
  if (!cart || sales === 'failed') {
    return (
      <Page>
        <PageHeader title={c.title} />
        <LoadState error={cartRead.error ?? new ApiError(0, 'NETWORK')} retry={cartRead.retry} />
      </Page>
    );
  }
  if (!isOpen(sales)) {
    return (
      <Page width="form">
        <PageHeader title={c.closedTitle} />
        <EmptyState
          icon="cart"
          action={
            <Link className={buttonClass('secondary')} href={`/${locale}/products`}>
              {s.cart.closedAction}
            </Link>
          }
        >
          {s.cart.closed}
        </EmptyState>
      </Page>
    );
  }
  if (cart.lines.length === 0 && placed.current === null && phase === 'idle') {
    return (
      <Page width="form">
        <PageHeader title={c.emptyTitle} />
        <EmptyState
          icon="cart"
          action={
            <Link className={buttonClass('primary')} href={`/${locale}/products`}>
              {s.cart.emptyAction}
            </Link>
          }
        >
          {c.emptyBody}
        </EmptyState>
      </Page>
    );
  }

  const busy = phase !== 'idle';
  const lines = quote?.lines ?? [];
  const byVariant = new Map(cart.lines.map((line) => [line.variantId, line]));
  const policy = policyParagraphs(sales, locale);

  function changeDraft(patch: Partial<AddressDraft>) {
    const next = { ...draft, ...patch };
    setDraft(next);
    const current = saved?.find((address) => address.id === selected);
    if (current) {
      const original = draftFromSaved(current);
      if (JSON.stringify(original) !== JSON.stringify(next)) setSelected(null);
    }
    setProblems((old) => {
      const left = { ...old };
      for (const key of Object.keys(patch) as AddressField[]) delete left[key];
      return left;
    });
  }

  function choose(id: string | null) {
    setSelected(id);
    const address = saved?.find((candidate) => candidate.id === id);
    if (address) setDraft(draftFromSaved(address));
    else
      setDraft({
        ...EMPTY_ADDRESS,
        ...(addressRead.data ? draftFromProfile(addressRead.data.profile) : {}),
      });
    setProblems({});
  }

  async function removeSaved(address: CustomerAddressResponse) {
    const next = await api.post<CustomerAddressListResponse>(
      `/api/v1/me/addresses/${address.id}/delete`,
      {},
    );
    setSaved(next.addresses);
    setDeleting(null);
    const first = next.addresses[0];
    if (first) {
      setSelected(first.id);
      setDraft(draftFromSaved(first));
    } else {
      setSelected(null);
      setDraft(draftFromProfile(next.profile));
    }
  }

  async function applyVoucher() {
    const code = voucherOf(voucherInput);
    setVoucher(code);
    setFailure(null);
    setVoucherNote(null);
    await readQuote(code);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !sales || sales === 'failed') return;
    const found = addressProblems(draft);
    setProblems(found);
    const needsPolicy = !accepted;
    setPolicyError(needsPolicy ? c.policyRequired : null);
    if (Object.keys(found).length > 0 || needsPolicy) {
      requestAnimationFrame(() => {
        if (formRef.current) focusFirstInvalid(formRef.current);
      });
      return;
    }
    setPhase('placing');
    setFailure(null);
    let order = placed.current;
    try {
      if (!order) {
        order = await api.post<OnlineOrderResponse>(
          '/api/v1/me/online-orders',
          checkoutRequest({
            draft,
            saveAddress: selected === null && saveAddress,
            voucher: voucher ?? '',
            policyVersion: sales.policyVersion,
            clientRequestId: requestId.current,
          }),
        );
        placed.current = order;
        announceCartChange();
      }
    } catch (error) {
      setPhase('idle');
      const field = addressFieldOf(error);
      if (field) setProblems({ [field]: true });
      if (reloadsPolicy(error)) {
        setAccepted(false);
        setPolicyError(c.policyChanged);
        await reloadSales();
      }
      if (needsCart(error)) {
        void readQuote(voucher);
        void cartRead.retry();
      }
      setFailure(
        field
          ? t.errors.validation
          : shopErrorMessage(error, s.errors, (e) => customerErrorMessage(e, t)),
      );
      return;
    }
    // The order exists. A payment link that cannot be made leaves the order unpaid and open on its own page.
    try {
      const payment = await api.post<OnlinePaymentResponse>(
        `/api/v1/me/online-orders/${order.id}/pay`,
        { locale },
      );
      if (payment.checkoutUrl) {
        setPhase('redirecting');
        window.location.assign(payment.checkoutUrl);
        return;
      }
    } catch {
      /* the order page explains it and offers the payment button */
    }
    router.replace(`${base}/orders/${order.id}?payFailed=1`);
  }

  const subtotal = quote
    ? formatVnd(quote.subtotalVnd, locale)
    : formatVnd(cart.subtotalVnd, locale);
  const discount = quote && BigInt(quote.discountVnd) > 0n ? quote.discountVnd : null;
  return (
    <Page>
      <PageHeader title={c.title} description={c.intro} />
      {failure ? <Notice tone="danger">{failure}</Notice> : null}
      {quoteFailure ? (
        <Notice tone="warning">
          <span className="ls-shop-added">
            {quoteFailure.message}
            {quoteFailure.cart ? (
              <Link className={buttonClass('ghost', 'md')} href={`/${locale}/cart`}>
                {c.backToCart}
              </Link>
            ) : null}
          </span>
        </Notice>
      ) : null}
      <form ref={formRef} noValidate onSubmit={(event) => void submit(event)} aria-label={c.title}>
        <div className="ls-shop-layout">
          <Stack gap="block">
            <CheckoutAddress
              locale={locale}
              s={c}
              draft={draft}
              onDraft={changeDraft}
              saved={saved ?? []}
              selected={selected}
              onSelect={choose}
              onDelete={setDeleting}
              saveAddress={saveAddress}
              onSaveAddress={setSaveAddress}
              problems={problems}
              disabled={busy}
              requiredLabel={t.common.required}
            />
            <Card as="section" aria-label={c.policy}>
              <CardHeader title={c.policy} />
              <Stack gap="block">
                <div className="ls-shop-policy" tabIndex={0} role="region" aria-label={c.policy}>
                  {policy.map((paragraph, index) => (
                    <p key={index}>{paragraph}</p>
                  ))}
                </div>
                <CheckField
                  label={c.policyAccept}
                  checked={accepted}
                  invalid={policyError !== null}
                  disabled={busy}
                  onChange={(event) => {
                    setAccepted(event.target.checked);
                    if (event.target.checked) setPolicyError(null);
                  }}
                />
                {policyError ? (
                  <p className="ls-error" role="alert">
                    <Icon name="x-circle" size={16} />
                    <span>{policyError}</span>
                  </p>
                ) : null}
              </Stack>
            </Card>
          </Stack>
          <Card as="section" aria-label={c.summary} className="ls-shop-summary">
            <CardHeader title={c.summary} />
            <Stack gap="block">
              <ul className="ls-shop-mini">
                {lines.map((line) => {
                  const source = byVariant.get(line.variantId);
                  return (
                    <li key={line.variantId}>
                      <span className="ls-shop-mini-name">
                        {source ? lineName(source, locale) : line.variantId}
                        <span className="ls-hint">
                          {fill(c.quantityTimes, { quantity: line.quantity })}
                          {line.mode === 'PRE_ORDER' ? (
                            <>
                              {' · '}
                              <Badge tone="info">{c.preOrder}</Badge>
                            </>
                          ) : null}
                        </span>
                      </span>
                      <span className="ls-shop-mini-total">
                        {formatVnd(line.lineTotalVnd, locale)}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <div className="ls-shop-voucher">
                <Field label={c.voucherLabel} className="ls-shop-voucher-field">
                  {(control) => (
                    <TextInput
                      {...control}
                      autoComplete="off"
                      autoCapitalize="characters"
                      maxLength={80}
                      value={voucherInput}
                      disabled={busy}
                      onChange={(event) => setVoucherInput(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          void applyVoucher();
                        }
                      }}
                    />
                  )}
                </Field>
                <Button
                  variant="secondary"
                  loading={checking}
                  disabled={busy}
                  onClick={() => void applyVoucher()}
                >
                  {checking ? c.voucherApplying : c.voucherApply}
                </Button>
              </div>
              {voucherNote ? <Notice tone={voucherNote.tone}>{voucherNote.text}</Notice> : null}
              <DescriptionList
                layout="totals"
                items={[
                  { label: c.subtotal, value: subtotal },
                  ...(discount
                    ? [{ label: c.discount, value: `−${formatVnd(discount, locale)}` }]
                    : []),
                  {
                    label: c.shipping,
                    value:
                      quote && BigInt(quote.shippingFeeVnd) > 0n
                        ? formatVnd(quote.shippingFeeVnd, locale)
                        : c.free,
                  },
                  {
                    label: c.total,
                    value: quote ? formatVnd(quote.totalVnd, locale) : '—',
                    strong: true,
                  },
                ]}
              />
              <p className="ls-hint">
                {fill(getShopText(locale).purchase.promise, promiseNumbers(sales))}
              </p>
              {quote?.hasPreOrder ? <Notice tone="info">{c.preOrderNote}</Notice> : null}
              <Button
                type="submit"
                variant="primary"
                size="lg"
                fullWidth
                loading={busy}
                disabled={quote === null || checking}
              >
                {phase === 'redirecting'
                  ? c.redirecting
                  : phase === 'placing'
                    ? c.placing
                    : c.place}
              </Button>
              <p className="ls-hint">{fill(c.payNote, { minutes: sales.unpaidTimeoutMinutes })}</p>
            </Stack>
          </Card>
        </div>
      </form>
      {deleting ? (
        <ConfirmDialog
          title={c.savedDeleteTitle}
          description={c.savedDeleteBody}
          tone="danger"
          confirmLabel={c.savedDeleteConfirm}
          busyLabel={c.savedDeleting}
          cancelLabel={t.common.cancel}
          referenceLabel={t.errors.reference}
          describeError={(error) => ({
            message: customerErrorMessage(error, t),
            reference: error instanceof ApiError ? error.requestId : null,
          })}
          onConfirm={() => removeSaved(deleting)}
          onCancel={() => setDeleting(null)}
        />
      ) : null}
    </Page>
  );
}
