import type { ProductOrderTicketPublicResponse } from '@lucy-spa/contracts';
import {
  Badge,
  buttonClass,
  Card,
  CardHeader,
  DescriptionList,
  EmptyState,
  Notice,
  PublicPage,
  Stack,
} from '@lucy-spa/ui';
import Link from 'next/link';
import type { Locale } from '../../i18n/locales';
import { productOrdersDictionary } from '../../i18n/product-orders';
import { formatBusinessDate, formatVnd } from '../../lib/customer/invoice';
import { orderStatusTone } from '../../lib/workforce/product-orders';

/** An instant as the day it names in the shop's time zone (the ticket shows the day of payment, not the second). */
function paidOn(instant: string, zone: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-GB', {
    timeZone: zone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(instant));
}

function expected(
  line: Pick<ProductOrderTicketPublicResponse['lines'][number], 'expectedFrom' | 'expectedTo'>,
  locale: Locale,
  words: { range: string; afterPayment: string },
): string {
  if (!line.expectedFrom || !line.expectedTo) return words.afterPayment;
  if (line.expectedFrom === line.expectedTo) return formatBusinessDate(line.expectedFrom, locale);
  return words.range
    .replace('{from}', formatBusinessDate(line.expectedFrom, locale))
    .replace('{to}', formatBusinessDate(line.expectedTo, locale));
}

/**
 * The digital pick-up ticket for the holder of the secret link: the code to read out at the counter, what was paid, each product with
 * its state and the expected range (an estimate, never a promise). No phone number, no address, no staff name, no other order.
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
    <PublicPage title={p.title} lead={p.bring} width="narrow">
      <Stack gap="page">
        {ticket.lines.some((line) => line.status === 'ARRIVED') ? (
          <Notice tone="success">{p.arrivedHint}</Notice>
        ) : null}
        <Card as="section" aria-label={p.title} className="ls-ticket">
          <div className="ls-ticket-head">
            <div>
              <p className="ls-ticket-label">{p.code}</p>
              <p className="ls-ticket-code">{ticket.code}</p>
            </div>
            <Badge tone={orderStatusTone(ticket.status)}>{d.customerStatus[ticket.status]}</Badge>
          </div>
          <DescriptionList
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
        </Card>
        <Card as="section" aria-label={p.items}>
          <CardHeader title={p.items} description={p.expectedNote} />
          <ul className="ls-ticket-lines">
            {ticket.lines.map((line, index) => {
              const name = locale === 'vi' ? line.nameVi : line.nameEn;
              const waiting = line.status === 'PAID' || line.status === 'ORDERED';
              return (
                <li key={`${index}:${line.nameVi}`} className="ls-ticket-line">
                  <p className="ls-ticket-line-name">{name}</p>
                  <p className="ls-ticket-line-price">
                    {p.colQuantity} {line.quantity} · {formatVnd(line.grossVnd, locale)}
                  </p>
                  <p className="ls-ticket-line-state">
                    <Badge tone={orderStatusTone(line.status)}>
                      {d.customerStatus[line.status]}
                    </Badge>
                    {waiting ? (
                      <span>
                        {p.expected}:{' '}
                        {expected(line, locale, { range: p.range, afterPayment: p.afterPayment })}
                      </span>
                    ) : null}
                  </p>
                </li>
              );
            })}
          </ul>
        </Card>
      </Stack>
    </PublicPage>
  );
}

/** The ticket cannot be read right now (the API is slow or down): not "missing", so the visitor is told to try again. */
export function TicketUnavailable({ locale, retryHref }: { locale: Locale; retryHref: string }) {
  const p = productOrdersDictionary(locale).publicTicket;
  return (
    <PublicPage title={p.title} width="narrow">
      <EmptyState
        title={p.unavailableTitle}
        action={
          <Link className={buttonClass('secondary', 'md')} href={retryHref}>
            {p.retry}
          </Link>
        }
      >
        {p.loadFailed}
      </EmptyState>
    </PublicPage>
  );
}
