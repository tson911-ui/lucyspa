import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { TicketUnavailable, TicketView } from '../../../../../../components/public/ticket-view';
import { isLocale } from '../../../../../../i18n/locales';
import { productOrdersDictionary } from '../../../../../../i18n/product-orders';
import { fetchPublicTicket } from '../../../../../../lib/public-ticket';

interface TicketPageProps {
  params: Promise<{ locale: string; token: string }>;
}

// The ticket is private to the holder of the link: read on every request, never cached, never indexed, never sent on as a referrer.
export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: TicketPageProps): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return {
    title: productOrdersDictionary(locale).publicTicket.title,
    robots: { index: false, follow: false, nocache: true },
    referrer: 'no-referrer',
  };
}

export default async function TicketPage({ params }: TicketPageProps) {
  const { locale, token } = await params;
  if (!isLocale(locale)) notFound();
  const read = await fetchPublicTicket(token);
  // A wrong, revoked or unknown token is the same real 404; a failed read is a notice with a way to try again, not a 404.
  if (read.kind === 'missing') notFound();
  if (read.kind === 'error') {
    return <TicketUnavailable locale={locale} retryHref={`/${locale}/ticket/${token}`} />;
  }
  return <TicketView locale={locale} ticket={read.ticket} />;
}
