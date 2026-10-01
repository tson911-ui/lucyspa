'use client';

import type { InvoiceResponse } from '@lucy-spa/contracts';
import {
  Button,
  Card,
  CardHeader,
  DataTable,
  DescriptionList,
  RowActions,
  type DataTableColumn,
  type MenuItem,
} from '@lucy-spa/ui';
import { useState } from 'react';
import { fill } from '../../../i18n/workforce';
import { candidateBenefitLabel, ineligibleText } from '../../../lib/workforce/discounts';
import { formatVnd } from '../../../lib/workforce/format';
import { paginationLabels } from '../../../lib/workforce/list-view';
import { useWorkforce } from '../session';
import { Badge, Empty, Notice } from '../ui';

type Candidate = InvoiceResponse['discount']['candidates'][number];
type AppliedVoucher = InvoiceResponse['discount']['vouchers'][number];

/** Client paging for the short lists of one invoice (20 per page, like every list). */
function usePaging() {
  const [paging, setPaging] = useState({ page: 1, pageSize: 20 });
  return {
    ...paging,
    onPageChange: (page: number) => setPaging((current) => ({ ...current, page })),
    onPageSizeChange: (pageSize: number) => setPaging({ page: 1, pageSize }),
  };
}

/** The server's benefit evaluation: the winner and every program considered. Nothing here is chosen by the cashier. */
export function DiscountCard({ invoice }: { invoice: InvoiceResponse }) {
  const { t, locale } = useWorkforce();
  const paging = usePaging();
  const winner = invoice.discount.winner;
  const programName = (candidate: Pick<Candidate, 'nameVi' | 'nameEn'>) =>
    locale === 'vi' ? candidate.nameVi : candidate.nameEn;

  const columns: DataTableColumn<Candidate>[] = [
    {
      key: 'program',
      header: t.pos.colProgram,
      mobileTitle: true,
      truncate: true,
      width: 'lg',
      cell: (candidate) => programName(candidate),
    },
    {
      key: 'benefit',
      header: t.pos.colBenefit,
      numeric: true,
      cell: (candidate) => candidateBenefitLabel(candidate, locale),
    },
    {
      key: 'source',
      header: t.pos.colSource,
      hideBelow: 'md',
      cell: (candidate) =>
        candidate.voucherCode
          ? fill(t.pos.candidateCode, { code: candidate.voucherCode })
          : t.pos.candidateAuto,
    },
    {
      key: 'result',
      header: t.pos.colResult,
      wrap: true,
      width: 'lg',
      cell: (candidate) =>
        // Only the winner is a badge; the long explanations are plain text that wraps inside the cell.
        candidate.winner ? (
          <Badge tone="success">{t.pos.candidateWinner}</Badge>
        ) : candidate.eligible ? (
          t.pos.candidateEligible
        ) : candidate.reason ? (
          ineligibleText(candidate.reason, t)
        ) : (
          '—'
        ),
    },
  ];

  return (
    <Card as="section">
      <CardHeader title={t.pos.discountTitle} description={t.pos.discountNote} />
      {winner ? (
        <Notice tone="success">
          <strong>{fill(t.pos.discountApplied, { name: programName(winner) })}</strong> ·{' '}
          {candidateBenefitLabel(winner, locale)} ·{' '}
          {fill(t.pos.candidateAmount, { amount: formatVnd(winner.amountVnd, locale) })}
          {invoice.discount.selectionReason
            ? ` — ${
                t.pos.selectionReasons[
                  invoice.discount.selectionReason as keyof typeof t.pos.selectionReasons
                ] ?? invoice.discount.selectionReason
              }`
            : ''}
        </Notice>
      ) : (
        <Empty>{t.pos.discountNone}</Empty>
      )}
      {invoice.discount.candidates.length > 0 ? (
        <DataTable
          mode="client"
          caption={fill(t.common.list.table, { list: t.pos.candidatesTitle })}
          columns={columns}
          rows={invoice.discount.candidates}
          rowKey={(candidate) => `${candidate.discountId}:${candidate.voucherId ?? ''}`}
          paging={{ ...paging, labels: paginationLabels(t, t.pos.candidatesTitle) }}
        />
      ) : null}
    </Card>
  );
}

