'use client';

import type {
  CustomerReferralResponse,
  ReferralChangeResponse,
  ReferrerTotalsResponse,
} from '@lucy-spa/contracts';
import {
  Card,
  CardHeader,
  Cluster,
  DataTable,
  DescriptionList,
  ListSection,
  Stack,
  type DataTableColumn,
  type DescriptionItem,
} from '@lucy-spa/ui';
import { loyaltyDictionary } from '../../../i18n/loyalty';
import { fill } from '../../../i18n/workforce';
import { formatDateTime } from '../../../lib/workforce/format';
import { useClientPaging } from '../../../lib/workforce/use-client-paging';
import { PrefetchLink as Link } from '../link';
import { useWorkforce } from '../session';
import { Badge, Button, Empty } from '../ui';

/**
 * The referrer on a customer's profile (Phase 5 P5-5): who referred them, how it was recorded, whether the referrer was rewarded
 * yet, and what this customer achieved as a referrer. The two actions sit in the card header: staff with `MANAGE_REFERRALS`
 * record a referrer for a brand-new customer; only the Owner changes one, and only before the reward. The history of Owner
 * corrections is its own short table below.
 */
export function ReferralCard({
  referral,
  asReferrer,
  can,
  zone,
  onBind,
  onChange,
}: {
  referral: CustomerReferralResponse | null;
  asReferrer: ReferrerTotalsResponse;
  can: { bindReferrer: boolean; changeReferrer: boolean };
  zone: string;
  onBind: () => void;
  onChange: () => void;
}) {
  const { locale, base } = useWorkforce();
  const l = loyaltyDictionary(locale);
  const c = l.referral.card;
  const items: DescriptionItem[] = [];
  if (referral) {
    items.push(
      {
        label: c.referrer,
        value: (
          <Link className="ls-link" href={`${base}/loyalty/${referral.referrer.id}`}>
            {referral.referrer.displayName}
            {referral.referrer.phoneMasked ? ` · ${referral.referrer.phoneMasked}` : ''}
          </Link>
        ),
      },
      {
        label: c.via,
        value:
          referral.boundVia === 'COUNTER' && referral.boundByName
            ? `${l.referral.via.COUNTER} (${referral.boundByName})`
            : l.referral.via[referral.boundVia],
      },
      { label: c.boundAt, value: formatDateTime(referral.boundAt, zone, locale) },
      {
        label: c.status,
        value: (
          <Badge tone={referral.awarded ? 'success' : 'neutral'}>
            {l.referral.status[referral.awarded ? 'REWARDED' : 'PENDING']}
          </Badge>
        ),
      },
    );
  }
  if (asReferrer.referred > 0) {
    items.push({
      label: c.asReferrer,
      value: fill(c.asReferrerValue, { n: asReferrer.referred, m: asReferrer.rewarded }),
    });
  }
  const note = referral
    ? referral.awarded
      ? fill(referral.awarded.invoiceCode ? c.rewarded : c.rewardedNoInvoice, {
          date: formatDateTime(referral.awarded.at, zone, locale),
          invoice: referral.awarded.invoiceCode ?? '',
        })
      : c.pending
    : null;
  return (
    <>
      <Card as="section" aria-label={c.title}>
        <CardHeader
          title={c.title}
          actions={
            can.bindReferrer || can.changeReferrer ? (
              <Cluster gap="inline">
                {can.bindReferrer ? (
                  <Button variant="secondary" icon="plus" onClick={onBind}>
                    {c.bind}
                  </Button>
                ) : null}
                {can.changeReferrer ? (
                  <Button variant="secondary" icon="edit" onClick={onChange}>
                    {c.change}
                  </Button>
                ) : null}
              </Cluster>
            ) : undefined
          }
        />
        <Stack gap="block">
          {items.length > 0 ? <DescriptionList items={items} columns={2} /> : null}
          {note ? <p className="ls-hint">{note}</p> : null}
          {!referral ? <p className="ls-hint">{c.none}</p> : null}
        </Stack>
      </Card>
      {referral && referral.changes.length > 0 ? (
        <ReferralHistory changes={referral.changes} zone={zone} />
      ) : null}
    </>
  );
}

/** Every Owner correction of the referrer, oldest first: old value, new value, who, when and why. */
function ReferralHistory({ changes, zone }: { changes: ReferralChangeResponse[]; zone: string }) {
  const { t, locale } = useWorkforce();
  const l = loyaltyDictionary(locale);
  const paging = useClientPaging(t, l.referral.card.history);
  const columns: DataTableColumn<ReferralChangeResponse>[] = [
    {
      key: 'when',
      header: l.referral.history.when,
      mobileTitle: true,
      cell: (change) => formatDateTime(change.createdAt, zone, locale),
    },
    {
      key: 'from',
      header: l.referral.history.from,
      truncate: true,
      width: 'md',
      cell: (change) => change.oldReferrer.displayName,
    },
    {
      key: 'to',
      header: l.referral.history.to,
      truncate: true,
      width: 'md',
      cell: (change) => change.newReferrer.displayName,
    },
    {
      key: 'by',
      header: l.referral.history.by,
      hideBelow: 'md',
      cell: (change) => change.actorName,
    },
    {
      key: 'reason',
      header: l.referral.history.reason,
      hideBelow: 'lg',
      truncate: true,
      width: 'lg',
      cell: (change) => change.reason,
    },
  ];
  return (
    <ListSection title={l.referral.card.history}>
      <DataTable
        mode="client"
        caption={fill(t.common.list.table, { list: l.referral.card.history })}
        columns={columns}
        rows={changes}
        rowKey={(change) => change.id}
        empty={<Empty>{l.referral.card.none}</Empty>}
        paging={paging}
      />
    </ListSection>
  );
}
