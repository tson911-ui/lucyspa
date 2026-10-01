'use client';

import type {
  OperationalActiveVisit,
  OperationalActiveVisitLine,
  OperationalBooking,
  OperationalWaitingEntry,
  WalkInOptionsResponse,
} from '@lucy-spa/contracts';
import {
  ConfirmDialog,
  type ConfirmError,
  Field,
  FormDialog,
  FormGrid,
  RadioGroup,
  Select,
  Textarea,
  TextInput,
} from '@lucy-spa/ui';
import { useState } from 'react';
import { fill } from '../../../i18n/workforce';
import { ApiError } from '../../../lib/workforce/api';
import { boardErrorMessage } from '../../../lib/workforce/booking-board';
import { formOverlayLabels } from '../../../lib/workforce/form-labels';
import {
  elapsedMinutes,
  reasonBody,
  resolveEndBody,
  type ResolveEndMode,
} from '../../../lib/workforce/visit-completion';
import { useWorkforce } from '../session';
import { Notice } from '../ui';

/** The commands that a `ConfirmDialog` carries: a reason where one is recorded, never free-form facts. */
export type BoardCommand =
  | { kind: 'arrive'; booking: OperationalBooking }
  | { kind: 'noShow'; booking: OperationalBooking }
  | { kind: 'advance'; visitId: string; code: string }
  | { kind: 'cancelWalkIn'; visitId: string; code: string }
  | { kind: 'cancelLine'; visit: OperationalActiveVisit; line: OperationalActiveVisitLine };

/** The refusal a dialog shows: the board texts, and the request reference for support. */
const describe =
  (t: ReturnType<typeof useWorkforce>['t']) =>
  (failure: unknown): ConfirmError => ({
    message: boardErrorMessage(failure, t),
    reference: failure instanceof ApiError ? failure.requestId : null,
  });

/**
 * Arrival, no-show, priority, cancelling a waiting walk-in and cancelling an unstarted service. Nothing is
 * sent until the confirm button; the dialog stays open (with the reason) when the API refuses.
 */
