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
  Accordion,
  Band,
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
  SearchInput,
  Skeleton,
  Steps,
  TextInput,
  useOptionalToast,
  useStepSlide,
  useUrlState,
  type DescriptionItem,
} from '@lucy-spa/ui';
import Link from 'next/link';
import { NAV_TRANSITION } from '../../../lib/nav-transition';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
import { invalidateCachedReads } from '../../../lib/customer/fetch-cache';
import { formatBusinessDate } from '../../../lib/customer/invoice';
import { matchesQuery } from '../../../lib/search-core';
import {
  bookingPrefillFromSearch,
  bookingTotals,
  formatFixedTotal,
  groupByCategory,
  prefillBranchId,
  prefillDate,
  preselectServiceIds,
  serviceCodesFromSearch,
  type BookingPrefill,
  type BranchService,
} from '../../../lib/customer/booking-view';
import { PageBack } from '../../navigation/page-back';
import { useCustomer } from '../session';
import { formatSlotTime } from '../member-format';
import { useUnsavedGuard } from '../unsaved-guard';

/** From this many services the first step offers a search box (a short list needs none). */
const SEARCH_FROM = 8;
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

/** The step lives in the address bar (`?step=`), so Back/Forward move between steps and a reload stays on the step (wig book.tsx:120). */
const STEP_URL_DEFAULTS = { step: 'services' };

/** The choices of an unfinished booking are kept for this tab, so a reload (or Back into the flow) finds them again. */
const DRAFT_STORAGE_KEY = 'ls-book-draft';

function isDraft(value: unknown): value is BookingDraft {
  if (typeof value !== 'object' || value === null) return false;
  const draft = value as Record<string, unknown>;
  const strings = (list: unknown) =>
    Array.isArray(list) && list.every((item) => typeof item === 'string');
  return (
    typeof draft['branchId'] === 'string' &&
    typeof draft['date'] === 'string' &&
    typeof draft['startTime'] === 'string' &&
    strings(draft['serviceIds']) &&
    strings(draft['recipientOf']) &&
    strings(draft['staffOf']) &&
    Array.isArray(draft['people'])
  );
}

function storedDraft(): BookingDraft {
  try {
    const raw = window.sessionStorage.getItem(DRAFT_STORAGE_KEY);
    const value: unknown = raw ? JSON.parse(raw) : null;
    return isDraft(value) ? value : emptyDraft();
  } catch {
    return emptyDraft();
  }
}

function keepDraft(draft: BookingDraft | null): void {
  try {
    if (draft) window.sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
    else window.sessionStorage.removeItem(DRAFT_STORAGE_KEY);
  } catch {
    // Storage blocked (private window): the flow works, only a reload forgets the choices.
  }
}

/** The furthest step the choices allow: a reload or a shared address never opens a step whose earlier choices are missing. */
function furthestStep(draft: BookingDraft): Step {
  if (draft.serviceIds.length === 0) return 'services';
  if (peopleProblem(draft) !== null) return 'guests';
  if (!draft.date || !draft.startTime) return 'when';
  return 'confirm';
}

/**
 * "Đặt lịch": four visible steps (services, guests, staff and time, confirm) over the same data and rules as before:
 * the server plans, re-checks under locks and confirms (O4); this screen only collects choices. The services may
 * be preselected from `?service=CODE` (the "Đặt lịch" buttons of the public pages).
 */
