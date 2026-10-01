'use client';

import type {
  ReassignmentLine,
  ReassignmentScope,
  ReplacementOptionsResponse,
} from '@lucy-spa/contracts';
import {
  CheckField,
  DescriptionList,
  Field,
  FormDialog,
  FormGrid,
  Select,
  Textarea,
} from '@lucy-spa/ui';
import { formOverlayLabels } from '../../../lib/workforce/form-labels';
import { reassignmentBody } from '../../../lib/workforce/reassignment';
import { useWorkforce } from '../session';
import { Loading, Notice } from '../ui';

/**
 * Choose the replacement for one affected service (or all of the customer's unstarted services with the same
 * staff). The screen owns the option loading and the request; this dialog only shows the choices and keeps the
 * confirm button disabled until `reassignmentBody` accepts them (versions come from the displayed options).
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
  const { t } = useWorkforce();
  const r = t.reassignment;
  return (
    <FormDialog
      title={r.dialogTitle}
      description={`${anchor.parentCode} · ${serviceName(anchor)}`}
      size="lg"
      labels={{ ...formOverlayLabels(t, r.confirm), submitting: r.saving }}
      busy={saving}
      dirty={replacement !== '' || reason !== '' || acknowledged}
      submitDisabled={!reassignmentBody(options, replacement, reason, acknowledged)}
      error={error ? <Notice tone="error">{error}</Notice> : undefined}
      onClose={onClose}
      onSubmit={onSubmit}
    >
      <FormGrid>
        <Field label={r.scope}>
          {(control) => (
            <Select
              {...control}
              value={scope}
              disabled={saving}
              options={[
                { value: 'PARTICIPANT', label: r.participant },
                { value: 'LINE', label: r.line },
              ]}
              onChange={(event) => onScope(event.target.value as ReassignmentScope)}
            />
          )}
        </Field>
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
                          {serviceName(line)} · {timestamp(line.plannedStartAt)} ·{' '}
                          {line.employee.displayName} ·{' '}
                          {line.assignmentMode === 'SPECIFIC' ? r.specific : r.any}
                        </li>
                      ))}
                    </ul>
                  ),
                },
              ]}
            />
            {options.candidates.length === 0 ? <Notice tone="warning">{r.none}</Notice> : null}
            <Field label={r.replacement} required requiredLabel={t.common.required}>
              {(control) => (
                <Select
                  {...control}
                  value={replacement}
                  disabled={saving}
                  placeholder={r.choose}
                  options={options.candidates.map((candidate) => ({
                    value: candidate.id,
                    label: `${candidate.displayName}${candidate.preferred ? ` · ${r.preferred}` : ''}`,
                  }))}
                  onChange={(event) => onReplacement(event.target.value)}
                />
              )}
            </Field>
            <Field label={r.reason} hint={r.reasonHint} required requiredLabel={t.common.required}>
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
              <CheckField
                checked={acknowledged}
                disabled={saving}
                label={r.acknowledge}
                onChange={(event) => onAcknowledged(event.target.checked)}
              />
            ) : null}
          </>
        ) : null}
      </FormGrid>
    </FormDialog>
  );
}
