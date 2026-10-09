'use client';

import type { OnlineOrderResponse } from '@lucy-spa/contracts';
import {
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  DescriptionList,
  Notice,
  Reveal,
  Stack,
  type DescriptionItem,
} from '@lucy-spa/ui';
import { useState } from 'react';
import type { Locale } from '../../i18n/locales';
import { onlineFulfilmentDictionary } from '../../i18n/online-fulfilment';
import { getShopText } from '../../i18n/online-shop';
import { ApiError } from '../../lib/api/client';
import { customerErrorMessage, formatDateTime } from '../../lib/customer/booking';
import { formatVnd } from '../../lib/customer/invoice';
import { fill } from '../../lib/fill';
import { fulfilmentView } from '../../lib/shop/fulfilment';
import { shopErrorMessage } from '../../lib/shop/online';
import { useCustomer } from '../customer/session';

/** The shop works in Vietnam: every date of an order is read in this zone. */
const SHOP_ZONE = 'Asia/Ho_Chi_Minh';

/**
 * The shipment of the order page (Phase 6 P6-20): the carrier, the tracking code and link, the dates, "Tôi đã nhận hàng", the plain
 * words for a delivery that failed, an order cancelled after payment and a refund, and the return windows with the Owner's approved
 * sentences. Returns are handled by the shop; the page invents no rule. The cost the shop paid the carrier is never part of the order
 * the customer reads. Nothing is drawn while there is nothing to say.
 */
export function OrderFulfilment({
  order,
  locale,
  onUpdated,
}: {
  order: OnlineOrderResponse;
  locale: Locale;
  /** The order the API answers with after "Tôi đã nhận hàng". */
  onUpdated?: (order: OnlineOrderResponse) => void;
}) {
  const { api, t } = useCustomer();
  const text = onlineFulfilmentDictionary(locale).customer;
  const shop = getShopText(locale);
  const view = fulfilmentView(order);
  const [asking, setAsking] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  if (!view.any && !view.windows) return null;

  const shipment = order.shipment;
  const items: DescriptionItem[] = [
    ...(shipment
      ? [
          { label: text.carrier, value: shipment.carrierName },
          {
            label: text.tracking,
            value: shipment.trackingUrl ? (
              <a
                className="ls-link"
                href={shipment.trackingUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {shipment.trackingCode}
                <span className="ls-hint">{` (${text.track})`}</span>
              </a>
            ) : (
              shipment.trackingCode
            ),
          },
          { label: text.shippedAt, value: formatDateTime(shipment.shippedAt, SHOP_ZONE, locale) },
        ]
      : []),
    ...(order.deliveredAt
      ? [
          {
            label: text.deliveredAt,
            value: formatDateTime(order.deliveredAt, SHOP_ZONE, locale),
          },
        ]
      : []),
  ];

  async function receive() {
    const next = await api.post<OnlineOrderResponse>(
      `/api/v1/me/online-orders/${order.id}/received`,
      {},
    );
    setAsking(false);
    setConfirmed(true);
    onUpdated?.(next);
  }

  return (
    <>
      {view.any ? (
        <Reveal>
          <Card as="section" aria-label={text.title}>
            <CardHeader
              title={text.title}
              actions={
                view.canConfirm ? (
                  <Button variant="primary" onClick={() => setAsking(true)}>
                    {text.received}
                  </Button>
                ) : undefined
              }
            />
            <Stack gap="block">
              {confirmed ? <Notice tone="success">{text.receivedDone}</Notice> : null}
              {view.failed ? <Notice tone="warning">{text.failed}</Notice> : null}
              {view.refundedVnd ? (
                <Notice tone="success">
                  {fill(text.refunded, { amount: formatVnd(view.refundedVnd, locale) })}
                </Notice>
              ) : null}
              {items.length > 0 ? <DescriptionList items={items} /> : null}
            </Stack>
          </Card>
        </Reveal>
      ) : null}
      {view.windows ? (
        <Reveal>
          <Card as="section" aria-label={text.returnsTitle}>
            <CardHeader title={text.returnsTitle} />
            <Stack gap="block">
              <p>
                {fill(text.personal, {
                  until: formatDateTime(view.windows.personalPreferenceUntil, SHOP_ZONE, locale),
                })}
              </p>
              <p>
                {fill(text.wrong, {
                  until: formatDateTime(view.windows.wrongOrDamagedUntil, SHOP_ZONE, locale),
                })}
              </p>
              <p className="ls-hint">{text.handled}</p>
            </Stack>
          </Card>
        </Reveal>
      ) : null}
      {asking ? (
        <ConfirmDialog
          title={text.receivedTitle}
          description={text.receivedBody}
          tone="neutral"
          confirmLabel={text.receivedConfirm}
          busyLabel={text.receivedBusy}
          cancelLabel={text.receivedKeep}
          referenceLabel={t.errors.reference}
          describeError={(error) => ({
            message: shopErrorMessage(error, shop.errors, (cause) =>
              customerErrorMessage(cause, t),
            ),
            reference: error instanceof ApiError ? error.requestId : null,
          })}
          onConfirm={receive}
          onCancel={() => setAsking(false)}
        />
      ) : null}
    </>
  );
}
