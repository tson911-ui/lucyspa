'use client';

import type {
  ComboSaleOptionsResponse,
  InvoiceOpenedResponse,
  WalkInMemberLookupResponse,
} from '@lucy-spa/contracts';
import { Field, FormDialog, FormGrid, Select, TextInput } from '@lucy-spa/ui';
import { useState } from 'react';
import { comboDictionary } from '../../../i18n/combo';
import { fill } from '../../../i18n/workforce';
import { comboErrorText, comboOptionLabel, sessionsText } from '../../../lib/workforce/combo';
import { formatVnd } from '../../../lib/workforce/format';
import { formOverlayLabels } from '../../../lib/workforce/form-labels';
import { posErrorMessage } from '../../../lib/workforce/pos';
import { useWorkforce } from '../session';
import { ErrorState, Loading, Notice, useResource } from '../ui';

/**
 * Sell a combo at the counter (Phase 5 P5-7): choose the combo, find the member who buys it by the exact phone or email, then
 * start the sale. That creates a DRAFT invoice that is not tied to a visit; from there the normal invoice flow applies (the best
 * offer, finalizing, payment). One primary button: "Search" until a member is found, then "Start sale". The server decides every
 * rule again (members only, loyalty live, the combo on sale).
 */
export function ComboSaleDialog({
  branchId,
  onStarted,
  onClose,
}: {
  branchId: string;
  onStarted: (invoiceId: string) => void;
  onClose: () => void;
}) {
  const { api, t, locale } = useWorkforce();
  const c = comboDictionary(locale);
  const s = c.sale;
  const options = useResource(
    () => api.get<ComboSaleOptionsResponse>(`/api/v1/pos/branches/${branchId}/combos`),
    [api, branchId],
  );
  const [comboId, setComboId] = useState('');
  const [lookupBy, setLookupBy] = useState<'phone' | 'email'>('phone');
  const [value, setValue] = useState('');
  const [lookup, setLookup] = useState<WalkInMemberLookupResponse | null>(null);
  const [searching, setSearching] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missingCombo, setMissingCombo] = useState(false);
  const member = lookup?.members[0] ?? null;

  const loaded = options.data;
  const sellable = loaded?.sellable ?? false;
  const sellableCombos = loaded?.options ?? [];
  const chosen = sellableCombos.find((option) => option.comboId === comboId) ?? null;

  async function submit() {
    if (starting || searching) return;
    setError(null);
    if (member) {
      if (!chosen) {
        setMissingCombo(true);
        return;
      }
      setStarting(true);
      try {
        const opened = await api.post<InvoiceOpenedResponse>(
          `/api/v1/pos/branches/${branchId}/combo-sales`,
          { comboId: chosen.comboId, payerUserId: member.id },
        );
        onStarted(opened.invoice.id);
      } catch (failure) {
        setError(comboErrorText(failure, locale, (cause) => posErrorMessage(cause, t)));
        setStarting(false);
      }
      return;
    }
    if (!value.trim()) return;
    setSearching(true);
    try {
      setLookup(
        await api.get<WalkInMemberLookupResponse>(`/api/v1/pos/branches/${branchId}/members`, {
          [lookupBy]: value.trim(),
        }),
      );
    } catch (failure) {
      setLookup(null);
      setError(posErrorMessage(failure, t));
    } finally {
      setSearching(false);
    }
  }

  const label = member ? s.start : s.search;
  return (
    <FormDialog
      title={s.title}
      description={s.description}
      labels={{
        ...formOverlayLabels(t, label),
        submitting: member ? s.starting : s.searching,
      }}
      busy={starting || searching}
      dirty={value !== '' || comboId !== ''}
      submitDisabled={!loaded || !sellable || sellableCombos.length === 0}
      error={error ? <Notice tone="error">{error}</Notice> : undefined}
      onClose={onClose}
      onSubmit={submit}
    >
      <FormGrid>
        {!loaded && options.error ? (
          <ErrorState error={options.error} t={t} onRetry={() => void options.reload()} />
        ) : null}
        {!loaded && !options.error ? <Loading t={t} /> : null}
        {loaded && !sellable ? <Notice tone="info">{s.notLive}</Notice> : null}
        {loaded && sellable && sellableCombos.length === 0 ? (
          <Notice tone="info">{s.none}</Notice>
        ) : null}
        <Field
          label={s.combo}
          {...(chosen
            ? {
                hint: fill(s.price, {
                  price: formatVnd(chosen.priceVnd, locale),
                  sessions: sessionsText(chosen.paidSessions, chosen.bonusSessions, locale),
                }),
              }
            : {})}
          {...(missingCombo && !chosen ? { error: c.form.required } : {})}
        >
          {(control) => (
            <Select
              {...control}
              value={comboId}
              placeholder={s.comboPlaceholder}
              options={sellableCombos.map((option) => ({
                value: option.comboId,
                label: comboOptionLabel(option, locale),
              }))}
              onChange={(event) => (setComboId(event.target.value), setMissingCombo(false))}
            />
          )}
        </Field>
        <Field label={s.lookupBy}>
          {(control) => (
            <Select
              {...control}
              value={lookupBy}
              options={[
                { value: 'phone', label: s.phone },
                { value: 'email', label: s.email },
              ]}
              onChange={(event) => (
                setLookupBy(event.target.value as 'phone' | 'email'),
                setLookup(null)
              )}
            />
          )}
        </Field>
        <Field label={lookupBy === 'phone' ? s.phone : s.email}>
          {(control) => (
            <TextInput
              {...control}
              type={lookupBy === 'phone' ? 'tel' : 'email'}
              inputMode={lookupBy === 'phone' ? 'tel' : 'email'}
              autoComplete="off"
              maxLength={lookupBy === 'phone' ? 32 : 320}
              value={value}
              onChange={(event) => (setValue(event.target.value), setLookup(null))}
            />
          )}
        </Field>
        {member ? (
          <Notice tone="success">
            {fill(s.found, { name: member.displayName })}
            {member.phoneMasked ? ` · ${member.phoneMasked}` : ''}
            {member.emailMasked ? ` · ${member.emailMasked}` : ''}
          </Notice>
        ) : null}
        {lookup && lookup.members.length === 0 ? <Notice tone="info">{s.notFound}</Notice> : null}
      </FormGrid>
    </FormDialog>
  );
}
