'use client';

import { useEffect, useId, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Button } from './button';
import { ConfirmDialog } from './confirm-dialog';
import { cx } from './cx';
import { focusFirstInvalid } from './form';
import { Dialog, Drawer, type DialogSize } from './overlay';
import { PHONE_QUERY, useMediaQuery } from './use-media-query';

// Create/edit containers (docs/UXUI_REDESIGN_DESIGN.md 21.4 FR9): a short form is a `FormDialog`, a
// medium form a `FormDrawer`. Title = the action, footer = Cancel then Save (primary last), busy
// state, error summary on top with focus on the first invalid field, and a discard guard when the
// form is dirty. Render the component only while it is needed (or keep the field state in a child)
// so the form resets on close.

export interface FormOverlayLabels {
  /** Accessible name of the header close button. */
  close: string;
  cancel: string;
  /** Primary button text, for example "Create skill". */
  submit: string;
  /** Primary button text while the request runs; defaults to `submit`. */
  submitting?: string | undefined;
  discardTitle: string;
  discardBody: string;
  discardConfirm: string;
  discardKeep: string;
}

interface FormOverlayProps {
  open?: boolean | undefined;
  title: string;
  onClose: () => void;
  /** Called on submit after the browser's own validation passed. */
  onSubmit: () => void | Promise<void>;
  /** The request is running: nothing can be dismissed and Save shows a spinner. */
  busy?: boolean | undefined;
  /** Unsaved input: closing asks before discarding. */
  dirty?: boolean | undefined;
  /** Error summary, drawn above the fields; focus moves to the first invalid field when it appears. */
  error?: ReactNode | undefined;
  submitDisabled?: boolean | undefined;
  labels: FormOverlayLabels;
  children: ReactNode;
}

const FIELD =
  'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])';

/** Shared behaviour: submit wiring, first-field focus, error focus and the discard guard. */
function useFormOverlay({
  dirty,
  busy,
  error,
  onClose,
  onSubmit,
  labels,
}: Pick<FormOverlayProps, 'onClose' | 'onSubmit' | 'labels'> & {
  dirty: boolean;
  busy: boolean;
  error: ReactNode;
}) {
  const formId = useId();
  const formRef = useRef<HTMLFormElement | null>(null);
  const [asking, setAsking] = useState(false);

  // Dialog reads `.current` once when it opens, after the form is mounted: the first field gets focus.
  const initialFocus = useMemo<RefObject<HTMLElement | null>>(
    () => ({
      get current() {
        return formRef.current?.querySelector<HTMLElement>(FIELD) ?? null;
      },
      set current(_value) {
        // read-only view of the form's first field
      },
    }),
    [],
  );

  useEffect(() => {
    if (error && formRef.current) focusFirstInvalid(formRef.current);
  }, [error]);

  function requestClose() {
    if (busy) return;
    if (dirty) setAsking(true);
    else onClose();
  }

  const guard = asking ? (
    <ConfirmDialog
      title={labels.discardTitle}
      description={labels.discardBody}
      tone="warning"
      confirmLabel={labels.discardConfirm}
      cancelLabel={labels.discardKeep}
      describeError={() => ({ message: '' })}
      onConfirm={async () => {
        setAsking(false);
        onClose();
      }}
      onCancel={() => setAsking(false)}
    />
  ) : null;

  const form = (children: ReactNode) => (
    <form
      id={formId}
      ref={formRef}
      className="ls-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy) void onSubmit();
      }}
    >
      {error ? <div className="ls-form-error">{error}</div> : null}
      {children}
    </form>
  );

  return { formId, initialFocus, requestClose, guard, form };
}

function FooterButtons({
  formId,
  labels,
  busy,
  disabled,
  onCancel,
}: {
  formId: string;
  labels: FormOverlayLabels;
  busy: boolean;
  disabled: boolean;
  onCancel: () => void;
}) {
  return (
    <>
      <Button variant="secondary" onClick={onCancel} disabled={busy}>
        {labels.cancel}
      </Button>
      <Button type="submit" form={formId} variant="primary" loading={busy} disabled={disabled}>
        {busy ? (labels.submitting ?? labels.submit) : labels.submit}
      </Button>
    </>
  );
}

/** Short form (up to about 5 fields, no sub-lists). A bottom sheet on a phone. */
export function FormDialog({
  open = true,
  title,
  description,
  size = 'md',
  onClose,
  onSubmit,
  busy = false,
  dirty = false,
  error,
  submitDisabled = false,
  labels,
  children,
}: FormOverlayProps & { description?: string | undefined; size?: DialogSize | undefined }) {
  const { formId, initialFocus, requestClose, guard, form } = useFormOverlay({
    dirty,
    busy,
    error,
    onClose,
    onSubmit,
    labels,
  });
  return (
    <>
      <Dialog
        open={open}
        title={title}
        description={description}
        size={size}
        busy={busy}
        closeLabel={labels.close}
        initialFocus={initialFocus}
        onClose={requestClose}
        footer={
          <FooterButtons
            formId={formId}
            labels={labels}
            busy={busy}
            disabled={submitDisabled}
            onCancel={requestClose}
          />
        }
      >
        {form(children)}
      </Dialog>
      {guard}
    </>
  );
}

/** Medium form (about 6-12 fields or one small sub-list). A bottom sheet on a phone. */
export function FormDrawer({
  open = true,
  title,
  onClose,
  onSubmit,
  busy = false,
  dirty = false,
  error,
  submitDisabled = false,
  labels,
  className,
  children,
}: FormOverlayProps & { className?: string | undefined }) {
  const phone = useMediaQuery(PHONE_QUERY);
  const { formId, initialFocus, requestClose, guard, form } = useFormOverlay({
    dirty,
    busy,
    error,
    onClose,
    onSubmit,
    labels,
  });
  return (
    <>
      <Drawer
        open={open}
        title={title}
        side={phone ? 'bottom' : 'end'}
        busy={busy}
        closeLabel={labels.close}
        initialFocus={initialFocus}
        onClose={requestClose}
        className={cx('ls-drawer-form', className)}
        footer={
          <FooterButtons
            formId={formId}
            labels={labels}
            busy={busy}
            disabled={submitDisabled}
            onCancel={requestClose}
          />
        }
      >
        {form(children)}
      </Drawer>
      {guard}
    </>
  );
}
