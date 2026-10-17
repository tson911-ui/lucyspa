'use client';

import type { TipServedBy } from '@lucy-spa/contracts';
import { TIP_MAX_VND, TIP_PRESETS_VND } from '@lucy-spa/contracts';
import { DescriptionList, Field, MoneyInput, RadioGroup, Stack } from '@lucy-spa/ui';
import { payDictionary } from '../../../i18n/pay';
import { fill } from '../../../i18n/workforce';
import { formatVnd } from '../../../lib/workforce/format';
import { tipDraftAmount, tipTotal, type TipDraft, type TipPick } from '../../../lib/workforce/pay';
import { useWorkforce } from '../session';
import { Notice } from '../ui';
import { groupedNumber, groupSeparator } from './pos-format';

/**
 * "Thêm tip" (Phase 7 P7-17, Owner decision of 2026-10-12): the optional step of a PayOS payment where the CUSTOMER chooses a tip for the
 * technicians who served them. One KTV: that person only; several: every one of them, each with their own amount. The choice is made here,
 * before the QR code exists, and is frozen with the request: no other screen or endpoint changes it. The customer then transfers the
 * invoice amount plus the tip in one payment. Choices wrap onto further lines instead of squeezing, so the step holds at 130% text on a phone.
 */
export function TipStep({
  served,
  drafts,
  onChange,
  invoiceVnd,
  showProblems,
}: {
  served: readonly TipServedBy[];
  drafts: readonly TipDraft[];
  onChange: (drafts: TipDraft[]) => void;
  /** The invoice part of this payment (decimal string), for the total the customer transfers. */
  invoiceVnd: string;
  showProblems: boolean;
}) {
  const { t, locale } = useWorkforce();
  const c = payDictionary(locale).tips.step;
  // A cached Intl formatter per locale, not a new one on every keystroke (rbp js-cache-function-results, wig :79).
  const options: { value: TipPick; label: string }[] = [
    { value: 'NONE', label: c.none },
    ...TIP_PRESETS_VND.map((preset) => ({
      value: preset as TipPick,
      label: groupedNumber(locale, Number(preset)),
    })),
    { value: 'OTHER', label: c.other },
  ];
  // One map of the served names (rbp js-index-maps); a person the offer no longer lists still gets a legend (wig :45).
  const names = new Map(served.map((item) => [item.employee.id, item.employee.name]));
  const nameOf = (id: string) => names.get(id) || t.pos.colStaff;
  const single = drafts.length === 1;
  const update = (index: number, change: Partial<TipDraft>) =>
    onChange(drafts.map((draft, at) => (at === index ? { ...draft, ...change } : draft)));
  const total = tipTotal(drafts);
  const eachValid = drafts.every((draft) => tipDraftAmount(draft) !== null);

  return (
    <Stack>
      {single ? null : <p className="ls-hint">{c.many}</p>}
      {drafts.map((draft, index) => {
        const name = nameOf(draft.employeeUserId);
        const wrong = showProblems && tipDraftAmount(draft) === null;
        return (
          <Stack key={draft.employeeUserId}>
            <RadioGroup
              legend={single ? fill(c.one, { name }) : name}
              name={`tip-${draft.employeeUserId}`}
              value={draft.pick}
              layout="inline"
              onValueChange={(pick) =>
                update(index, {
                  pick: pick as TipPick,
                  ...(pick === 'OTHER' ? {} : { other: null }),
                })
              }
              options={options}
            />
            {draft.pick === 'OTHER' ? (
              <Field label={c.otherAmount} {...(wrong ? { error: c.invalid } : {})}>
                {(props) => (
                  <MoneyInput
                    {...props}
                    unit="₫"
                    separator={groupSeparator(locale)}
                    value={draft.other}
                    onValueChange={(other) => update(index, { other })}
                  />
                )}
              </Field>
            ) : null}
          </Stack>
        );
      })}
      <DescriptionList
        layout="totals"
        items={[
          { label: c.invoicePart, value: formatVnd(invoiceVnd, locale) },
          { label: c.total, value: formatVnd(String(total), locale) },
          {
            label: c.transfer,
            value: formatVnd((BigInt(invoiceVnd) + BigInt(total)).toString(), locale),
            strong: true,
          },
        ]}
      />
      <p className="ls-hint">{c.help}</p>
      {showProblems && eachValid && total > TIP_MAX_VND ? (
        <Notice tone="error">{c.invalid}</Notice>
      ) : null}
    </Stack>
  );
}
