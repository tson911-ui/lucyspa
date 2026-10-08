'use client';

import type {
  InvoiceResponse,
  PreOrderContactRequest,
  ProductOrderLineResponse,
  ProductOrderResponse,
  ProductOrderTicketLinkResponse,
} from '@lucy-spa/contracts';
import {
  Card,
  CardHeader,
  DataTable,
  DescriptionList,
  Dialog,
  Field,
  FormDialog,
  FormGrid,
  Stack,
  TextInput,
  type DataTableColumn,
} from '@lucy-spa/ui';
import { useState } from 'react';
import { productOrdersDictionary } from '../../../i18n/product-orders';
import type { WorkforceApi } from '../../../lib/workforce/api';
import { fill } from '../../../i18n/workforce';
import { formatDateTime } from '../../../lib/workforce/format';
import { formOverlayLabels } from '../../../lib/workforce/form-labels';
import {
  contactBody,
  expectedText,
  orderStatusTone,
  ticketUrl,
  type ContactProblem,
} from '../../../lib/workforce/product-orders';
import { productTitle } from '../../../lib/workforce/product-sale';
import { posErrorMessage } from '../../../lib/workforce/pos';
import { useWorkforce } from '../session';
import { Badge, Button, Empty, Notice } from '../ui';
import { useQrImage } from '../use-qr-image';

const errorNotice = (error: string | null) =>
  error ? <Notice tone="error">{error}</Notice> : undefined;

// ------------------------------------------------------------------------------------ the contact

/**
 * The customer behind a pre-order (OQ-34): the phone number is mandatory, the name is optional. Finalizing the invoice is the
 * dialog's one action, so the cashier cannot forget it. The server normalizes the number and refuses one that is not real.
 */
export function PreOrderContactDialog({
  working,
  error,
  onFinalize,
  onClose,
}: {
  working: boolean;
  error: string | null;
  onFinalize: (contact: PreOrderContactRequest) => Promise<boolean>;
  onClose: () => void;
}) {
  const { t, locale } = useWorkforce();
  const c = productOrdersDictionary(locale).contact;
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<ContactProblem | null>(null);

  async function save() {
    const result = contactBody({ phone, name });
    if ('problem' in result) {
      setProblem(result.problem);
      return;
    }
    setProblem(null);
    if (await onFinalize(result.contact)) onClose();
  }

  return (
    <FormDialog
      title={c.title}
      description={c.description}
      labels={{ ...formOverlayLabels(t, c.submit), submitting: c.submitting }}
      busy={working}
      dirty={phone !== '' || name !== ''}
      error={errorNotice(error)}
      onClose={onClose}
      onSubmit={save}
    >
      <FormGrid>
        <Field
          label={c.phone}
          required
          hint={c.phoneHint}
          {...(problem === 'phone' ? { error: c.needPhone } : {})}
        >
          {(control) => (
            <TextInput
              {...control}
              type="tel"
              inputMode="tel"
              autoComplete="off"
              maxLength={32}
              value={phone}
              onChange={(event) => (setPhone(event.target.value), setProblem(null))}
            />
          )}
        </Field>
        <Field label={c.name} hint={c.nameHint}>
          {(control) => (
            <TextInput
              {...control}
              autoComplete="off"
              maxLength={120}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          )}
        </Field>
      </FormGrid>
    </FormDialog>
  );
}

// ------------------------------------------------------------------------------------ the ticket link

/**
 * The secret link and its QR code, shown once. The cashier copies the link or shows the QR to the customer's phone; the system sends
 * nothing. A new link makes the old one stop working (said once, here).
 */
export function TicketLinkDialog({
  link,
  onClose,
}: {
  link: ProductOrderTicketLinkResponse;
  onClose: () => void;
}) {
  const { t, locale } = useWorkforce();
  const d = productOrdersDictionary(locale).ticket;
  const url = ticketUrl(window.location.origin, locale, link.token);
  const image = useQrImage(url, 240);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setMessage({ tone: 'success', text: d.copied });
    } catch {
      setMessage({ tone: 'error', text: d.copyFailed });
    }
  }

  return (
    <Dialog
      title={d.dialogTitle}
      description={d.dialogDescription}
      closeLabel={t.common.close}
      onClose={onClose}
      footer={
        <Button variant="primary" onClick={onClose}>
          {d.close}
        </Button>
      }
    >
      <Stack>
        <Field label={d.link}>
          {(control) => (
            <TextInput
              {...control}
              readOnly
              value={url}
              onFocus={(event) => event.currentTarget.select()}
            />
          )}
        </Field>
        <div>
          <Button variant="secondary" onClick={() => void copy()}>
            {d.copy}
          </Button>
        </div>
        {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
        {image ? (
          // A data URL generated here from the link; not a remote image.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image} alt={d.qrAlt} width={240} height={240} />
        ) : null}
        <p className="ls-hint">{d.once}</p>
      </Stack>
    </Dialog>
  );
}

// ------------------------------------------------------------------------------------ the order card

/**
 * The order of an invoice with pre-order lines: the code, the contact, each line with its status and expected range, and (for a
 * customer without an account) the ticket link. The figures are the server's; this only reads them.
 */
