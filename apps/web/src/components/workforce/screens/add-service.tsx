'use client';

import type { AddedServiceLineResponse, WalkInOptionsResponse } from '@lucy-spa/contracts';
import { Field as KitField, FormDialog, FormGrid, Select as KitSelect } from '@lucy-spa/ui';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { fill } from '../../../i18n/workforce';
import {
  addOutcome,
  addServiceBody,
  newAddKey,
  referenceRange,
  type StaffChoice,
} from '../../../lib/workforce/add-service';
import { boardErrorMessage, branchTime } from '../../../lib/workforce/booking-board';
import { formOverlayLabels } from '../../../lib/workforce/form-labels';
import { useAccount, useWorkforce } from '../session';
import { Field, Loading, Notice, SubmitButton } from '../ui';

type Participant = { id: string; name: string | null };

/**
 * Phase 4 Step 3: add ONE catalog service to an open visit, on behalf of the customer. Only a
 * participant, a catalog service and an optional staff intent are chosen: there is no free-form
 * service, price, quantity or time. The API decides authority and eligibility again; this form only
 * loads what the actor may add. The idempotency key stays the same across retries of the same choice.
 */
function useAddService({
  visitId,
  participants,
  onAdded,
}: {
  visitId: string;
  participants: Participant[];
  onAdded: (text: string) => void;
}) {
  const { api, t, locale } = useWorkforce();
  const { account } = useAccount();
  const [options, setOptions] = useState<WalkInOptionsResponse | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [participantId, setParticipantId] = useState(participants[0]?.id ?? '');
  const [serviceId, setServiceId] = useState('');
  const [staff, setStaff] = useState<StaffChoice>('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const key = useRef(newAddKey());

  useEffect(() => {
    let active = true;
    api
      .get<WalkInOptionsResponse>(`/api/v1/operations/visits/${visitId}/add-service-options`)
      .then((result) => {
        if (active) setOptions(result);
      })
      .catch((cause: unknown) => {
        if (active) setLoadError(cause);
      });
    return () => {
      active = false;
    };
  }, [api, visitId]);

  const chosen = options?.services.find((service) => service.id === serviceId) ?? null;
  const change =
    <T,>(setter: (value: T) => void) =>
    (value: T) => {
      key.current = newAddKey(); // a different choice is a different request
      setter(value);
    };

  /** Resolves true when the service was added, so a dialog can close itself. */
  async function submit(): Promise<boolean> {
    const body = addServiceBody({
      participantId,
      serviceId,
      staff,
      myUserId: account.id,
      idempotencyKey: key.current,
    });
    if (!body || working) return false;
    setWorking(true);
    setError(null);
    try {
      const result = await api.post<AddedServiceLineResponse>(
        `/api/v1/operations/visits/${visitId}/lines`,
        body,
      );
      key.current = newAddKey();
      const zone = options?.branch.timezone ?? 'UTC';
      onAdded(
        addOutcome(result) === 'PLANNED' && result.employee && result.plannedStartAt
          ? fill(t.bookingBoard.lineAddedPlanned, {
              staff: result.employee.displayName,
              time: branchTime(result.plannedStartAt, zone, locale),
            })
          : t.bookingBoard.lineAddedWaiting,
      );
      return true;
    } catch (cause) {
      setError(cause);
      return false;
    } finally {
      setWorking(false);
    }
  }

  return {
    options,
    loadError,
    chosen,
    participantId,
    serviceId,
    staff,
    working,
    error,
    change,
    setParticipantId,
    setServiceId,
    setStaff,
    submit,
  };
}

/** The inline form My services still uses (migrated in Step 10b). */
export function AddServiceForm({
  visitId,
  visitCode,
  participants,
  onCancel,
  onAdded,
}: {
  visitId: string;
  visitCode: string;
  participants: Participant[];
  onCancel: () => void;
  onAdded: (text: string) => void;
}) {
  const { t, locale } = useWorkforce();
  const { account } = useAccount();
  const add = useAddService({ visitId, participants, onAdded });
  const { options, loadError, chosen, participantId, serviceId, staff, working, error, change } =
    add;

  return (
    <form
      className="wf-card wf-form"
      onSubmit={(event: FormEvent) => (event.preventDefault(), void add.submit())}
    >
      <h4>{t.bookingBoard.addService}</h4>
      <p className="wf-small">{fill(t.bookingBoard.addServiceIntro, { code: visitCode })}</p>
      {!options && !loadError ? <Loading t={t} /> : null}
      {loadError ? <Notice tone="error">{boardErrorMessage(loadError, t)}</Notice> : null}
      {options && options.services.length === 0 ? (
        <p className="wf-muted">{t.bookingBoard.addNoServices}</p>
      ) : null}
      {options && options.services.length > 0 ? (
        <>
          <Field id={`add-participant-${visitId}`} label={t.bookingBoard.addParticipant} required>
            <select
              id={`add-participant-${visitId}`}
              value={participantId}
              onChange={(event) => change(add.setParticipantId)(event.target.value)}
            >
              {participants.map((participant) => (
                <option key={participant.id} value={participant.id}>
                  {participant.name ?? t.bookingBoard.self}
                </option>
              ))}
            </select>
          </Field>
          <Field id={`add-service-${visitId}`} label={t.bookingBoard.addServiceField} required>
            <select
              id={`add-service-${visitId}`}
              value={serviceId}
              onChange={(event) => change(add.setServiceId)(event.target.value)}
            >
              <option value="" />
              {options.services.map((service) => (
                <option key={service.id} value={service.id}>
                  {locale === 'vi' ? service.nameVi : service.nameEn}
                </option>
              ))}
            </select>
          </Field>
          {chosen ? (
            <p className="wf-small">
              {fill(t.bookingBoard.addPrice, { range: referenceRange(chosen, locale) })}
            </p>
          ) : null}
          <Field id={`add-staff-${visitId}`} label={t.bookingBoard.addStaff}>
            <select
              id={`add-staff-${visitId}`}
              value={staff}
              onChange={(event) => change(add.setStaff)(event.target.value)}
            >
              <option value="">{t.bookingBoard.addStaffAny}</option>
              <option value="me">{t.bookingBoard.addStaffMe}</option>
              {(chosen?.employees ?? [])
                .filter((employee) => employee.id !== account.id)
                .map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.displayName}
                  </option>
                ))}
            </select>
          </Field>
        </>
      ) : null}
      {error ? <Notice tone="error">{boardErrorMessage(error, t)}</Notice> : null}
      <div className="wf-row-actions">
        <button type="button" className="wf-button" disabled={working} onClick={onCancel}>
          {t.common.cancel}
        </button>
        <SubmitButton
          pending={working}
          label={t.bookingBoard.addSubmit}
          pendingLabel={t.bookingBoard.addWorking}
          disabled={!participantId || !serviceId}
        />
      </div>
    </form>
  );
}

