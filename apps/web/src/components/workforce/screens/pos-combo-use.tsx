'use client';

import type {
  ComboLookupResponse,
  ComboUsedBy,
  ComboUseRequest,
  InvoiceLineResponse,
} from '@lucy-spa/contracts';
import {
  Card,
  CardHeader,
  DescriptionList,
  Field,
  FormDialog,
  FormGrid,
  RadioGroup,
  Select,
  TextInput,
} from '@lucy-spa/ui';
import { memo, useState } from 'react';
import { comboDictionary } from '../../../i18n/combo';
import { fill } from '../../../i18n/workforce';
import {
  comboErrorText,
  comboLookupLabel,
  comboUseBadgeText,
  comboUseBody,
  comboUseTone,
} from '../../../lib/workforce/combo';
import { formOverlayLabels } from '../../../lib/workforce/form-labels';
import { posErrorMessage } from '../../../lib/workforce/pos';
import { useWorkforce } from '../session';
import { Badge, Notice } from '../ui';
import { sentence } from './pos-format';
import { focusFirstInvalid } from './pos-dom';

/**
 * Pay one service line of a DRAFT with a session of a combo (Phase 5 P5-8; PRD 17.4, 52). The staff member types the combo OWNER's
 * exact phone: the screen shows only the owner's masked name, the combo name and the sessions left (never a phone, an email or a
 * history). Then they say whether the owner or a relative uses the session. One primary button: "Find combo" until the owner's
 * combos are found, then "Use combo". The line becomes 0 đồng; the session is taken only when the invoice is finalized, and the
 * server decides every rule again.
 */
