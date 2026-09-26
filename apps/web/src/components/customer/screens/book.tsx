'use client';

import type {
  BookingRecipientRelationName,
  CustomerBookingAvailabilityResponse,
  CustomerBookingBranchesResponse,
  CustomerBookingBranchResponse,
  CustomerBookingDetail,
  CustomerBookingEmployeesResponse,
} from '@lucy-spa/contracts';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { fill } from '../../../i18n/customer';
import { ApiError } from '../../../lib/api/client';
import {
  availabilityQuery,
  createRequest,
  customerErrorMessage,
  emptyDraft,
  formatDateTime,
  formatVndRange,
  moveService,
  peopleProblem,
  RETRY_TIME_CODES,
  SELF,
  toggleService,
  type BookingDraft,
  type Person,
} from '../../../lib/customer/booking';
import { Field, Notice, SubmitButton } from '../../workforce/ui';
import { useCustomer } from '../session';

const STEPS = ['branch', 'services', 'people', 'staff', 'time', 'review'] as const;
type Step = (typeof STEPS)[number];
const OTHER_RELATIONS: Exclude<BookingRecipientRelationName, 'SELF'>[] = [
  'CHILD',
  'FAMILY',
  'OTHER',
];

/** Loads data for a step; `key` changes re-run it. Errors are rendered by the caller. */
function useLoad<T>(load: (() => Promise<T>) | null, key: string) {
  const [state, setState] = useState<{ data: T | null; error: unknown; loading: boolean }>({
    data: null,
    error: null,
    // Something to load: the first paint already says so (no empty flash).
    loading: load !== null,
  });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!load) return;
    let active = true;
    setState({ data: null, error: null, loading: true });
    load()
      .then((data) => active && setState({ data, error: null, loading: false }))
      .catch((error: unknown) => active && setState({ data: null, error, loading: false }));
    return () => {
      active = false;
    };
    // `key` captures every input of `load`.
  }, [key, attempt]);
  return { ...state, retry: () => setAttempt((value) => value + 1) };
}

/**
 * "Đặt lịch": branch → services (ordered) → who each service is for (O11) → KTV per service
 * (specific or Any) → date and a start time the server found feasible → review → submit.
 * The server plans, re-checks under locks and confirms (O4); this screen only collects choices.
 */
