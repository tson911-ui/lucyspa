'use client';

import { useMemo, useRef, useState } from 'react';
import { Button } from './button';
import {
  createConfirmController,
  idleConfirm,
  typingMatches,
  type ConfirmController,
  type ConfirmState,
} from './confirm-core';
import { ErrorState } from './feedback';
import { Field, Textarea, TextInput } from './form';
import { Dialog } from './overlay';

export interface ConfirmFact {
  label: string;
  value: string;
}

export interface ConfirmError {
  message: string;
  /** Request reference shown to the user for support. */
  reference?: string | null | undefined;
}

/**
 * Confirmation for consequential actions (contract section 11). Nothing is sent until the confirm
 * button is pressed; Cancel, Escape and the backdrop close with no request; focus starts on Cancel;
 * while busy the dialog cannot be dismissed; a refusal keeps the dialog and the record and explains
 * why. Copy pattern: title "Delete service?", body says what happens, button "Delete service".
 */
export function ConfirmDialog({
  open = true,
  title,
  description,
  facts,
  tone = 'danger',
  confirmLabel,
  busyLabel,
  cancelLabel,
  reasonField,
  requireTyping,
  referenceLabel,
  describeError,
  onConfirm,
  onCancel,
}: {
  /** Defaults to `true` so the dialog can simply be mounted while needed. */
  open?: boolean | undefined;
  title: string;
  description: string;
  /** Name/code of the affected record. */
  facts?: readonly ConfirmFact[] | undefined;
  tone?: 'danger' | 'warning' | 'neutral' | undefined;
  /** Verb + object, never "OK" or "Yes". */
  confirmLabel: string;
  /** Confirm button text while the request runs; defaults to `confirmLabel`. */
  busyLabel?: string | undefined;
  cancelLabel: string;
  /** A written reason, for cancellations that need one. */
  reasonField?: {
    label: string;
    required?: boolean | undefined;
    requiredLabel?: string | undefined;
    requiredMessage?: string | undefined;
    hint?: string | undefined;
  };
  /** Reserved for irreversible actions: the user must type the record code first. */
  requireTyping?: { code: string; label: string };
  referenceLabel?: string | undefined;
  /** Turns whatever `onConfirm` rejected with into text. */
  describeError: (error: unknown) => ConfirmError;
  onConfirm: (reason?: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [state, setState] = useState<ConfirmState>(idleConfirm);
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');
  const [reasonMissing, setReasonMissing] = useState(false);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const reasonRef = useRef<HTMLTextAreaElement | null>(null);
  const latest = useRef({ onConfirm, onCancel });
  latest.current = { onConfirm, onCancel };
  const controller = useMemo<ConfirmController>(
    () =>
      createConfirmController({
        onConfirm: (value) => latest.current.onConfirm(value),
        onCancel: () => latest.current.onCancel(),
        onChange: setState,
      }),
    [],
  );

  const failure = state.error ? describeError(state.error) : null;
  const typingBlocked = requireTyping ? !typingMatches(typed, requireTyping.code) : false;
  const confirmTone = tone === 'danger' ? 'danger' : 'primary';

  function submit() {
    if (reasonField?.required && reason.trim() === '') {
      setReasonMissing(true);
      reasonRef.current?.focus();
      return;
    }
    setReasonMissing(false);
    void controller.confirm(reasonField ? reason.trim() : undefined);
  }

  return (
    <Dialog
      open={open}
      role="alertdialog"
      size="sm"
      title={title}
      description={description}
      busy={state.pending}
      onClose={() => controller.cancel()}
      initialFocus={cancelRef}
      footer={
        <>
          <Button
            ref={cancelRef}
            variant="secondary"
            onClick={() => controller.cancel()}
            disabled={state.pending}
          >
            {cancelLabel}
          </Button>
          <Button
            variant={confirmTone}
            loading={state.pending}
            disabled={typingBlocked}
            onClick={submit}
          >
            {state.pending && busyLabel ? busyLabel : confirmLabel}
          </Button>
        </>
      }
    >
      {facts && facts.length > 0 ? (
        <dl className="ls-facts">
          {facts.map((fact) => (
            <div key={fact.label} className="ls-facts-row">
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {reasonField ? (
        <Field
          label={reasonField.label}
          required={reasonField.required}
          requiredLabel={reasonField.requiredLabel}
          hint={reasonField.hint}
          error={reasonMissing ? reasonField.requiredMessage : undefined}
        >
          {(control) => (
            <Textarea
              {...control}
              ref={reasonRef}
              rows={3}
              value={reason}
              disabled={state.pending}
              onChange={(event) => setReason(event.target.value)}
            />
          )}
        </Field>
      ) : null}
      {requireTyping ? (
        <Field label={requireTyping.label}>
          {(control) => (
            <TextInput
              {...control}
              value={typed}
              autoComplete="off"
              disabled={state.pending}
              onChange={(event) => setTyped(event.target.value)}
            />
          )}
        </Field>
      ) : null}
      {failure ? (
        <ErrorState
          message={failure.message}
          reference={failure.reference}
          referenceLabel={referenceLabel}
        />
      ) : null}
    </Dialog>
  );
}