export function ComboUseDialog({
  invoiceId,
  line,
  version,
  working,
  error,
  onUse,
  onClose,
}: {
  invoiceId: string;
  line: InvoiceLineResponse;
  version: number;
  working: boolean;
  error: string | null;
  onUse: (body: ComboUseRequest) => Promise<boolean>;
  onClose: () => void;
}) {
  const { api, t, locale } = useWorkforce();
  const c = comboDictionary(locale);
  const u = c.use;
  const [phone, setPhone] = useState('');
  const [lookup, setLookup] = useState<ComboLookupResponse | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [purchaseId, setPurchaseId] = useState('');
  const [usedBy, setUsedBy] = useState<ComboUsedBy>('OWNER');
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<'phone' | 'combo' | null>(null);

  const owner = lookup?.owners[0] ?? null;
  // Only the combos that can pay THIS line.
  const combos = (owner?.combos ?? []).filter((combo) => combo.lineIds.includes(line.id));
  const chosen = combos.find((combo) => combo.purchaseId === purchaseId) ?? null;
  const found = owner !== null && combos.length > 0;

  async function submit() {
    if (searching) return;
    if (found) {
      const body = comboUseBody({ purchaseId, usedBy, note }, version);
      if (!body) {
        setProblem('combo');
        focusFirstInvalid();
        return;
      }
      setProblem(null);
      if (await onUse(body)) onClose();
      return;
    }
    if (!phone.trim()) {
      setProblem('phone');
      focusFirstInvalid();
      return;
    }
    setProblem(null);
    setSearching(true);
    setSearchError(null);
    try {
      const result = await api.post<ComboLookupResponse>(
        `/api/v1/pos/invoices/${invoiceId}/combo-lookup`,
        { phone: phone.trim() },
      );
      setLookup(result);
      // One usable combo is chosen for the staff member; several need a choice.
      const usable = (result.owners[0]?.combos ?? []).filter((combo) =>
        combo.lineIds.includes(line.id),
      );
      setPurchaseId(usable.length === 1 ? (usable[0]?.purchaseId ?? '') : '');
    } catch (failure) {
      setLookup(null);
      setSearchError(comboErrorText(failure, locale, (cause) => posErrorMessage(cause, t)));
    } finally {
      setSearching(false);
    }
  }

  const label = found ? u.submit : u.search;
  const shownError = searchError ?? error;
  return (
    <FormDialog
      title={u.title}
      description={`${sentence(locale === 'vi' ? line.nameVi : line.nameEn)} ${u.freeNote}`}
      labels={{
        ...formOverlayLabels(t, label),
        submitting: found ? u.submitting : u.searching,
      }}
      busy={working || searching}
      dirty={phone !== '' || purchaseId !== '' || note !== ''}
      error={shownError ? <Notice tone="error">{shownError}</Notice> : undefined}
      onClose={onClose}
      onSubmit={submit}
    >
      <FormGrid>
        <Field
          label={u.phone}
          hint={lookup && !found ? u.notFound : u.phoneHint}
          {...(problem === 'phone' ? { error: u.needPhone } : {})}
        >
          {(control) => (
            <TextInput
              {...control}
              type="tel"
              inputMode="tel"
              autoComplete="off"
              maxLength={32}
              value={phone}
              onChange={(event) => (
                setPhone(event.target.value),
                setLookup(null),
                setPurchaseId(''),
                setProblem(null)
              )}
            />
          )}
        </Field>
        {found ? (
          <>
            <Field
              label={u.combo}
              hint={[
                owner ? fill(u.ownerFound, { name: owner.ownerNameMasked }) : '',
                chosen
                  ? fill(u.leftHint, { left: chosen.sessionsLeft, total: chosen.totalSessions })
                  : '',
              ]
                .filter(Boolean)
                .map(sentence)
                .join(' ')}
              {...(problem === 'combo' && !chosen ? { error: u.needCombo } : {})}
            >
              {(control) => (
                <Select
                  {...control}
                  value={purchaseId}
                  // The empty choice says what to do, not the field's own label again.
                  placeholder={c.sale.comboPlaceholder}
                  options={combos.map((combo) => ({
                    value: combo.purchaseId,
                    label: comboLookupLabel(combo, locale),
                  }))}
                  onChange={(event) => (setPurchaseId(event.target.value), setProblem(null))}
                />
              )}
            </Field>
            {/* Two choices are a toggle, not a pop-up menu (C47). */}
            <RadioGroup
              legend={u.usedBy}
              name="combo-used-by"
              layout="inline"
              value={usedBy}
              options={[
                { value: 'OWNER', label: u.usedByOwner },
                { value: 'RELATIVE', label: u.usedByRelative },
              ]}
              onValueChange={(next) => setUsedBy(next as ComboUsedBy)}
            />
            {usedBy === 'RELATIVE' ? (
              <Field label={u.relationship} hint={u.relationshipHint}>
                {(control) => (
                  <TextInput
                    {...control}
                    autoComplete="off"
                    maxLength={120}
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                  />
                )}
              </Field>
            ) : null}
          </>
        ) : null}
      </FormGrid>
    </FormDialog>
  );
}

/**
 * The service lines paid with a combo session (Phase 5 P5-8): which combo, which session (PAID or BONUS), the owner or a
 * relative, and where the use stands. Nothing is shown when no line uses a combo. The table above keeps its own columns, so a
 * long combo name never widens it.
 */
// Memoised: it only shows the server's answer, so a busy flag, a feedback line or a dialog does not re-render it (rbp pos-invoice.tsx:100-776).
export const ComboUseCard = memo(function ComboUseCard({
  lines,
}: {
  lines: InvoiceLineResponse[];
}) {
  const { locale } = useWorkforce();
  const c = comboDictionary(locale);
  const used = lines.filter((line) => line.comboUse !== null);
  if (used.length === 0) return null;
  return (
    <Card as="section" aria-label={c.use.cardTitle}>
      <CardHeader title={c.use.cardTitle} description={c.use.cardHint} />
      <DescriptionList
        items={used.map((line) => {
          const use = line.comboUse!;
          return {
            label: fill(c.use.cardService, {
              service: locale === 'vi' ? line.nameVi : line.nameEn,
              guest: line.participant.displayName ?? '—',
            }),
            value: (
              <>
                {comboUseBadgeText(use, locale)}{' '}
                <Badge tone={comboUseTone(use.state)}>{c.use.state[use.state]}</Badge>
              </>
            ),
          };
        })}
      />
    </Card>
  );
});