/** Promo codes the cashier supplied; they only make a program eligible, the server still picks the winner. */
export function VouchersCard({
  invoice,
  working,
  onEnter,
  onRemove,
}: {
  invoice: InvoiceResponse;
  working: boolean;
  onEnter: () => void;
  onRemove: (voucher: AppliedVoucher) => void;
}) {
  const { t, locale } = useWorkforce();
  const paging = usePaging();
  const editable = invoice.status === 'DRAFT' && invoice.actions.applyVouchers;

  const columns: DataTableColumn<AppliedVoucher>[] = [
    {
      key: 'code',
      header: t.pos.voucherCode,
      mobileTitle: true,
      cell: (voucher) => <code>{voucher.code}</code>,
    },
    {
      key: 'program',
      header: t.pos.colProgram,
      truncate: true,
      width: 'lg',
      cell: (voucher) => (locale === 'vi' ? voucher.nameVi : voucher.nameEn),
    },
    ...(editable
      ? [
          {
            key: 'actions',
            header: t.common.actions,
            actions: true,
            cell: (voucher: AppliedVoucher) => (
              <RowActions
                menuLabel={fill(t.common.list.actionsFor, { name: voucher.code })}
                items={[
                  {
                    id: 'remove',
                    label: t.pos.voucherRemove,
                    disabled: working,
                    onSelect: () => onRemove(voucher),
                  },
                ]}
              />
            ),
          },
        ]
      : []),
  ];

  return (
    <Card as="section">
      <CardHeader
        title={t.pos.voucherTitle}
        actions={
          editable ? (
            <Button variant="secondary" icon="plus" disabled={working} onClick={onEnter}>
              {t.pos.voucherEnter}
            </Button>
          ) : undefined
        }
      />
      <DataTable
        mode="client"
        caption={fill(t.common.list.table, { list: t.pos.voucherTitle })}
        columns={columns}
        rows={invoice.discount.vouchers}
        rowKey={(voucher) => voucher.id}
        empty={<Empty>{t.pos.voucherNone}</Empty>}
        paging={{ ...paging, labels: paginationLabels(t, t.pos.voucherTitle) }}
      />
    </Card>
  );
}

/** Who pays: the member or the guest. Changing it is a menu in the card header while the invoice is a draft. */
export function PayerCard({
  invoice,
  working,
  onFind,
  onSetPayer,
}: {
  invoice: InvoiceResponse;
  working: boolean;
  onFind: () => void;
  onSetPayer: (payerUserId: string | null) => void;
}) {
  const { t } = useWorkforce();
  const { payer, defaultPayer } = invoice;
  const items: MenuItem[] =
    invoice.status === 'DRAFT' && invoice.actions.setPayer
      ? [
          {
            id: 'find',
            label: t.pos.payerFind,
            icon: 'search',
            disabled: working,
            onSelect: onFind,
          },
          ...(defaultPayer && payer?.id !== defaultPayer.id
            ? [
                {
                  id: 'default',
                  label: `${t.pos.useDefaultPayer}: ${defaultPayer.displayName}`,
                  disabled: working,
                  onSelect: () => onSetPayer(defaultPayer.id),
                },
              ]
            : []),
          ...(payer
            ? [
                {
                  id: 'guest',
                  label: t.pos.useGuestPayer,
                  disabled: working,
                  onSelect: () => onSetPayer(null),
                },
              ]
            : []),
        ]
      : [];
  return (
    <Card as="section">
      <CardHeader
        title={t.pos.payerTitle}
        actions={
          items.length > 0 ? <RowActions menuLabel={t.pos.payerMenu} items={items} /> : undefined
        }
      />
      <DescriptionList
        columns={2}
        items={[
          { label: t.pos.payer, value: payer ? payer.displayName : t.pos.guestPayer },
          ...(payer?.phoneMasked ? [{ label: t.pos.phone, value: payer.phoneMasked }] : []),
          ...(payer?.emailMasked ? [{ label: t.pos.email, value: payer.emailMasked }] : []),
        ]}
      />
    </Card>
  );
}