/** The same choices in a `FormDialog` (Booking board, Step 10a): participant, catalog service, optional staff. */
export function AddServiceDialog({
  visitId,
  visitCode,
  participants,
  onClose,
  onAdded,
}: {
  visitId: string;
  visitCode: string;
  participants: Participant[];
  onClose: () => void;
  onAdded: (text: string) => void;
}) {
  const { t, locale } = useWorkforce();
  const { account } = useAccount();
  const add = useAddService({ visitId, participants, onAdded });
  const { options, loadError, chosen, participantId, serviceId, staff, working, error, change } =
    add;
  const ready = Boolean(options && options.services.length > 0);

  return (
    <FormDialog
      title={t.bookingBoard.addService}
      description={fill(t.bookingBoard.addServiceIntro, { code: visitCode })}
      labels={{
        ...formOverlayLabels(t, t.bookingBoard.addSubmit),
        submitting: t.bookingBoard.addWorking,
      }}
      busy={working}
      dirty={serviceId !== ''}
      submitDisabled={!ready || !participantId || !serviceId}
      error={
        loadError || error ? (
          <Notice tone="error">{boardErrorMessage(loadError ?? error, t)}</Notice>
        ) : undefined
      }
      onClose={onClose}
      onSubmit={async () => {
        if (await add.submit()) onClose();
      }}
    >
      {!options && !loadError ? <Loading t={t} /> : null}
      {options && options.services.length === 0 ? (
        <Notice tone="info">{t.bookingBoard.addNoServices}</Notice>
      ) : null}
      {ready && options ? (
        <FormGrid>
          <KitField
            label={t.bookingBoard.addParticipant}
            required
            requiredLabel={t.common.required}
          >
            {(control) => (
              <KitSelect
                {...control}
                value={participantId}
                options={participants.map((participant) => ({
                  value: participant.id,
                  label: participant.name ?? t.bookingBoard.self,
                }))}
                onChange={(event) => change(add.setParticipantId)(event.target.value)}
              />
            )}
          </KitField>
          <KitField
            label={t.bookingBoard.addServiceField}
            required
            requiredLabel={t.common.required}
            {...(chosen
              ? { hint: fill(t.bookingBoard.addPrice, { range: referenceRange(chosen, locale) }) }
              : {})}
          >
            {(control) => (
              <KitSelect
                {...control}
                value={serviceId}
                placeholder="—"
                options={options.services.map((service) => ({
                  value: service.id,
                  label: locale === 'vi' ? service.nameVi : service.nameEn,
                }))}
                onChange={(event) => change(add.setServiceId)(event.target.value)}
              />
            )}
          </KitField>
          <KitField label={t.bookingBoard.addStaff}>
            {(control) => (
              <KitSelect
                {...control}
                value={staff}
                options={[
                  { value: '', label: t.bookingBoard.addStaffAny },
                  { value: 'me', label: t.bookingBoard.addStaffMe },
                  ...(chosen?.employees ?? [])
                    .filter((employee) => employee.id !== account.id)
                    .map((employee) => ({ value: employee.id, label: employee.displayName })),
                ]}
                onChange={(event) => change(add.setStaff)(event.target.value)}
              />
            )}
          </KitField>
        </FormGrid>
      ) : null}
    </FormDialog>
  );
}