export function BoardConfirm({
  command,
  serviceName,
  onRun,
  onClose,
}: {
  command: BoardCommand;
  serviceName: (line: OperationalActiveVisitLine) => string;
  onRun: (command: BoardCommand, reason: string) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useWorkforce();
  const b = t.bookingBoard;
  const copy =
    command.kind === 'arrive'
      ? {
          label: b.arrive,
          body: fill(b.arriveConfirm, {
            name: command.booking.owner.displayName,
            code: command.booking.code,
          }),
          tone: 'neutral' as const,
          reason: false,
        }
      : command.kind === 'noShow'
        ? {
            label: b.noShow,
            body: fill(b.noShowIntro, { code: command.booking.code }),
            tone: 'danger' as const,
            reason: true,
          }
        : command.kind === 'cancelWalkIn'
          ? {
              label: b.cancelWalkIn,
              body: fill(b.cancelWalkInIntro, { code: command.code }),
              tone: 'danger' as const,
              reason: true,
            }
          : command.kind === 'cancelLine'
            ? {
                label: b.cancelLine,
                body: fill(b.cancelLineIntro, { service: serviceName(command.line) }),
                tone: 'danger' as const,
                reason: true,
              }
            : {
                label: b.advance,
                body: fill(b.advanceIntro, { code: command.code }),
                tone: 'neutral' as const,
                reason: true,
              };
  return (
    <ConfirmDialog
      title={copy.label}
      description={copy.body}
      tone={copy.tone}
      confirmLabel={copy.label}
      busyLabel={b.working}
      cancelLabel={t.common.cancel}
      referenceLabel={t.errors.reference}
      {...(copy.reason
        ? {
            reasonField: {
              label: b.reasonLabel,
              required: true,
              requiredLabel: t.common.required,
              requiredMessage: b.needReason,
            },
          }
        : {})}
      describeError={describe(t)}
      onCancel={onClose}
      onConfirm={async (reason) => {
        await onRun(command, reason ?? '');
        onClose();
      }}
    />
  );
}

/** A forgotten END: a reason and one of the constrained end times (never a free timestamp editor). */
export function ResolveEndDialog({
  visit,
  line,
  serviceName,
  now,
  time,
  working,
  error,
  onResolve,
  onClose,
}: {
  visit: OperationalActiveVisit;
  line: OperationalActiveVisitLine;
  serviceName: string;
  now: string;
  time: (iso: string) => string;
  working: boolean;
  error: string | null;
  onResolve: (
    lineId: string,
    body: NonNullable<ReturnType<typeof resolveEndBody>>,
  ) => Promise<boolean>;
  onClose: () => void;
}) {
  const { t } = useWorkforce();
  const b = t.bookingBoard;
  const execution = line.execution;
  const [reason, setReason] = useState('');
  const [mode, setMode] = useState<ResolveEndMode>('NOW');
  const [minutes, setMinutes] = useState('');
  const [problem, setProblem] = useState<'reason' | 'minutes' | null>(null);
  if (!execution) return null;
  const expectedPassed = Date.parse(execution.expectedEndAt) <= Date.parse(now);
  const max = elapsedMinutes(execution.startedAt, now);

  async function save() {
    if (!execution) return;
    if (!reasonBody(reason)) return setProblem('reason');
    const body = resolveEndBody({
      reason,
      mode,
      minutes,
      startedAt: execution.startedAt,
      expectedEndAt: execution.expectedEndAt,
      now,
    });
    if (!body) return setProblem('minutes');
    setProblem(null);
    if (await onResolve(line.id, body)) onClose();
  }

  return (
    <FormDialog
      title={b.resolveEnd}
      description={fill(b.resolveEndIntro, {
        service: serviceName,
        staff: line.employee?.displayName ?? '',
      })}
      labels={formOverlayLabels(t, b.confirm)}
      busy={working}
      dirty={reason !== '' || mode !== 'NOW'}
      error={error ? <Notice tone="error">{error}</Notice> : undefined}
      onClose={onClose}
      onSubmit={save}
    >
      <FormGrid>
        <RadioGroup
          legend={b.resolveMode}
          name={`resolve-mode-${visit.id}-${line.id}`}
          value={mode}
          onValueChange={(value) => setMode(value as ResolveEndMode)}
          options={[
            { value: 'NOW', label: b.resolveModeNow },
            ...(expectedPassed
              ? [
                  {
                    value: 'EXPECTED',
                    label: fill(b.resolveModeExpected, { time: time(execution.expectedEndAt) }),
                  },
                ]
              : []),
            { value: 'MINUTES', label: b.resolveModeMinutes },
          ]}
        />
        {mode === 'MINUTES' ? (
          <Field
            label={fill(b.resolveMinutes, { max: String(max) })}
            required
            requiredLabel={t.common.required}
            {...(problem === 'minutes' ? { error: b.resolveMinutesInvalid } : {})}
          >
            {(control) => (
              <TextInput
                {...control}
                className="ls-input-number"
                inputMode="numeric"
                autoComplete="off"
                maxLength={5}
                value={minutes}
                onChange={(event) => setMinutes(event.target.value)}
              />
            )}
          </Field>
        ) : null}
        <Field
          label={b.reasonLabel}
          required
          requiredLabel={t.common.required}
          {...(problem === 'reason' ? { error: b.needReason } : {})}
        >
          {(control) => (
            <Textarea
              {...control}
              rows={3}
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          )}
        </Field>
      </FormGrid>
    </FormDialog>
  );
}

/**
 * Change who a waiting walk-in asked for (allowed until the service is assigned). One select per waiting
 * service; only the services whose choice changed are sent, each exactly as the inline control sent it.
 */
export function IntentDialog({
  entry,
  options,
  working,
  error,
  onSave,
  onClose,
}: {
  entry: OperationalWaitingEntry;
  options: WalkInOptionsResponse;
  working: boolean;
  error: string | null;
  onSave: (changes: { lineId: string; requested: string }[]) => Promise<boolean>;
  onClose: () => void;
}) {
  const { t, locale } = useWorkforce();
  const current = (line: OperationalWaitingEntry['lines'][number]) =>
    line.requestedEmployee?.id ?? 'ANY';
  const [choice, setChoice] = useState<Record<string, string>>({});
  const changes = entry.lines
    .filter((line) => (choice[line.id] ?? current(line)) !== current(line))
    .map((line) => ({ lineId: line.id, requested: choice[line.id] as string }));

  return (
    <FormDialog
      title={t.bookingBoard.changeStaff}
      description={`${entry.participantName} · ${entry.visitCode}`}
      labels={{ ...formOverlayLabels(t, t.bookingBoard.save), submitting: t.common.saving }}
      busy={working}
      dirty={changes.length > 0}
      submitDisabled={changes.length === 0}
      error={error ? <Notice tone="error">{error}</Notice> : undefined}
      onClose={onClose}
      onSubmit={async () => {
        if (await onSave(changes)) onClose();
      }}
    >
      <FormGrid>
        {entry.lines.map((line) => {
          const staff =
            options.services.find((service) => service.id === line.serviceId)?.employees ?? [];
          return (
            <Field
              key={line.id}
              label={`${locale === 'vi' ? line.serviceNameVi : line.serviceNameEn} · ${line.durationMinutes}′`}
            >
              {(control) => (
                <Select
                  {...control}
                  value={choice[line.id] ?? current(line)}
                  options={[
                    { value: 'ANY', label: t.walkIn.anyStaff },
                    ...staff.map((employee) => ({
                      value: employee.id,
                      label: `${employee.displayName}${employee.checkedIn ? '' : ` ${t.walkIn.notCheckedIn}`}`,
                    })),
                  ]}
                  onChange={(event) =>
                    setChoice((values) => ({ ...values, [line.id]: event.target.value }))
                  }
                />
              )}
            </Field>
          );
        })}
      </FormGrid>
    </FormDialog>
  );
}
