'use client';

import type { WalkInMemberLookupResponse } from '@lucy-spa/contracts';
import { Field, FormDialog, FormGrid, RadioGroup, TextInput } from '@lucy-spa/ui';
import { useState } from 'react';
import { fill } from '../../../i18n/workforce';
import { boardErrorMessage } from '../../../lib/workforce/booking-board';
import { formOverlayLabels } from '../../../lib/workforce/form-labels';
import { useWorkforce } from '../session';
import { Notice } from '../ui';
import { focusFirstInvalid } from './pos-dom';
import { metaLine } from './pos-format';

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
  const { api, t, locale } = useWorkforce();
  const [lookupBy, setLookupBy] = useState<'phone' | 'email'>('phone');
  const [value, setValue] = useState('');
  // An empty search is said on the field itself, which takes focus (wig Forms: errors inline, baseline :44).
  const [needValue, setNeedValue] = useState(false);
  const [lookup, setLookup] = useState<WalkInMemberLookupResponse | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const member = lookup?.members[0] ?? null;

  // The button stays enabled until a request starts; what blocks it is said in the dialog (wig :72, :44).
  async function submit() {
    if (member) {
      if (taken.has(member.id)) {
        setError(t.walkIn.alreadyAdded);
        return;
      }
      onAdd(member);
      onClose();
      return;
    }
    if (searching) return;
    if (!value.trim()) {
      setNeedValue(true);
      focusFirstInvalid();
      return;
    }
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
      error={error ? <Notice tone="error">{error}</Notice> : undefined}
      onClose={onClose}
      onSubmit={submit}
    >
      <FormGrid>
        {/* Two choices are a toggle, not a pop-up menu (C47). */}
        <RadioGroup
          legend={t.walkIn.lookupBy}
          name="walk-in-lookup-by"
          layout="inline"
          value={lookupBy}
          options={[
            { value: 'phone', label: t.walkIn.phone },
            { value: 'email', label: t.walkIn.email },
          ]}
          onValueChange={(next) => (setLookupBy(next as 'phone' | 'email'), setLookup(null))}
        />
        <Field
          label={lookupBy === 'phone' ? t.walkIn.phone : t.walkIn.email}
          error={needValue ? t.pos.lookupNeedValue : undefined}
        >
          {(control) => (
            <TextInput
              {...control}
              type={lookupBy === 'phone' ? 'tel' : 'email'}
              inputMode={lookupBy === 'phone' ? 'tel' : 'email'}
              autoComplete="off"
              // An email or a phone number is not prose (wig Forms, baseline :96).
              spellCheck={false}
              maxLength={lookupBy === 'phone' ? 32 : 320}
              value={value}
              onChange={(event) => (
                setValue(event.target.value),
                setLookup(null),
                setNeedValue(false)
              )}
            />
          )}
        </Field>
        {member ? (
          <Notice tone="success">
            {/* One Intl list ("Lan, 09xx…12, l…@gmail.com"), not commas glued in code. */}
            {metaLine(locale, [
              fill(t.walkIn.found, { name: member.displayName }),
              member.phoneMasked,
              member.emailMasked,
            ])}
          </Notice>
        ) : null}
        {lookup && lookup.members.length === 0 ? (
          <Notice tone="info">{t.walkIn.notFound}</Notice>
        ) : null}
      </FormGrid>
    </FormDialog>
  );
}