export function BookScreen() {
  const { api, t, locale, base } = useCustomer();
  const [step, setStep] = useState<Step>('branch');
  const [draft, setDraft] = useState<BookingDraft>(emptyDraft);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [created, setCreated] = useState<CustomerBookingDetail | null>(null);
  const idempotencyKey = useRef<string>('');
  const heading = useRef<HTMLHeadingElement>(null);

  const branches = useLoad(
    () => api.get<CustomerBookingBranchesResponse>('/api/v1/me/booking/branches'),
    'branches',
  );
  const branch = useLoad(
    draft.branchId
      ? () =>
          api.get<CustomerBookingBranchResponse>(`/api/v1/me/booking/branches/${draft.branchId}`)
      : null,
    `branch:${draft.branchId}`,
  );
  const staffKey = draft.serviceIds.join(',');
  const staff = useLoad(
    draft.branchId && staffKey && (step === 'staff' || step === 'time' || step === 'review')
      ? () =>
          api.get<CustomerBookingEmployeesResponse>(
            `/api/v1/me/booking/branches/${draft.branchId}/employees`,
            { serviceIds: staffKey },
          )
      : null,
    `staff:${draft.branchId}:${staffKey}:${step === 'staff' || step === 'time' || step === 'review'}`,
  );
  const [timesAttempt, setTimesAttempt] = useState(0);
  const times = useLoad(
    step === 'time' && draft.date
      ? () =>
          api.get<CustomerBookingAvailabilityResponse>(
            '/api/v1/me/booking/availability',
            availabilityQuery(draft),
          )
      : null,
    `times:${JSON.stringify(availabilityQuery(draft))}:${step}:${timesAttempt}`,
  );

  const servicesById = useMemo(
    () => new Map((branch.data?.services ?? []).map((service) => [service.id, service])),
    [branch.data],
  );
  const serviceName = (id: string) => {
    const service = servicesById.get(id);
    return service ? (locale === 'vi' ? service.nameVi : service.nameEn) : '';
  };
  const staffName = (index: number) => {
    const choice = draft.staffOf[index];
    if (!choice || choice === 'ANY') return t.book.anyStaff;
    return (
      staff.data?.services[index]?.employees.find((employee) => employee.id === choice)
        ?.displayName ?? ''
    );
  };
  const personLabel = (key: string) => {
    const person = draft.people.find((entry) => entry.key === key);
    if (!person || person.relation === 'SELF') return t.book.self;
    return `${person.name || '—'} (${t.book.relations[person.relation]})`;
  };

  function go(next: Step) {
    setMessage(null);
    setStep(next);
    if (next === 'review') idempotencyKey.current = crypto.randomUUID();
    requestAnimationFrame(() => heading.current?.focus());
  }
  const update = (change: (current: BookingDraft) => BookingDraft) =>
    setDraft((current) => change(current));

  async function confirm(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setMessage(null);
    try {
      // The same key on a retry returns the same booking instead of a duplicate.
      setCreated(
        await api.post<CustomerBookingDetail>(
          '/api/v1/me/bookings',
          createRequest(draft, idempotencyKey.current),
        ),
      );
    } catch (error) {
      const text = customerErrorMessage(error, t);
      if (error instanceof ApiError && RETRY_TIME_CODES.has(error.code)) {
        update((current) => ({ ...current, startTime: '' }));
        setTimesAttempt((value) => value + 1);
        setStep('time');
      }
      setMessage(text);
    } finally {
      setPending(false);
    }
  }

  if (created) {
    return (
      <section className="cu-panel" aria-live="polite">
        <h1 ref={heading} tabIndex={-1}>
          {t.book.successTitle}
        </h1>
        <Notice tone="success">{fill(t.book.successIntro, { code: created.code })}</Notice>
        <p>
          {formatDateTime(created.startsAt, created.branch.timezone, locale)} ·{' '}
          {created.branch.name}
        </p>
        <ul className="cu-lines">
          {created.lines.map((line) => (
            <li key={line.sequence}>
              {locale === 'vi' ? line.serviceNameVi : line.serviceNameEn} —{' '}
              {line.employee.displayName}
            </li>
          ))}
        </ul>
        <div className="cu-actions">
          <Link className="wf-button wf-button-primary" href={`${base}/bookings/${created.id}`}>
            {t.book.viewBooking}
          </Link>
          <button
            type="button"
            className="wf-button"
            onClick={() => {
              setCreated(null);
              setDraft(emptyDraft());
              go('branch');
            }}
          >
            {t.book.bookAnother}
          </button>
        </div>
      </section>
    );
  }

  const index = STEPS.indexOf(step);
  const loadError = (error: unknown, retry: () => void) =>
    error ? (
      <Notice tone="error">
        <p>{customerErrorMessage(error, t)}</p>
        <button type="button" className="wf-button wf-button-quiet" onClick={retry}>
          {t.common.reload}
        </button>
      </Notice>
    ) : null;
  const loading = (
    <p className="wf-muted" role="status">
      {t.common.loading}
    </p>
  );
  const nav = (canContinue: boolean, next?: Step) => (
    <div className="cu-actions">
      {index > 0 ? (
        <button type="button" className="wf-button" onClick={() => go(STEPS[index - 1] as Step)}>
          {t.common.back}
        </button>
      ) : null}
      {next ? (
        <button
          type="button"
          className="wf-button wf-button-primary"
          disabled={!canContinue}
          onClick={() => go(next)}
        >
          {t.common.next}
        </button>
      ) : null}
    </div>
  );

  return (
    <section className="cu-panel">
      <h1 ref={heading} tabIndex={-1}>
        {t.book.title}
      </h1>
      <ol
        className="cu-steps"
        aria-label={fill(t.book.stepOf, { current: index + 1, total: STEPS.length })}
      >
        {STEPS.map((name, position) => (
          <li
            key={name}
            aria-current={name === step ? 'step' : undefined}
            className={position < index ? 'cu-done' : undefined}
          >
            {t.book.steps[name]}
          </li>
        ))}
      </ol>
      <p className="wf-muted">{fill(t.book.stepOf, { current: index + 1, total: STEPS.length })}</p>
      {message ? <Notice tone="error">{message}</Notice> : null}

      {step === 'branch' ? (
        <fieldset className="cu-choices">
          <legend>{t.book.chooseBranch}</legend>
          {branches.loading ? loading : null}
          {loadError(branches.error, branches.retry)}
          {branches.data && branches.data.branches.length === 0 ? (
            <p className="wf-empty">{t.book.noBranches}</p>
          ) : null}
          {branches.data?.branches.map((entry) => (
            <label key={entry.id} className="cu-choice">
              <input
                type="radio"
                name="branch"
                checked={draft.branchId === entry.id}
                onChange={() => setDraft({ ...emptyDraft(), branchId: entry.id })}
              />
              <span>{entry.name}</span>
            </label>
          ))}
          {nav(Boolean(draft.branchId), 'services')}
        </fieldset>
      ) : null}

      {step === 'services' ? (
        <div>
          {branch.loading ? loading : null}
          {loadError(branch.error, branch.retry)}
          {branch.data ? (
            <>
              <fieldset className="cu-choices">
                <legend>{t.book.chooseServices}</legend>
                {branch.data.services.length === 0 ? (
                  <p className="wf-empty">{t.book.noServices}</p>
                ) : null}
                {branch.data.services.map((service) => (
                  <label key={service.id} className="cu-choice">
                    <input
                      type="checkbox"
                      checked={draft.serviceIds.includes(service.id)}
                      onChange={() => update((current) => toggleService(current, service.id))}
                    />
                    <span>
                      <strong>{locale === 'vi' ? service.nameVi : service.nameEn}</strong>
                      <span className="wf-muted">
                        {' '}
                        · {fill(t.book.duration, { minutes: service.durationMinutes })} ·{' '}
                        {t.book.referencePrice}{' '}
                        {formatVndRange(service.priceMinVnd, service.priceMaxVnd, locale)}
                        {service.pricingUnit === 'PER_NAIL' ? ` ${t.book.perNail}` : ''}
                      </span>
                    </span>
                  </label>
                ))}
              </fieldset>
              {draft.serviceIds.length > 1 ? (
                <div className="cu-order">
                  <h2>{t.book.selectedOrder}</h2>
                  <ol>
                    {draft.serviceIds.map((id, position) => (
                      <li key={id}>
                        <span>{serviceName(id)}</span>
                        <span className="cu-inline-actions">
                          <button
                            type="button"
                            className="wf-button wf-button-quiet"
                            disabled={position === 0}
                            aria-label={`${t.book.moveUp}: ${serviceName(id)}`}
                            onClick={() => update((current) => moveService(current, position, -1))}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            className="wf-button wf-button-quiet"
                            disabled={position === draft.serviceIds.length - 1}
                            aria-label={`${t.book.moveDown}: ${serviceName(id)}`}
                            onClick={() => update((current) => moveService(current, position, 1))}
                          >
                            ↓
                          </button>
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
              ) : null}
              <p className="wf-muted">{t.book.priceNote}</p>
            </>
          ) : null}
          {nav(draft.serviceIds.length > 0, 'people')}
        </div>
      ) : null}

      {step === 'people' ? (
        <div>
          <h2>{t.book.whoTitle}</h2>
          <p className="wf-muted">{t.book.whoIntro}</p>
          {draft.people
            .filter((person) => person.relation !== 'SELF')
            .map((person) => (
              <PersonEditor
                key={person.key}
                person={person}
                onChange={(next) =>
                  update((current) => ({
                    ...current,
                    people: current.people.map((entry) => (entry.key === next.key ? next : entry)),
                  }))
                }
                onRemove={() =>
                  update((current) => ({
                    ...current,
                    people: current.people.filter((entry) => entry.key !== person.key),
                    recipientOf: current.recipientOf.map((key) =>
                      key === person.key ? SELF.key : key,
                    ),
                  }))
                }
              />
            ))}
          <button
            type="button"
            className="wf-button"
            disabled={draft.people.length >= 10}
            onClick={() =>
              update((current) => ({
                ...current,
                people: [
                  ...current.people,
                  { key: `p${Date.now().toString(36)}`, relation: 'FAMILY', name: '', phone: '' },
                ],
              }))
            }
          >
            + {t.book.other}
          </button>
          {draft.serviceIds.map((id, position) => (
            <Field key={id} id={`who-${position}`} label={serviceName(id)}>
              <select
                id={`who-${position}`}
                value={draft.recipientOf[position]}
                onChange={(event) =>
                  update((current) => ({
                    ...current,
                    recipientOf: current.recipientOf.map((key, at) =>
                      at === position ? event.target.value : key,
                    ),
                  }))
                }
              >
                {draft.people.map((person) => (
                  <option key={person.key} value={person.key}>
                    {personLabel(person.key)}
                  </option>
                ))}
              </select>
            </Field>
          ))}
          {peopleProblem(draft) ? (
            <Notice tone="warning">{t.book.recipientNameRequired}</Notice>
          ) : null}
          {nav(peopleProblem(draft) === null, 'staff')}
        </div>
      ) : null}

      {step === 'staff' ? (
        <div>
          <h2>{t.book.staffTitle}</h2>
          {staff.loading ? loading : null}
          {loadError(staff.error, staff.retry)}
          {staff.data
            ? draft.serviceIds.map((id, position) => {
                const options = staff.data?.services[position]?.employees ?? [];
                return (
                  <Field key={id} id={`staff-${position}`} label={serviceName(id)}>
                    {options.length === 0 ? (
                      <Notice tone="warning">{t.book.noQualified}</Notice>
                    ) : null}
                    <select
                      id={`staff-${position}`}
                      value={draft.staffOf[position]}
                      disabled={options.length === 0}
                      onChange={(event) =>
                        update((current) => ({
                          ...current,
                          startTime: '',
                          staffOf: current.staffOf.map((value, at) =>
                            at === position ? event.target.value : value,
                          ),
                        }))
                      }
                    >
                      <option value="ANY">{t.book.anyStaff}</option>
                      {options.map((employee) => (
                        <option key={employee.id} value={employee.id}>
                          {employee.displayName}
                        </option>
                      ))}
                    </select>
                  </Field>
                );
              })
            : null}
          {nav(
            Boolean(staff.data) &&
              draft.serviceIds.every(
                (_, position) => (staff.data?.services[position]?.employees.length ?? 0) > 0,
              ),
            'time',
          )}
        </div>
      ) : null}

      {step === 'time' ? (
        <div>
          <Field
            id="date"
            label={t.book.date}
            required
            {...(branch.data
              ? {
                  hint: fill(t.book.dateRange, {
                    first: branch.data.firstDate,
                    last: branch.data.lastDate,
                  }),
                }
              : {})}
          >
            <input
              id="date"
              type="date"
              required
              min={branch.data?.firstDate}
              max={branch.data?.lastDate}
              value={draft.date}
              onChange={(event) =>
                update((current) => ({ ...current, date: event.target.value, startTime: '' }))
              }
            />
          </Field>
          {draft.date ? (
            <fieldset className="cu-times">
              <legend>{t.book.times}</legend>
              {times.loading ? (
                <p className="wf-muted" role="status">
                  {t.book.loadingTimes}
                </p>
              ) : null}
              {loadError(times.error, times.retry)}
              {times.data && times.data.starts.length === 0 ? (
                <p className="wf-empty">{t.book.noTimes}</p>
              ) : null}
              <div className="cu-time-grid">
                {times.data?.starts.map((start) => (
                  <label key={start} className="cu-time">
                    <input
                      type="radio"
                      name="start"
                      checked={draft.startTime === start}
                      onChange={() => update((current) => ({ ...current, startTime: start }))}
                    />
                    <span>{start}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}
          {nav(
            Boolean(draft.date && draft.startTime && times.data?.starts.includes(draft.startTime)),
            'review',
          )}
        </div>
      ) : null}

      {step === 'review' ? (
        <form onSubmit={(event) => void confirm(event)}>
          <h2>{t.book.reviewTitle}</h2>
          <dl className="cu-summary">
            <dt>{t.book.branch}</dt>
            <dd>{branch.data?.branch.name}</dd>
            <dt>{t.book.when}</dt>
            <dd>
              {draft.date} · {draft.startTime}
            </dd>
          </dl>
          <ol className="cu-lines">
            {draft.serviceIds.map((id, position) => (
              <li key={id}>
                <strong>{serviceName(id)}</strong>
                <span className="wf-muted">
                  {' '}
                  · {t.book.for}: {personLabel(draft.recipientOf[position] ?? SELF.key)} ·{' '}
                  {t.book.staff}: {staffName(position)}
                </span>
              </li>
            ))}
          </ol>
          <p className="wf-muted">{t.book.priceNote}</p>
          <div className="cu-actions">
            <button
              type="button"
              className="wf-button"
              disabled={pending}
              onClick={() => go('time')}
            >
              {t.common.back}
            </button>
            <SubmitButton
              pending={pending}
              label={t.book.confirm}
              pendingLabel={t.book.confirming}
            />
          </div>
        </form>
      ) : null}
    </section>
  );
}

function PersonEditor({
  person,
  onChange,
  onRemove,
}: {
  person: Person;
  onChange: (person: Person) => void;
  onRemove: () => void;
}) {
  const { t } = useCustomer();
  return (
    <fieldset className="cu-person">
      <legend>{t.book.other}</legend>
      <Field id={`${person.key}-relation`} label={t.book.relation} required>
        <select
          id={`${person.key}-relation`}
          value={person.relation}
          onChange={(event) =>
            onChange({ ...person, relation: event.target.value as Person['relation'] })
          }
        >
          {OTHER_RELATIONS.map((relation) => (
            <option key={relation} value={relation}>
              {t.book.relations[relation]}
            </option>
          ))}
        </select>
      </Field>
      <Field id={`${person.key}-name`} label={t.book.recipientName} required>
        <input
          id={`${person.key}-name`}
          required
          maxLength={200}
          autoComplete="off"
          value={person.name}
          onChange={(event) => onChange({ ...person, name: event.target.value })}
        />
      </Field>
      <Field id={`${person.key}-phone`} label={`${t.book.recipientPhone} (${t.common.optional})`}>
        <input
          id={`${person.key}-phone`}
          type="tel"
          inputMode="tel"
          maxLength={24}
          autoComplete="off"
          value={person.phone}
          onChange={(event) => onChange({ ...person, phone: event.target.value })}
        />
      </Field>
      <button type="button" className="wf-button wf-button-quiet" onClick={onRemove}>
        {t.book.remove}
      </button>
    </fieldset>
  );
}
