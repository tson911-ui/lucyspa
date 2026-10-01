'use client';

import type { WalkInMemberLookupResponse } from '@lucy-spa/contracts';
import { Field, FormDialog, FormGrid, Select, TextInput } from '@lucy-spa/ui';
import { useState } from 'react';
import { fill } from '../../../i18n/workforce';
import { boardErrorMessage } from '../../../lib/workforce/booking-board';
import { formOverlayLabels } from '../../../lib/workforce/form-labels';
import { useWorkforce } from '../session';
import { Notice } from '../ui';

type Member = WalkInMemberLookupResponse['members'][number];

/**
 * Find an existing member by the exact phone or email (never by name). One primary button: "Search" until a
 * member is found, then "Add this member"; changing the text goes back to searching.
 */
export function MemberLookupDialog({
  branchId,
  taken,
  onAdd,
  onClose,
}: {
  branchId: string;
  /** Account ids already in the visit. */
  taken: ReadonlySet<string>;
  onAdd: (member: Member) => void;
  onClose: () => void;
}) {
  const { api, t } = useWorkforce();
  const [lookupBy, setLookupBy] = useState<'phone' | 'email'>('phone');
  const [value, setValue] = useState('');
  const [lookup, setLookup] = useState<WalkInMemberLookupResponse | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const member = lookup?.members[0] ?? null;

  async function submit() {
    if (member) {
      onAdd(member);
      onClose();
      return;
    }
    if (searching || !value.trim()) return;
    setSearching(true);
    setError(null);
    try {
      setLookup(
        await api.get<WalkInMemberLookupResponse>(
          `/api/v1/operations/branches/${branchId}/members`,
          { [lookupBy]: value.trim() },
        ),
      );
    } catch (failure) {
      setLookup(null);
      setError(boardErrorMessage(failure, t));
    } finally {
      setSearching(false);
    }
  }

  return (
    <FormDialog
      title={t.walkIn.lookupTitle}
      description={t.walkIn.lookupHint}
      labels={{
        ...formOverlayLabels(t, member ? t.walkIn.addMember : t.walkIn.search),
        submitting: member ? t.common.saving : t.walkIn.searching,
      }}
      busy={searching}
      dirty={value !== ''}
      submitDisabled={member !== null && taken.has(member.id)}
      error={error ? <Notice tone="error">{error}</Notice> : undefined}
      onClose={onClose}
      onSubmit={submit}
    >
      <FormGrid>
        <Field label={t.walkIn.lookupBy}>
          {(control) => (
            <Select
              {...control}
              value={lookupBy}
              options={[
                { value: 'phone', label: t.walkIn.phone },
                { value: 'email', label: t.walkIn.email },
              ]}
              onChange={(event) => (
                setLookupBy(event.target.value as 'phone' | 'email'),
                setLookup(null)
              )}
            />
          )}
        </Field>
        <Field label={lookupBy === 'phone' ? t.walkIn.phone : t.walkIn.email}>
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
            {fill(t.walkIn.found, { name: member.displayName })}
            {member.phoneMasked ? ` · ${member.phoneMasked}` : ''}
            {member.emailMasked ? ` · ${member.emailMasked}` : ''}
          </Notice>
        ) : null}
        {lookup && lookup.members.length === 0 ? (
          <Notice tone="info">{t.walkIn.notFound}</Notice>
        ) : null}
      </FormGrid>
    </FormDialog>
  );
}