export function ProductOrderCard({
  invoice,
  order,
  idle,
  api,
  onChanged,
}: {
  invoice: InvoiceResponse;
  order: ProductOrderResponse;
  idle: boolean;
  api: WorkforceApi;
  /** Reloads the invoice after the link was made or revoked. */
  onChanged: () => void;
}) {
  const { t, locale } = useWorkforce();
  const d = productOrdersDictionary(locale);
  const [link, setLink] = useState<ProductOrderTicketLinkResponse | null>(null);
  const [working, setWorking] = useState<'make' | 'revoke' | null>(null);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const member = order.customer !== null;
  // The link of a customer without an account dies 30 days after the order was closed (the Owner, 2026-10-09).
  const expiresOn = order.ticketExpiresAt
    ? formatDateTime(order.ticketExpiresAt, invoice.branch.timezone, locale)
    : '';
  const expired =
    !member && order.ticketExpiresAt !== null && Date.parse(order.ticketExpiresAt) <= Date.now();
  const mayLink =
    invoice.actions.orderTicket && !member && order.status !== 'CANCELLED' && !expired;

  async function make() {
    setWorking('make');
    setMessage(null);
    try {
      setLink(
        await api.post<ProductOrderTicketLinkResponse>(
          `/api/v1/product-orders/${order.id}/ticket-link`,
          {},
        ),
      );
      onChanged();
    } catch (failure) {
      setMessage({ tone: 'error', text: posErrorMessage(failure, t) });
    } finally {
      setWorking(null);
    }
  }
  async function revoke() {
    setWorking('revoke');
    setMessage(null);
    try {
      await api.post<ProductOrderResponse>(
        `/api/v1/product-orders/${order.id}/ticket-link/revoke`,
        {},
      );
      setMessage({ tone: 'success', text: d.ticket.revoked });
      onChanged();
    } catch (failure) {
      setMessage({ tone: 'error', text: posErrorMessage(failure, t) });
    } finally {
      setWorking(null);
    }
  }

  const columns: DataTableColumn<ProductOrderLineResponse>[] = [
    {
      key: 'product',
      header: d.card.colProduct,
      mobileTitle: true,
      truncate: true,
      width: 'md',
      cell: (line) => productTitle(line, locale),
    },
    { key: 'quantity', header: d.card.colQuantity, numeric: true, cell: (line) => line.quantity },
    {
      key: 'status',
      header: d.card.colStatus,
      cell: (line) => (
        <>
          <Badge tone={orderStatusTone(line.status)}>{d.status[line.status]}</Badge>
          {line.refunded ? (
            <>
              {' '}
              <Badge tone="neutral">{d.card.refunded}</Badge>
            </>
          ) : null}
        </>
      ),
    },
    {
      key: 'expected',
      header: d.card.colExpected,
      hideBelow: 'lg',
      cell: (line) =>
        line.status === 'CANCELLED' || line.status === 'COMPLETED' || line.status === 'HANDED_OVER'
          ? '—'
          : expectedText(line, locale, {
              range: d.card.range,
              afterPayment: d.card.afterPayment,
            }),
    },
  ];

  return (
    <Card as="section">
      <CardHeader
        title={d.card.title}
        description={d.card.description}
        actions={
          mayLink ? (
            <>
              {order.ticketLinkActive ? (
                <Button
                  variant="secondary"
                  disabled={!idle || working !== null}
                  loading={working === 'revoke'}
                  onClick={() => void revoke()}
                >
                  {working === 'revoke' ? d.ticket.revoking : d.ticket.revoke}
                </Button>
              ) : null}
              <Button
                variant="secondary"

                disabled={!idle || working !== null}
                loading={working === 'make'}
                onClick={() => void make()}
              >
                {working === 'make'
                  ? d.ticket.making
                  : order.ticketLinkActive
                    ? d.ticket.makeAgain
                    : d.ticket.make}
              </Button>
            </>
          ) : undefined
        }
      />
      <DescriptionList
        items={[
          { label: d.card.code, value: order.code },
          {
            label: d.card.status,
            value: <Badge tone={orderStatusTone(order.status)}>{d.status[order.status]}</Badge>,
          },
          { label: d.card.phone, value: order.contactPhone },
          ...(order.contactName ? [{ label: d.card.name, value: order.contactName }] : []),
          {
            label: d.card.created,
            value: formatDateTime(order.createdAt, invoice.branch.timezone, locale),
          },
          {
            label: d.ticket.section,
            value: member
              ? d.ticket.memberNote
              : expired
                ? fill(d.ticket.expired, { date: expiresOn })
                : order.ticketLinkActive
                  ? order.ticketExpiresAt
                    ? fill(d.ticket.activeUntil, { date: expiresOn })
                    : d.ticket.active
                  : d.ticket.none,
          },
        ]}
      />
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <DataTable
        mode="client"
        caption={fill(t.common.list.table, { list: d.card.title })}
        columns={columns}
        rows={order.lines}
        rowKey={(line) => `${line.id}:${line.rowVersion}`}
        empty={<Empty>{d.card.title}</Empty>}
        paging={{ off: 'the order lines of one invoice' }}
      />
      {link ? <TicketLinkDialog link={link} onClose={() => setLink(null)} /> : null}
    </Card>
  );
}
