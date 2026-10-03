'use client';

import type {
  BookingRecipientRelationName,
  CustomerBookingAvailabilityResponse,
  CustomerBookingBranchesResponse,
  CustomerBookingBranchResponse,
  CustomerBookingDetail,
  CustomerBookingEmployeesResponse,
} from '@lucy-spa/contracts';
import {
  Button,
  buttonClass,
  Card,
  CardHeader,
  ChoiceCard,
  DateInput,
  DescriptionList,
  Field,
  FormSection,
  IconButton,
  Notice,
  PublicMain,
  Select,
  Skeleton,
  Steps,
  TextInput,
  type DescriptionItem,
} from '@lucy-spa/ui';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
import { formatBusinessDate } from '../../../lib/customer/invoice';
import {
  bookingTotals,
  formatFixedTotal,
  groupByCategory,
  preselectServiceIds,
  serviceCodesFromSearch,
  type BranchService,
} from '../../../lib/customer/booking-view';
import { useCustomer } from '../session';

const STEPS = ['services', 'guests', 'when', 'confirm'] as const;
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

/** What the summary card (desktop) and the action bar (phone) offer: the same two buttons, primary last. */
interface StepNav {
  back: (() => void) | null;
  nextLabel: string;
  canContinue: boolean;
  pending: boolean;
  onNext: () => void;
}

/**
 * "Đặt lịch": four visible steps (services, guests, staff and time, confirm) over the same data and rules as before:
 * the server plans, re-checks under locks and confirms (O4); this screen only collects choices. The services may
 * be preselected from `?service=CODE` (the "Đặt lịch" buttons of the public pages).
 */
