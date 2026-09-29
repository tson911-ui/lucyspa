'use client';

import type { AddedServiceLineResponse, WalkInOptionsResponse } from '@lucy-spa/contracts';
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
import { useAccount, useWorkforce } from '../session';
import { Field, Loading, Notice, SubmitButton } from '../ui';

/**
 * Phase 4 Step 3: add ONE catalog service to an open visit, on behalf of the customer. Only a
 * participant, a catalog service and an optional staff intent are chosen: there is no free-form
 * service, price, quantity or time. The API decides authority and eligibility again; this form only
 * loads what the actor may add. The idempotency key stays the same across retries of the same choice.
 */
export function AddServiceForm({
  visitId,
  visitCode,
  participants,
  onCancel,
  onAdded,
}: {
  visitId: string;
  visitCode: string;
  participants: { id: string; name: string | null }[];
  onCancel: () => void;
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

  async function submit(event: FormEvent) {
    event.preventDefault();
    const body = addServiceBody({
      participantId,
      serviceId,
      staff,
      myUserId: account.id,
      idempotencyKey: key.current,
    });
    if (!body || working) return;
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
    } catch (cause) {
      setError(cause);
    } finally {
      setWorking(false);
    }
  }

  return (
    <form className="wf-card wf-form" onSubmit={(event) => void submit(event)}>
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
              onChange={(event) => change(setParticipantId)(event.target.value)}
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
              onChange={(event) => change(setServiceId)(event.target.value)}
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
              onChange={(event) => change(setStaff)(event.target.value)}
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
