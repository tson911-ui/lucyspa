'use client';

import type {
  ReassignmentLine,
  ReassignmentScope,
  ReplacementOptionsResponse,
} from '@lucy-spa/contracts';
import { useState } from 'react';
import {
  CheckField,
  DescriptionList,
  Field,
  FormDialog,
  FormGrid,
  RadioGroup,
  Select,
  Textarea,
} from '@lucy-spa/ui';
import { formOverlayLabels } from '../../../lib/workforce/form-labels';
import { reassignmentBody } from '../../../lib/workforce/reassignment';
import { useWorkforce } from '../session';
import { Loading, Notice } from '../ui';
import { metaLine } from './pos-format';
import { focusFirstInvalid } from './pos-dom';

/**
 * Choose the replacement for one affected service (or all of the customer's unstarted services with the same
 * staff). The screen owns the option loading and the request; this dialog shows the choices and, on a refused submit,
 * marks what `reassignmentBody` still needs (versions come from the displayed options).
 */
export function ReassignmentDialog({
  anchor,
  scope,
  options,
  loading,
  replacement,
  reason,
  acknowledged,
  saving,
  error,
  serviceName,
  timestamp,
  onScope,
  onReplacement,
  onReason,
  onAcknowledged,
  onSubmit,
  onClose,
}: {
  anchor: ReassignmentLine;
  scope: ReassignmentScope;
  options: ReplacementOptionsResponse | null;
  loading: boolean;
  replacement: string;
  reason: string;
  acknowledged: boolean;
  saving: boolean;
  error: string | null;
  serviceName: (line: ReassignmentLine) => string;
  timestamp: (iso: string) => string;
  onScope: (scope: ReassignmentScope) => void;
  onReplacement: (value: string) => void;
  onReason: (value: string) => void;
  onAcknowledged: (value: boolean) => void;
  onSubmit: () => Promise<void>;
  onClose: () => void;
}) {
  const { t, locale } = useWorkforce();
  const r = t.reassignment;
  // The confirm button stays enabled until the request starts (wig :74); a refused submit marks each missing piece inline and
  // moves focus to the first one.
  const [checked, setChecked] = useState(false);
  const note = reason.normalize('NFC').trim();
  const missing = {
    replacement: !options?.candidates.some((candidate) => candidate.id === replacement),
    reason: [...note].length < 3 || [...note].length > 500 || !/[\p{L}\p{N}]/u.test(note),
    acknowledge: Boolean(options?.requiresSpecificAcknowledgement) && !acknowledged,
  };
  return (
    <FormDialog
      title={r.dialogTitle}
      description={metaLine(locale, [anchor.parentCode, serviceName(anchor)])}
      size="lg"
      labels={{ ...formOverlayLabels(t, r.confirm), submitting: r.saving }}
      busy={saving}
      dirty={replacement !== '' || reason !== '' || acknowledged}
      submitDisabled={!options}
      error={error ? <Notice tone="error">{error}</Notice> : undefined}
      onClose={onClose}
      onSubmit={async () => {
        if (!reassignmentBody(options, replacement, reason, acknowledged)) {
          setChecked(true);
          focusFirstInvalid();
          return;
        }
        await onSubmit();
      }}
    >
      <FormGrid>
        {/* Two choices are a toggle, not a pop-up menu (C47). */}
        <RadioGroup
          legend={r.scope}
          name="reassignment-scope"
          layout="inline"
          value={scope}
          options={[
            { value: 'PARTICIPANT', label: r.participant, disabled: saving },
            { value: 'LINE', label: r.line, disabled: saving },
          ]}
          onValueChange={(next) => onScope(next as ReassignmentScope)}
        />
        {loading ? <Loading t={t} /> : null}
        {options ? (
          <>
            <DescriptionList
              items={[
                {
                  label: r.affected,
                  value: (
                    <ul className="ls-list-plain">
                      {options.lines.map((line) => (
                        <li key={line.id}>
                          {metaLine(locale, [
                            serviceName(line),
                            timestamp(line.plannedStartAt),
                            line.employee.displayName,
                            line.assignmentMode === 'SPECIFIC' ? r.specific : r.any,
                          ])}
                        </li>
                      ))}
                    </ul>
                  ),
                },
              ]}
            />
            {options.candidates.length === 0 ? <Notice tone="warning">{r.none}</Notice> : null}
            <Field
              label={r.replacement}
              required
              requiredLabel={t.common.required}
              {...(checked && missing.replacement ? { error: r.needReplacement } : {})}
            >
              {(control) => (
                <Select
                  {...control}
                  value={replacement}
                  disabled={saving}
                  placeholder={r.choose}
                  options={options.candidates.map((candidate) => ({
                    value: candidate.id,
                    label: candidate.preferred
                      ? metaLine(locale, [candidate.displayName, r.preferred])
                      : candidate.displayName,
                  }))}
                  onChange={(event) => onReplacement(event.target.value)}
                />
              )}
            </Field>
            <Field
              label={r.reason}
              hint={r.reasonHint}
              required
              requiredLabel={t.common.required}
              {...(checked && missing.reason ? { error: r.needReason } : {})}
            >
              {(control) => (
                <Textarea
                  {...control}
                  rows={3}
                  value={reason}
                  disabled={saving}
                  maxLength={1000}
                  onChange={(event) => onReason(event.target.value)}
                />
              )}
            </Field>
            {options.requiresSpecificAcknowledgement ? (
              // A missing acknowledgement is said at the box itself, which takes focus like the other fields (wig Forms: errors
              // inline, not in a notice at the top of the dialog).
              <CheckField
                checked={acknowledged}
                disabled={saving}
                label={r.acknowledge}
                invalid={checked && missing.acknowledge}
                hint={checked && missing.acknowledge ? r.needAcknowledge : undefined}
                onChange={(event) => onAcknowledged(event.target.checked)}
              />
            ) : null}
          </>
        ) : null}
      </FormGrid>
    </FormDialog>
  );
}