export function BookScreen() {
  const { api, t, locale, base, sessionLost } = useCustomer();
  const [step, setStep] = useState<Step>('services');
  const [draft, setDraft] = useState<BookingDraft>(emptyDraft);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [created, setCreated] = useState<CustomerBookingDetail | null>(null);
  const idempotencyKey = useRef<string>('');
  const heading = useRef<HTMLHeadingElement>(null);
  const preselected = useRef(false);

  const branches = useLoad(
    () => api.get<CustomerBookingBranchesResponse>('/api/v1/me/booking/branches'),
    'branches',
  );
  const onlyBranch = branches.data?.branches.length === 1 ? branches.data.branches[0] : undefined;
  useEffect(() => {
    // One active branch: no question to ask.
    if (onlyBranch && !draft.branchId) setDraft({ ...emptyDraft(), branchId: onlyBranch.id });
  }, [onlyBranch?.id]);
  const branch = useLoad(
    draft.branchId
      ? () =>
          api.get<CustomerBookingBranchResponse>(`/api/v1/me/booking/branches/${draft.branchId}`)
      : null,
    `branch:${draft.branchId}`,
  );
  const needsStaff = step === 'when' || step === 'confirm';
  const staffKey = draft.serviceIds.join(',');
  const staff = useLoad(
    draft.branchId && staffKey && needsStaff
      ? () =>
          api.get<CustomerBookingEmployeesResponse>(
            `/api/v1/me/booking/branches/${draft.branchId}/employees`,
            { serviceIds: staffKey },
          )
      : null,
    `staff:${draft.branchId}:${staffKey}:${needsStaff}`,
  );
  const [timesAttempt, setTimesAttempt] = useState(0);
  const times = useLoad(
    step === 'when' && draft.date
      ? () =>
          api.get<CustomerBookingAvailabilityResponse>(
            '/api/v1/me/booking/availability',
            availabilityQuery(draft),
          )
      : null,
    `times:${JSON.stringify(availabilityQuery(draft))}:${step}:${timesAttempt}`,
  );

  const update = (change: (current: BookingDraft) => BookingDraft) =>
    setDraft((current) => change(current));

  // The services named by `?service=` are chosen once, when the branch's services arrive.
  useEffect(() => {
    if (preselected.current || !branch.data) return;
    preselected.current = true;
    const ids = preselectServiceIds(
      serviceCodesFromSearch(window.location.search),
      branch.data.services,
    );
    if (ids.length > 0) {
      update((current) =>
        ids.reduce(
          (next, id) => (next.serviceIds.includes(id) ? next : toggleService(next, id)),
          current,
        ),
      );
    }
  }, [branch.data]);

  const servicesById = useMemo(
    () => new Map((branch.data?.services ?? []).map((service) => [service.id, service])),
    [branch.data],
  );
  const serviceLabel = (service: BranchService) =>
    locale === 'vi' ? service.nameVi : service.nameEn;
  const serviceName = (id: string) => {
    const service = servicesById.get(id);
    return service ? serviceLabel(service) : '';
  };
  const chosen = draft.serviceIds.flatMap((id) => {
    const service = servicesById.get(id);
    return service ? [service] : [];
  });
  const totals = bookingTotals(chosen);
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
  const priceText = (service: BranchService) =>
    `${formatVndRange(service.priceMinVnd, service.priceMaxVnd, locale)}${
      service.pricingUnit === 'PER_NAIL' ? ` ${t.book.perNail}` : ''
    }`;

  function go(next: Step) {
    setMessage(null);
    setStep(next);
    if (next === 'confirm') idempotencyKey.current = crypto.randomUUID();
    requestAnimationFrame(() => heading.current?.focus());
  }

  async function confirm() {
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
        setStep('when');
      }
      setMessage(text);
    } finally {
      setPending(false);
    }
  }

  if (created) {
    return (
      <PublicMain>
        <div className="ls-container ls-container-narrow">
          <div className="ls-public-title" aria-live="polite">
            <h1 ref={heading} tabIndex={-1} className="ls-h1-display">
              {t.book.successTitle}
            </h1>
          </div>
          <div className="ls-booking-main">
            <Card as="section" aria-label={t.book.successTitle}>
              <Notice tone="success">{fill(t.book.successIntro, { code: created.code })}</Notice>
              <DescriptionList
                items={[
                  {
                    label: t.book.when,
                    value: formatDateTime(created.startsAt, created.branch.timezone, locale),
                  },
                  { label: t.book.branch, value: created.branch.name },
                  ...created.lines.map((line) => ({
                    label: locale === 'vi' ? line.serviceNameVi : line.serviceNameEn,
                    value: line.employee.displayName,
                  })),
                ]}
              />
            </Card>
            <div className="ls-member-actions">
              <Button
                variant="secondary"
                onClick={() => {
                  setCreated(null);
                  setDraft(emptyDraft());
                  preselected.current = true;
                  go('services');
                }}
              >
                {t.book.bookAnother}
              </Button>
              <Link className={buttonClass('primary')} href={`${base}/bookings/${created.id}`}>
                {t.book.viewBooking}
              </Link>
            </div>
          </div>
        </div>
      </PublicMain>
    );
  }

  const index = STEPS.indexOf(step);
  const loadError = (error: unknown, retry: () => void) =>
    error ? (
      <Notice tone="danger">
        <p>{customerErrorMessage(error, t)}</p>
        <Button variant="secondary" onClick={retry}>
          {t.common.reload}
        </Button>
      </Notice>
    ) : null;
  const loading = (
    <div role="status">
      <span className="ls-hint">{t.common.loading}</span>
      <Skeleton lines={3} />
    </div>
  );

  const staffReady =
    Boolean(staff.data) &&
    draft.serviceIds.every(
      (_, position) => (staff.data?.services[position]?.employees.length ?? 0) > 0,
    );
  const canContinue =
    step === 'services'
      ? draft.serviceIds.length > 0 && chosen.length === draft.serviceIds.length
      : step === 'guests'
        ? peopleProblem(draft) === null
        : step === 'when'
          ? staffReady &&
            Boolean(draft.date && draft.startTime && times.data?.starts.includes(draft.startTime))
          : true;
  const nav: StepNav = {
    back: index > 0 ? () => go(STEPS[index - 1] as Step) : null,
    nextLabel: step === 'confirm' ? t.book.confirm : t.common.next,
    canContinue,
    pending: step === 'confirm' && pending,
    onNext: () => (step === 'confirm' ? void confirm() : go(STEPS[index + 1] as Step)),
  };

  const fixedTotal = formatFixedTotal(totals, locale);
  const totalLine = fixedTotal ?? (totals.hasPerNail ? t.book.perNailOnly : '—');
  const totalNote = fixedTotal !== null && totals.hasPerNail ? t.book.plusPerNail : null;

  const stepButtons = (
    <>
      {nav.back ? (
        <Button variant="secondary" disabled={pending} onClick={nav.back}>
          {t.common.back}
        </Button>
      ) : null}
      <Button
        variant="primary"
        loading={nav.pending}
        disabled={!nav.canContinue}
        onClick={nav.onNext}
      >
        {nav.pending ? t.book.confirming : nav.nextLabel}
      </Button>
    </>
  );

  return (
    <PublicMain className={totals.count > 0 ? 'ls-main-tall ls-booking-bar' : 'ls-main-tall'}>
      <div className="ls-container">
        <div className="ls-public-title">
          <h1 className="ls-h1-display">{t.book.title}</h1>
        </div>
        <Steps
          label={t.book.stepsLabel}
          current={step}
          steps={STEPS.map((key) => ({
            key,
            label: t.book.steps[key],
            shortLabel: t.book.stepsShort[key],
          }))}
        />
        {sessionLost ? <Notice tone="warning">{t.errors.sessionLost}</Notice> : null}
        <div className="ls-booking-layout">
          <div className="ls-booking-main">
            <h2 ref={heading} tabIndex={-1} className="ls-booking-step-title">
              {t.book.steps[step]}
            </h2>
            {message ? <Notice tone="danger">{message}</Notice> : null}

            {step === 'services' ? (
              <>
                {/* Above the list, so the list arriving after it never moves it. */}
                <p className="ls-detail-note">{t.book.priceNote}</p>
                {branches.loading ? loading : null}
                {loadError(branches.error, branches.retry)}
                {branches.data && branches.data.branches.length === 0 ? (
                  <Notice tone="info">{t.book.noBranches}</Notice>
                ) : null}
                {branches.data && branches.data.branches.length > 1 ? (
                  <FormSection title={t.book.chooseBranch}>
                    <div
                      role="radiogroup"
                      aria-label={t.book.chooseBranch}
                      className="ls-choice-list"
                    >
                      {branches.data.branches.map((entry) => (
                        <ChoiceCard
                          key={entry.id}
                          type="radio"
                          name="branch"
                          value={entry.id}
                          checked={draft.branchId === entry.id}
                          onChange={() => setDraft({ ...emptyDraft(), branchId: entry.id })}
                          title={entry.name}
                        />
                      ))}
                    </div>
                  </FormSection>
                ) : null}
                {draft.branchId && branch.loading ? loading : null}
                {loadError(branch.error, branch.retry)}
                {branch.data && branch.data.services.length === 0 ? (
                  <Notice tone="info">{t.book.noServices}</Notice>
                ) : null}
                {branch.data
                  ? groupByCategory(branch.data.services, locale).map((group) => (
                      <FormSection key={group.key} title={group.name}>
                        <div className="ls-choice-list">
                          {group.services.map((service) => (
                            <ChoiceCard
                              key={service.id}
                              checked={draft.serviceIds.includes(service.id)}
                              onChange={() =>
                                update((current) => toggleService(current, service.id))
                              }
                              title={serviceLabel(service)}
                              meta={fill(t.book.duration, { minutes: service.durationMinutes })}
                              price={priceText(service)}
                              extra={
                                service.pricingUnit === 'PER_NAIL' ? t.book.perNailNote : undefined
                              }
                            />
                          ))}
                        </div>
                      </FormSection>
                    ))
                  : null}
                {draft.serviceIds.length > 1 ? (
                  <FormSection title={t.book.selectedOrder} description={t.book.chooseServices}>
                    <ol className="ls-order-list">
                      {draft.serviceIds.map((id, position) => (
                        <li key={id}>
                          <span>{serviceName(id)}</span>
                          <span className="ls-order-actions">
                            <IconButton
                              icon="arrow-up"
                              variant="secondary"
                              label={`${t.book.moveUp}: ${serviceName(id)}`}
                              disabled={position === 0}
                              onClick={() =>
                                update((current) => moveService(current, position, -1))
                              }
                            />
                            <IconButton
                              icon="arrow-down"
                              variant="secondary"
                              label={`${t.book.moveDown}: ${serviceName(id)}`}
                              disabled={position === draft.serviceIds.length - 1}
                              onClick={() => update((current) => moveService(current, position, 1))}
                            />
                          </span>
                        </li>
                      ))}
                    </ol>
                  </FormSection>
                ) : null}
              </>
            ) : null}

            {step === 'guests' ? (
              <>
                <FormSection
                  title={t.book.other}
                  description={t.book.whoIntro}
                  actions={
                    <Button
                      variant="secondary"
                      icon="plus"
                      disabled={draft.people.length >= 10}
                      onClick={() =>
                        update((current) => ({
                          ...current,
                          people: [
                            ...current.people,
                            {
                              key: `p${Date.now().toString(36)}`,
                              relation: 'FAMILY',
                              name: '',
                              phone: '',
                            },
                          ],
                        }))
                      }
                    >
                      {t.book.add}
                    </Button>
                  }
                >
                  {draft.people
                    .filter((person) => person.relation !== 'SELF')
                    .map((person) => (
                      <PersonEditor
                        key={person.key}
                        person={person}
                        onChange={(next) =>
                          update((current) => ({
                            ...current,
                            people: current.people.map((entry) =>
                              entry.key === next.key ? next : entry,
                            ),
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
                </FormSection>
                <FormSection title={t.book.whoTitle}>
                  {draft.serviceIds.map((id, position) => (
                    <Field key={id} label={serviceName(id)}>
                      {(control) => (
                        <Select
                          {...control}
                          value={draft.recipientOf[position] ?? SELF.key}
                          options={draft.people.map((person) => ({
                            value: person.key,
                            label: personLabel(person.key),
                          }))}
                          onChange={(event) =>
                            update((current) => ({
                              ...current,
                              recipientOf: current.recipientOf.map((key, at) =>
                                at === position ? event.target.value : key,
                              ),
                            }))
                          }
                        />
                      )}
                    </Field>
                  ))}
                </FormSection>
                {peopleProblem(draft) ? (
                  <Notice tone="warning">{t.book.recipientNameRequired}</Notice>
                ) : null}
              </>
            ) : null}

            {step === 'when' ? (
              <>
                <FormSection title={t.book.staffTitle} description={t.book.chooseStaffHint}>
                  {staff.loading ? loading : null}
                  {loadError(staff.error, staff.retry)}
                  {staff.data
                    ? draft.serviceIds.map((id, position) => {
                        const options = staff.data?.services[position]?.employees ?? [];
                        return (
                          <Field key={id} label={serviceName(id)}>
                            {(control) => (
                              <>
                                {options.length === 0 ? (
                                  <Notice tone="warning">{t.book.noQualified}</Notice>
                                ) : null}
                                <Select
                                  {...control}
                                  value={draft.staffOf[position] ?? 'ANY'}
                                  disabled={options.length === 0}
                                  options={[
                                    { value: 'ANY', label: t.book.anyStaff },
                                    ...options.map((employee) => ({
                                      value: employee.id,
                                      label: employee.displayName,
                                    })),
                                  ]}
                                  onChange={(event) =>
                                    update((current) => ({
                                      ...current,
                                      startTime: '',
                                      staffOf: current.staffOf.map((value, at) =>
                                        at === position ? event.target.value : value,
                                      ),
                                    }))
                                  }
                                />
                              </>
                            )}
                          </Field>
                        );
                      })
                    : null}
                </FormSection>
                <FormSection title={t.book.pickDate}>
                  <Field
                    label={t.book.date}
                    required
                    requiredLabel={t.common.required}
                    {...(branch.data
                      ? {
                          hint: fill(t.book.dateRange, {
                            first: formatBusinessDate(branch.data.firstDate, locale),
                            last: formatBusinessDate(branch.data.lastDate, locale),
                          }),
                        }
                      : {})}
                    width="md"
                  >
                    {(control) => (
                      <DateInput
                        {...control}
                        min={branch.data?.firstDate}
                        max={branch.data?.lastDate}
                        value={draft.date}
                        onChange={(event) =>
                          update((current) => ({
                            ...current,
                            date: event.target.value,
                            startTime: '',
                          }))
                        }
                      />
                    )}
                  </Field>
                </FormSection>
                {draft.date ? (
                  <FormSection title={t.book.pickTime} description={t.book.times}>
                    {times.loading ? (
                      <p className="ls-hint" role="status">
                        {t.book.loadingTimes}
                      </p>
                    ) : null}
                    {loadError(times.error, times.retry)}
                    {times.data && times.data.starts.length === 0 ? (
                      <Notice tone="info">{t.book.noTimes}</Notice>
                    ) : null}
                    {times.data && times.data.starts.length > 0 ? (
                      <div role="radiogroup" aria-label={t.book.times} className="ls-slot-grid">
                        {times.data.starts.map((start) => (
                          <ChoiceCard
                            key={start}
                            type="radio"
                            name="start"
                            value={start}
                            checked={draft.startTime === start}
                            onChange={() => update((current) => ({ ...current, startTime: start }))}
                            title={start}
                          />
                        ))}
                      </div>
                    ) : null}
                  </FormSection>
                ) : null}
              </>
            ) : null}

            {step === 'confirm' ? (
              <Card as="section" aria-label={t.book.reviewTitle}>
                <DescriptionList
                  items={[
                    ...(branches.data && branches.data.branches.length > 1
                      ? [{ label: t.book.branch, value: branch.data?.branch.name }]
                      : []),
                    {
                      label: t.book.when,
                      value: `${formatBusinessDate(draft.date, locale)} · ${draft.startTime}`,
                    },
                    ...draft.serviceIds.map((id, position): DescriptionItem => ({
                      label: serviceName(id),
                      value: `${t.book.for}: ${personLabel(draft.recipientOf[position] ?? SELF.key)} · ${t.book.staff}: ${staffName(position)}`,
                    })),
                  ]}
                />
              </Card>
            ) : null}
          </div>

          <aside className="ls-summary" aria-label={t.book.summaryTitle}>
            <Card as="section" aria-label={t.book.summaryTitle}>
              <Summary
                title={t.book.summaryTitle}
                lines={chosen.map((service) => ({
                  key: service.id,
                  name: serviceLabel(service),
                  price: priceText(service),
                }))}
                empty={t.book.summaryEmpty}
                estimate={fill(t.book.estimate, { minutes: totals.minutes })}
                subtotal={t.book.subtotal}
                total={totalLine}
                totalNote={totalNote}
                note={t.book.priceNote}
              />
              <div className="ls-summary-actions">{stepButtons}</div>
            </Card>
          </aside>
        </div>
      </div>
      {/* Mounted with the first chosen service, so it slides up then (M7); the phone tab bar leaves while it is here. */}
      {totals.count > 0 ? (
        <div className="ls-action-bar">
          <div className="ls-action-tally">
            <span>
              {fill(t.book.selectedCount, { count: totals.count })} ·{' '}
              {fill(t.book.estimate, { minutes: totals.minutes })}
            </span>
            <strong>
              {totalLine}
              {totalNote ? ` ${totalNote}` : ''}
            </strong>
          </div>
          <div className="ls-action-buttons">{stepButtons}</div>
        </div>
      ) : null}
    </PublicMain>
  );
}

function Summary({
  title,
  lines,
  empty,
  estimate,
  subtotal,
  total,
  totalNote,
  note,
}: {
  title: string;
  lines: { key: string; name: string; price: string }[];
  empty: string;
  estimate: string;
  subtotal: string;
  total: string;
  totalNote: string | null;
  note: string;
}): ReactNode {
  return (
    <>
      <h2 className="ls-site-h3">{title}</h2>
      {lines.length === 0 ? (
        <p className="ls-summary-fact">{empty}</p>
      ) : (
        <>
          <ul className="ls-summary-lines">
            {lines.map((line) => (
              <li key={line.key}>
                <span>{line.name}</span>
                <span className="ls-choice-price">{line.price}</span>
              </li>
            ))}
          </ul>
          <p className="ls-summary-fact">{estimate}</p>
          <div className="ls-summary-total">
            <span>{subtotal}</span>
            <span>
              {total}
              {totalNote ? <small>{totalNote}</small> : null}
            </span>
          </div>
          <p className="ls-summary-fact">{note}</p>
        </>
      )}
    </>
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
    <Card as="section" aria-label={t.book.other}>
      <CardHeader
        title={t.book.other}
        headingLevel={3}
        actions={
          <Button variant="ghost" onClick={onRemove}>
            {t.book.remove}
          </Button>
        }
      />
      <div className="ls-member-form">
        <Field label={t.book.relation} required requiredLabel={t.common.required}>
          {(control) => (
            <Select
              {...control}
              value={person.relation}
              options={OTHER_RELATIONS.map((relation) => ({
                value: relation,
                label: t.book.relations[relation],
              }))}
              onChange={(event) =>
                onChange({ ...person, relation: event.target.value as Person['relation'] })
              }
            />
          )}
        </Field>
        <Field label={t.book.recipientName} required requiredLabel={t.common.required}>
          {(control) => (
            <TextInput
              {...control}
              maxLength={200}
              autoComplete="off"
              value={person.name}
              onChange={(event) => onChange({ ...person, name: event.target.value })}
            />
          )}
        </Field>
        <Field label={`${t.book.recipientPhone} (${t.common.optional})`}>
          {(control) => (
            <TextInput
              {...control}
              type="tel"
              inputMode="tel"
              maxLength={24}
              autoComplete="off"
              value={person.phone}
              onChange={(event) => onChange({ ...person, phone: event.target.value })}
            />
          )}
        </Field>
      </div>
    </Card>
  );
}
