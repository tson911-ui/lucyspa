import type { ProductOrderTicketPublicResponse } from '@lucy-spa/contracts';
import {
  Badge,
  buttonClass,
  Card,
  DescriptionList,
  EmptyState,
  Band,
  Notice,
  PublicMain,
  Stack,
} from '@lucy-spa/ui';
import Link from 'next/link';
import { NAV_TRANSITION } from '../../lib/nav-transition';
import type { ReactNode } from 'react';
import type { Locale } from '../../i18n/locales';
import { productOrdersDictionary } from '../../i18n/product-orders';
import { formatVnd } from '../../lib/customer/invoice';
import { expectedRange, orderLineTone } from '../customer/member-format';

const paidFormats = new Map<string, Intl.DateTimeFormat>();

/** An instant as the day it names in the shop's time zone (the ticket shows the day of payment, not the second). */
function paidOn(instant: string, zone: string, locale: Locale): string {
  const key = `${locale}-${zone}`;
  let format = paidFormats.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-GB', {
      timeZone: zone,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
    paidFormats.set(key, format);
  }
  return format.format(new Date(instant));
}

/** An order or line state with its icon and word (B18): a cancelled line is neutral with a cross. */
function TicketStatus({
  status,
  label,
}: {
  status: ProductOrderTicketPublicResponse['status'];
  label: string;
}) {
  return (
    <Badge tone={orderLineTone(status)} icon={status === 'CANCELLED' ? 'x-circle' : undefined}>
      {label}
    </Badge>
  );
}

/**
 * The ticket page frame (DESIGN.md 9.2): one centered column of 30 rem under the wordmark, the title and its sentence centered above it.
 * The header shows only the wordmark here and the page prints without the site chrome (pages-v2.css).
 */
function TicketFrame({
  title,
  lead,
  children,
}: {
  title: string;
  lead?: string | undefined;
  children: ReactNode;
}) {
  return (
    <PublicMain>
      <Band tone="page" className="ls-ticket-band">
        <div className="ls-ticket-page">
          <div className="ls-public-title">
            <h1 className="ls-h1-display">{title}</h1>
            {lead ? <p className="ls-lead">{lead}</p> : null}
          </div>
          {children}
        </div>
      </Band>
    </PublicMain>
  );
}

/**
 * The digital pick-up ticket for the holder of the secret link: the code to read out at the counter, what was paid, each product with
 * its state and the expected range (an estimate, never a promise). No phone number, no address, no staff name, no other order.
 * One card (session 10): the code large in ink (not the brand colour: it is not a link), the order's state under it, the facts, then
 * the products as hairline rows. A line shows its own state only where it differs from the order's.
 */
export function TicketView({
  locale,
  ticket,
}: {
  locale: Locale;
  ticket: ProductOrderTicketPublicResponse;
}) {
  const d = productOrdersDictionary(locale);
  const p = d.publicTicket;
  return (
    <TicketFrame title={p.title} lead={p.bring}>
      <Stack gap="page">
        {ticket.lines.some((line) => line.status === 'ARRIVED') ? (
          <Notice tone="success">{p.arrivedHint}</Notice>
        ) : null}
        <Card as="section" aria-label={p.title} className="ls-ticket">
          <div className="ls-ticket-head">
            <p className="ls-ticket-code">
              <span className="ls-visually-hidden">{p.code}: </span>
              <span translate="no">{ticket.code}</span>
            </p>
            <TicketStatus status={ticket.status} label={d.customerStatus[ticket.status]} />
          </div>
          <DescriptionList
            className="ls-mem-summary"
            items={[
              { label: p.branch, value: ticket.branchName },
              ...(ticket.paidAt
                ? [{ label: p.paidAt, value: paidOn(ticket.paidAt, ticket.branchTimezone, locale) }]
                : []),
              {
                label: ticket.paidAt ? p.total : p.totalDue,
                value: formatVnd(ticket.totalVnd, locale),
              },
            ]}
          />
          <section aria-label={p.items} className="ls-ticket-items">
            <h2 className="ls-ticket-items-title">{p.items}</h2>
            <p className="ls-ticket-note">{p.expectedNote}</p>
            <ul className="ls-ticket-lines">
              {ticket.lines.map((line, index) => {
                const name = locale === 'vi' ? line.nameVi : line.nameEn;
                const waiting = line.status === 'PAID' || line.status === 'ORDERED';
                return (
                  <li key={`${index}:${line.nameVi}`} className="ls-ticket-line">
                    <div className="ls-ticket-line-row">
                      <p className="ls-ticket-line-name">{name}</p>
                      <p className="ls-ticket-line-price">{formatVnd(line.grossVnd, locale)}</p>
                    </div>
                    <p className="ls-ticket-line-state">
                      <span>
                        {p.colQuantity} {line.quantity}
                      </span>
                      {line.status !== ticket.status ? (
                        <TicketStatus status={line.status} label={d.customerStatus[line.status]} />
                      ) : null}
                      {waiting ? (
                        <span>
                          {p.expected}:{' '}
                          {expectedRange(line, locale, {
                            range: p.range,
                            afterPayment: p.afterPayment,
                          })}
                        </span>
                      ) : null}
                    </p>
                  </li>
                );
              })}
            </ul>
          </section>
        </Card>
      </Stack>
    </TicketFrame>
  );
}

/** The ticket cannot be read right now (the API is slow or down): not "missing", so the visitor is told to try again. */
export function TicketUnavailable({ locale, retryHref }: { locale: Locale; retryHref: string }) {
  const p = productOrdersDictionary(locale).publicTicket;
  return (
    <TicketFrame title={p.title}>
      <EmptyState
        title={p.unavailableTitle}
        action={
          <Link
            className={buttonClass('secondary', 'md')}
            href={retryHref}
            transitionTypes={NAV_TRANSITION}
          >
            {p.retry}
          </Link>
        }
      >
        {p.loadFailed}
      </EmptyState>
    </TicketFrame>
  );
}
