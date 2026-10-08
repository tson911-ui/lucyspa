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
import { birthdayDictionary } from '../../../i18n/birthday';
import { comboDictionary } from '../../../i18n/combo';
import { loyaltyDictionary } from '../../../i18n/loyalty';
import { fill } from '../../../i18n/workforce';
import {
  bpToPercent,
  candidateBenefitLabel,
  ineligibleText,
} from '../../../lib/workforce/discounts';
import { giftText } from '../../../lib/workforce/birthday';
import { formatDate, formatVnd } from '../../../lib/workforce/format';
import { paginationLabels } from '../../../lib/workforce/list-view';
import { useWorkforce } from '../session';
import { Badge, Empty, Notice } from '../ui';

type Candidate = InvoiceResponse['discount']['candidates'][number];

/** One line of "Các ưu đãi đã xét": a program candidate or the Member Discount, already turned into text. */
interface DiscountRow {
  key: string;
  name: string;
  benefit: string;
  source: string;
  winner: boolean;
  eligible: boolean;
  reason: string | null;
}
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
export function DiscountCard({ invoice, title }: { invoice: InvoiceResponse; title?: string }) {
  const { t, locale } = useWorkforce();
  const paging = usePaging();
  const l = loyaltyDictionary(locale);
  const { winner, member, winnerSource, birthday } = invoice.discount;
  const bd = birthdayDictionary(locale).invoice;
  const programName = (candidate: Pick<Candidate, 'nameVi' | 'nameEn'>) =>
    locale === 'vi' ? candidate.nameVi : candidate.nameEn;
  const percentOf = (bp: number) => {
    const percent = bpToPercent(bp);
    return locale === 'vi' ? percent.replace('.', ',') : percent;
  };
  const memberTier = member ? l.tiers[member.tier] : '';
  const giftReason = (reason: keyof typeof bd.notApplied) =>
    fill(bd.notApplied[reason], {
      amount: formatVnd(birthday?.minSpendVnd ?? '0', locale),
    });
  const rows: DiscountRow[] = [
    ...(member
      ? [
          {
            key: 'member',
            name:
              member.tier === 'NONE'
                ? l.member.nameNoTier
                : fill(l.member.name, { tier: memberTier }),
            benefit: `${percentOf(member.discountBp)}%`,
            source: l.member.source,
            winner: member.winner,
            eligible: member.eligible,
            reason: member.reason ? l.member.ineligible[member.reason] : null,
          },
        ]
      : []),
    ...invoice.discount.candidates.map((candidate): DiscountRow => ({
      key: `${candidate.discountId}:${candidate.voucherId ?? ''}`,
      name: programName(candidate),
      benefit: candidateBenefitLabel(candidate, locale),
      source: candidate.voucherCode
        ? fill(t.pos.candidateCode, { code: candidate.voucherCode })
        : t.pos.candidateAuto,
      winner: candidate.winner,
      eligible: candidate.eligible,
      reason: candidate.reason ? ineligibleText(candidate.reason, t) : null,
    })),
    // The birthday gift is its own layer after the best offer (Phase 5 P5-6), listed last.
    ...(birthday
      ? [
          {
            key: 'birthday',
            name: bd.rowName,
            benefit: giftText(birthday, locale, true),
            source: bd.source,
            winner: birthday.applied,
            eligible: birthday.applied,
            reason: birthday.reason ? bd.notAppliedShort[birthday.reason] : null,
          } satisfies DiscountRow,
        ]
      : []),
  ];
  const reasonText = (reason: string): string =>
    (bd.reasons as Record<string, string>)[reason] ??
    (l.member.reasons as Record<string, string>)[reason] ??
    (t.pos.selectionReasons as Record<string, string>)[reason] ??
    reason;

  const columns: DataTableColumn<DiscountRow>[] = [
    {
      key: 'program',
      header: t.pos.colProgram,
      mobileTitle: true,
      truncate: true,
      width: 'lg',
      cell: (row) => row.name,
    },
    {
      key: 'benefit',
      header: t.pos.colBenefit,
      numeric: true,
      cell: (row) => row.benefit,
    },
    {
      key: 'source',
      header: t.pos.colSource,
      hideBelow: 'md',
      cell: (row) => row.source,
    },
    {
      key: 'result',
      header: t.pos.colResult,
      wrap: true,
      width: 'lg',
      cell: (row) =>
        // Only the winner is a badge; the long explanations are plain text that wraps inside the cell.
        row.winner ? (
          <Badge tone="success">{t.pos.candidateWinner}</Badge>
        ) : row.eligible ? (
          t.pos.candidateEligible
        ) : (
          (row.reason ?? '—')
        ),
    },
  ];

  return (
    <Card as="section">
      <CardHeader title={title ?? t.pos.discountTitle} description={t.pos.discountNote} />
      {winnerSource === 'MEMBER_TIER' && member ? (
        <Notice tone="success">
          <strong>
            {fill(l.member.applied, { tier: memberTier, percent: percentOf(member.discountBp) })}
          </strong>{' '}
          · {fill(t.pos.candidateAmount, { amount: formatVnd(member.amountVnd, locale) })}
          {invoice.discount.selectionReason
            ? ` — ${reasonText(invoice.discount.selectionReason)}`
            : ''}
        </Notice>
      ) : winnerSource === 'BIRTHDAY' ? null : winner ? (
        <Notice tone="success">
          <strong>{fill(t.pos.discountApplied, { name: programName(winner) })}</strong> ·{' '}
          {candidateBenefitLabel(winner, locale)} ·{' '}
          {fill(t.pos.candidateAmount, { amount: formatVnd(winner.amountVnd, locale) })}
          {invoice.discount.selectionReason
            ? ` — ${reasonText(invoice.discount.selectionReason)}`
            : ''}
        </Notice>
      ) : (
        <Empty>{t.pos.discountNone}</Empty>
      )}
      {birthday ? (
        <Notice tone={birthday.applied ? 'success' : 'info'}>
          {birthday.applied ? (
            <>
              <strong>
                {birthday.mode === 'STACKED'
                  ? bd.stacked
                  : birthday.mode === 'REPLACES_OFFER'
                    ? bd.replaces
                    : bd.alone}
              </strong>{' '}
              · {fill(t.pos.candidateAmount, { amount: formatVnd(birthday.amountVnd, locale) })}
              {winnerSource === 'BIRTHDAY' && invoice.discount.selectionReason
                ? ` — ${reasonText(invoice.discount.selectionReason)}`
                : ''}
            </>
          ) : (
            <>
              <strong>{bd.rowName}</strong> · {birthday.reason ? giftReason(birthday.reason) : ''}
            </>
          )}{' '}
          · {fill(bd.birthdayOn, { date: formatDate(birthday.birthdayOn, locale) })}
        </Notice>
      ) : null}
      {birthday && invoice.discount.preview ? <p className="ls-hint">{bd.previewNote}</p> : null}
      {member && invoice.discount.preview ? (
        <p className="ls-hint">{l.member.previewNote}</p>
      ) : null}
      {rows.length > 0 ? (
        <DataTable
          mode="client"
          caption={fill(t.common.list.table, { list: t.pos.candidatesTitle })}
          columns={columns}
          rows={rows}
          rowKey={(row) => row.key}
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
  const { t, locale } = useWorkforce();
  const { payer, defaultPayer } = invoice;
  // A combo sale has a fixed buyer (the owner of the combo), so the card says "Buyer" and offers no change.
  const buyer = invoice.kind === 'COMBO_SALE';
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
        title={buyer ? comboDictionary(locale).invoice.buyerTitle : t.pos.payerTitle}
        actions={
          items.length > 0 ? <RowActions menuLabel={t.pos.payerMenu} items={items} /> : undefined
        }
      />
      <DescriptionList
        columns={2}
        items={[
          {
            label: buyer ? comboDictionary(locale).invoice.buyer : t.pos.payer,
            value: payer ? payer.displayName : t.pos.guestPayer,
          },
          ...(payer?.phoneMasked ? [{ label: t.pos.phone, value: payer.phoneMasked }] : []),
          ...(payer?.emailMasked ? [{ label: t.pos.email, value: payer.emailMasked }] : []),
        ]}
      />
    </Card>
  );
}