export function BookScreen() {
  const { api, t, locale, base, sessionLost } = useCustomer();
  const toast = useOptionalToast();
  const [url, setUrl] = useUrlState(STEP_URL_DEFAULTS);
  // The first render is the server's (an empty draft); the tab's stored draft is restored in a layout effect, before the browser paints
  // (reading sessionStorage during render made the hydrated page differ from the server's: React #418).
  const [chosenDraft, setDraft] = useState<BookingDraft>(emptyDraft);
  useLayoutEffect(() => {
    setDraft(storedDraft());
  }, []);
  // A failed confirmation and "Continue used while something is missing" belong to the step they happened on.
  const [failure, setFailure] = useState<{ step: Step; text: string } | null>(null);
  const [askedAt, setAskedAt] = useState<Step | null>(null);
  const [pending, setPending] = useState(false);
  const [created, setCreated] = useState<CustomerBookingDetail | null>(null);
  const idempotencyKey = useRef<string>('');
  const heading = useRef<HTMLHeadingElement>(null);
  const slide = useRef<HTMLDivElement>(null);
  const preselected = useRef(false);
  // The branch, the day and the start time a booking link named (the website chat's link); applied once each.
  const prefill = useRef<BookingPrefill | null>(null);
  const branchPrefilled = useRef(false);
  const timePrefill = useRef<string | null>(null);
  const [serviceQuery, setServiceQuery] = useState('');

  const branches = useLoad(
    () => api.get<CustomerBookingBranchesResponse>('/api/v1/me/booking/branches'),
    'branches',
  );
  const linked = () => {
    prefill.current ??= bookingPrefillFromSearch(window.location.search);
    return prefill.current;
  };
  const onlyBranch = branches.data?.branches.length === 1 ? branches.data.branches[0] : undefined;
  // One active branch: no question to ask. The branch is derived in render, not set by an effect (rbp book.tsx:153-156).
  const draft: BookingDraft =
    chosenDraft.branchId || !onlyBranch ? chosenDraft : { ...chosenDraft, branchId: onlyBranch.id };
  // The step the address asks for, held back to the furthest one the choices allow.
  const askedStep: Step = (STEPS as readonly string[]).includes(String(url.step))
    ? (url.step as Step)
    : 'services';
  const step: Step = STEPS[
    Math.min(STEPS.indexOf(askedStep), STEPS.indexOf(furthestStep(draft)))
  ] as Step;
  // The step slides in along the direction of the sequence (C17, G3: feedback through useMotion); also on Back/Forward.
  useStepSlide(slide, STEPS.indexOf(step));
  // Unsent choices: kept for this tab, and the visitor is asked before leaving the page (never after the booking is made).
  const dirty =
    created === null &&
    !pending &&
    (chosenDraft.serviceIds.length > 0 || chosenDraft.people.length > 1 || chosenDraft.date !== '');
  useEffect(() => keepDraft(dirty ? chosenDraft : null), [dirty, chosenDraft]);
  useUnsavedGuard(dirty, t.book.leaveBooking, { onLeave: () => keepDraft(null) });
  // The new step's heading takes the focus (after a button or Back/Forward), not on the first paint.
  const shownStep = useRef(step);
  useEffect(() => {
    if (shownStep.current === step) return;
    shownStep.current = step;
    heading.current?.focus();
  }, [step]);
  useEffect(() => {
    // A link that names a branch chooses it (when the customer has more than one to choose from).
    if (branchPrefilled.current || !branches.data || branches.data.branches.length < 2) return;
    branchPrefilled.current = true;
    const id = prefillBranchId(linked().branchCode, branches.data.branches);
    if (id) setDraft((current) => (current.branchId ? current : { ...current, branchId: id }));
  }, [branches.data]);
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
    // The linked day (inside the bookable range) and start time wait for the "when" step, where the times are loaded.
    const day = prefillDate(linked().date, branch.data.firstDate, branch.data.lastDate);
    if (day) {
      timePrefill.current = linked().time;
      update((current) => (current.date ? current : { ...current, date: day }));
    }
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

  // The linked start time is chosen once, when the times of the linked day arrive and it is one of them.
  useEffect(() => {
    const wanted = timePrefill.current;
    if (wanted === null || !times.data || times.data.date !== draft.date) return;
    timePrefill.current = null;
    if (times.data.starts.includes(wanted)) {
      update((current) => (current.startTime ? current : { ...current, startTime: wanted }));
    }
  }, [times.data]);

  const servicesById = useMemo(
    () => new Map((branch.data?.services ?? []).map((service) => [service.id, service])),
    [branch.data],
  );
  const serviceLabel = (service: BranchService) =>
    locale === 'vi' ? service.nameVi : service.nameEn;
  // The search is matched once per service and the groups are built once per change of list or query (rbp book.tsx:478-493).
  const serviceGroups = useMemo(() => {
    const services = branch.data?.services ?? [];
    const matching = services.filter((service) =>
      matchesQuery(locale === 'vi' ? service.nameVi : service.nameEn, serviceQuery),
    );
    return {
      none: services.length > 0 && matching.length === 0,
      groups: groupByCategory(matching, locale),
    };
  }, [branch.data, serviceQuery, locale]);
  const selectedIds = new Set(draft.serviceIds);
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

  /**
   * Removes a guest at once and offers to bring them back for 8 s ("Hoàn tác" in the toast, wig book.tsx:896): the guest returns to
   * the same place, with the services that were theirs (those that still point at "myself" because of the removal).
   */
  function removePerson(person: Person) {
    const position = chosenDraft.people.findIndex((entry) => entry.key === person.key);
    const theirs = chosenDraft.recipientOf.map((key) => key === person.key);
    update((current) => ({
      ...current,
      people: current.people.filter((entry) => entry.key !== person.key),
      recipientOf: current.recipientOf.map((key) => (key === person.key ? SELF.key : key)),
    }));
    toast?.push({
      tone: 'info',
      message: fill(t.book.guestRemoved, {
        name: person.name.trim() || t.book.relations[person.relation],
      }),
      action: {
        label: t.book.undo,
        onAction: () =>
          update((current) => {
            if (current.people.some((entry) => entry.key === person.key)) return current;
            const people = [...current.people];
            people.splice(Math.min(Math.max(position, 0), people.length), 0, person);
            return {
              ...current,
              people,
              recipientOf: current.recipientOf.map((key, at) =>
                theirs[at] && key === SELF.key ? person.key : key,
              ),
            };
          }),
      },
    });
  }

  // A step change is a new history entry (Back returns to the previous step); the heading focus follows the step (effect above).
  function go(next: Step) {
    if (next === 'confirm') idempotencyKey.current = crypto.randomUUID();
    setUrl({ step: next });
  }

  async function confirm() {
    if (pending) return;
    // A confirm step opened by a reload has no key yet: one is made here, and a retry reuses it.
    if (!idempotencyKey.current) idempotencyKey.current = crypto.randomUUID();
    setPending(true);
    setFailure(null);
    try {
      // The same key on a retry returns the same booking instead of a duplicate.
      const booking = await api.post<CustomerBookingDetail>(
        '/api/v1/me/bookings',
        createRequest(draft, idempotencyKey.current),
      );
      keepDraft(null);
      // The member's booking lists change with it.
      invalidateCachedReads('/api/v1/me/bookings');
      setCreated(booking);
    } catch (error) {
      const text = customerErrorMessage(error, t);
      if (error instanceof ApiError && RETRY_TIME_CODES.has(error.code)) {
        update((current) => ({ ...current, startTime: '' }));
        setTimesAttempt((value) => value + 1);
        setFailure({ step: 'when', text });
        setUrl({ step: 'when' }, { replace: true });
      } else {
        setFailure({ step: 'confirm', text });
      }
    } finally {
      setPending(false);
    }
  }

  if (created) {
    return (
      <PublicMain className="ls-main-tall">
        <Band tone="page" className="ls-band--alt ls-book-title">
          <PageBack root={base} publicHome={`/${locale}`} menuRoot label={t.common.back} />
          <div className="ls-public-title" aria-live="polite">
            <h1 ref={heading} tabIndex={-1} className="ls-h1-display">
              {t.book.successTitle}
            </h1>
          </div>
        </Band>
        <Band tone="page" className="ls-band--base ls-book-body">
          <div className="ls-booking-main ls-booking-done">
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
                variant="neutral"
                onClick={() => {
                  setCreated(null);
                  setDraft(emptyDraft());
                  preselected.current = true;
                  go('services');
                }}
              >
                {t.book.bookAnother}
              </Button>
              <Link
                className={buttonClass('primary')}
                href={`${base}/bookings/${created.id}`}
                transitionTypes={NAV_TRANSITION}
              >
                {t.book.viewBooking}
              </Link>
            </div>
          </div>
        </Band>
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
  // What still stops the step, in words (null = the step can go on). The button stays usable and says this when used (wig book.tsx:394).
  const missing =
    step === 'services'
      ? draft.serviceIds.length > 0 && chosen.length === draft.serviceIds.length
        ? null
        : t.book.missing.services
      : step === 'guests'
        ? peopleProblem(draft) === null
          ? null
          : t.book.recipientNameRequired
        : step === 'when'
          ? !staffReady && staff.data
            ? t.book.missing.staff
            : staffReady &&
                Boolean(
                  draft.date && draft.startTime && times.data?.starts.includes(draft.startTime),
                )
              ? null
              : t.book.missing.when
          : null;
  const nav: StepNav = {
    back: index > 0 ? () => go(STEPS[index - 1] as Step) : null,
    // The button names the next step ("Chọn khách"), not a generic "Tiếp tục" (wig customer.ts:10).
    nextLabel: step === 'confirm' ? t.book.confirm : t.book.nextTo[step],
    canContinue: missing === null,
    pending: step === 'confirm' && pending,
    onNext: () => {
      if (missing !== null) {
        // The reason shows under the step heading, which takes the focus so it is read out and in view; it goes away by itself
        // once the choice is made (derived from `missing`, not stored).
        setAskedAt(step);
        heading.current?.focus();
        return;
      }
      if (step === 'confirm') void confirm();
      else go(STEPS[index + 1] as Step);
    },
  };

  const fixedTotal = formatFixedTotal(totals, locale);
  const totalLine = fixedTotal ?? (totals.hasPerNail ? t.book.perNailOnly : '—');
  const totalNote = fixedTotal !== null && totals.hasPerNail ? t.book.plusPerNail : null;

  const stepButtons = (
    <>
      {nav.back ? (
        <Button variant="neutral" disabled={pending} onClick={nav.back}>
          {t.common.back}
        </Button>
      ) : null}
      <Button variant="primary" loading={nav.pending} onClick={nav.onNext}>
        {nav.pending ? t.book.confirming : nav.nextLabel}
      </Button>
    </>
  );

  return (
    <PublicMain className={totals.count > 0 ? 'ls-main-tall ls-booking-bar' : 'ls-main-tall'}>
      <Band tone="page" className="ls-band--alt ls-book-title">
        <PageBack root={base} publicHome={`/${locale}`} menuRoot label={t.common.back} />
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
      </Band>
      <Band tone="page" className="ls-band--base ls-book-body">
        {sessionLost ? <Notice tone="warning">{t.errors.sessionLost}</Notice> : null}
        <div className="ls-booking-layout">
          <div ref={slide} className="ls-booking-main">
            <h2 ref={heading} tabIndex={-1} className="ls-booking-step-title">
              {t.book.steps[step]}
            </h2>
            {failure && failure.step === step ? (
              <Notice tone="danger">{failure.text}</Notice>
            ) : null}
            {/* The guests step already says what is missing in its own notice below the fields. */}
            {askedAt === step && missing !== null && step !== 'guests' ? (
              <Notice tone="warning">{missing}</Notice>
            ) : null}

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
                {branch.data && branch.data.services.length > SEARCH_FROM ? (
                  <div
                    className="ls-booking-search"
                    role="search"
                    aria-label={t.book.searchServices}
                  >
                    <SearchInput
                      label={t.book.searchServices}
                      clearLabel={t.book.searchClear}
                      hint={t.book.searchPlaceholder}
                      debounceMs={150}
                      onSearch={setServiceQuery}
                    />
                  </div>
                ) : null}
                {serviceQuery !== '' && serviceGroups.none ? (
                  <Notice tone="info">
                    {fill(t.book.noServiceMatch, { query: serviceQuery })}
                  </Notice>
                ) : null}
                {branch.data
                  ? serviceGroups.groups.map((group) => (
                      <FormSection key={group.key} title={group.name}>
                        {/* One hairline list surface per category, not a tile per service (B12, B19). */}
                        <div className="ls-choice-list ls-mem-choices">
                          {group.services.map((service) => (
                            <ChoiceCard
                              key={service.id}
                              checked={selectedIds.has(service.id)}
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
                        onRemove={() => removePerson(person)}
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
                            title={formatSlotTime(start, locale)}
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
                      value: `${formatBusinessDate(draft.date, locale)}, ${formatSlotTime(draft.startTime, locale)}`,
                    },
                    // Who and with whom as two labelled lines, not one dotted string.
                    ...draft.serviceIds.map((id, position): DescriptionItem => ({
                      label: serviceName(id),
                      value: (
                        <span className="ls-mem-value-lines">
                          <span>
                            {t.book.for}: {personLabel(draft.recipientOf[position] ?? SELF.key)}
                          </span>
                          <span>
                            {t.book.staff}: {staffName(position)}
                          </span>
                        </span>
                      ),
                    })),
                  ]}
                />
              </Card>
            ) : null}

            {/* A phone has no aside: the same summary folds under the steps, and the action bar below keeps the total in view. */}
            {totals.count > 0 ? (
              <aside className="ls-summary-fold" aria-label={t.book.summaryTitle}>
                <Accordion
                  headingLevel={2}
                  items={[
                    {
                      id: 'summary',
                      title: t.book.summaryTitle,
                      content: (
                        <Summary
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
                      ),
                    },
                  ]}
                />
              </aside>
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
      </Band>
      {/* Mounted with the first chosen service, so it slides up then (M7); the phone tab bar leaves while it is here. */}
      {totals.count > 0 ? (
        <div className="ls-action-bar">
          <div className="ls-action-tally">
            {/* Two values side by side, not a dotted string. */}
            <span className="ls-mem-tally">
              <span>{fill(t.book.selectedCount, { count: totals.count })}</span>
              <span>{fill(t.book.estimate, { minutes: totals.minutes })}</span>
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
  /** The aside shows its own heading; the phone's fold has the accordion row for it. */
  title?: string;
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
      {title ? <h2 className="ls-site-h3">{title}</h2> : null}
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
  // Each guest card and its remove button are named by the guest (two cards never read the same to a screen reader).
  const who = person.name.trim() || t.book.other;
  return (
    <Card as="section" aria-label={who}>
      <CardHeader
        title={t.book.other}
        headingLevel={3}
        actions={
          <Button
            variant="neutral"
            onClick={onRemove}
            aria-label={fill(t.book.removeGuest, { name: who })}
          >
            {t.book.remove}
          </Button>
        }
      />
      <div className="ls-member-form">
        <Field label={t.book.relation} required requiredLabel={t.common.required}>
          {(control) => (
            <Select
              {...control}
              name="guest-relation"
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
              name="guest-name"
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
              name="guest-phone"
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
