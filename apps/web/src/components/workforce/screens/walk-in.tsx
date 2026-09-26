'use client';

import type {
  WalkInMemberLookupResponse,
  WalkInOptionsResponse,
  WalkInVisitResponse,
} from '@lucy-spa/contracts';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { fill } from '../../../i18n/workforce';
import { boardErrorMessage, branchTime } from '../../../lib/workforce/booking-board';
import {
  guardians,
  waitReasonText,
  walkInBranches,
  walkInProblem,
  walkInRequest,
  type WalkInLine,
  type WalkInPerson,
} from '../../../lib/workforce/walk-in';
import { useBranches } from '../data';
import { useAccount, useWorkforce } from '../session';
import { Badge, Empty, Field, Loading, Notice, PageHeader, Section, SubmitButton } from '../ui';

let keySequence = 0;
const nextKey = (prefix: string) => `${prefix}${(++keySequence).toString(36)}`;

/**
 * "Khách vãng lai" (Phase 3 Step 6): front-desk intake of customers without a booking. Existing
 * members are found by exact phone or email; everyone else is a guest or a child (never an
 * account). The server records the visit at its own clock, assigns a suitable free KTV now if it
 * can, and otherwise keeps the service waiting (no KTV, no time) in the branch waiting pool.
 */
export function WalkInScreen() {
  const { api, t, locale, base } = useWorkforce();
  const { account } = useAccount();
  const branches = useBranches(api);
  const allowed = useMemo(() => walkInBranches(account, branches.data), [account, branches.data]);
  const [branchId, setBranchId] = useState('');
  const [options, setOptions] = useState<WalkInOptionsResponse | null>(null);
  const [optionsError, setOptionsError] = useState<unknown>(null);
  const [people, setPeople] = useState<WalkInPerson[]>([]);
  const [lines, setLines] = useState<WalkInLine[]>([]);
  const [lookupBy, setLookupBy] = useState<'phone' | 'email'>('phone');
  const [lookupValue, setLookupValue] = useState('');
  const [lookup, setLookup] = useState<WalkInMemberLookupResponse | null>(null);
  const [looking, setLooking] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [result, setResult] = useState<WalkInVisitResponse | null>(null);
  // One key per intake: retries of the same submission replay the same visit.
  const idempotencyKey = useRef<string>('');
  useEffect(() => {
    idempotencyKey.current = '';
  }, [people, lines, branchId]);

  useEffect(() => {
    if (!branchId && allowed[0]) setBranchId(allowed[0].id);
  }, [allowed, branchId]);
  useEffect(() => {
    if (!branchId) return;
    let active = true;
    setOptions(null);
    setOptionsError(null);
    api
      .get<WalkInOptionsResponse>(`/api/v1/operations/branches/${branchId}/walk-in-options`)
      .then((data) => active && setOptions(data))
      .catch((error: unknown) => active && setOptionsError(error));
    return () => {
      active = false;
    };
  }, [api, branchId]);

  const name = (vi: string, en: string) => (locale === 'vi' ? vi : en);
  const reset = () => {
    setPeople([]);
    setLines([]);
    setLookup(null);
    setLookupValue('');
    setResult(null);
    setMessage(null);
  };

  async function search(event: FormEvent) {
    event.preventDefault();
    if (looking || !lookupValue.trim()) return;
    setLooking(true);
    setMessage(null);
    try {
      setLookup(
        await api.get<WalkInMemberLookupResponse>(
          `/api/v1/operations/branches/${branchId}/members`,
          {
            [lookupBy]: lookupValue.trim(),
          },
        ),
      );
    } catch (error) {
      setLookup(null);
      setMessage(boardErrorMessage(error, t));
    } finally {
      setLooking(false);
    }
  }

  const addPerson = (person: Omit<WalkInPerson, 'key'>) => {
    const key = nextKey('p');
    setPeople((current) => [...current, { ...person, key }]);
    setLines((current) => [
      ...current,
      { key: nextKey('l'), participantKey: key, serviceId: '', staff: 'ANY' },
    ]);
  };
  const updatePerson = (key: string, change: Partial<WalkInPerson>) =>
    setPeople((current) =>
      current.map((person) => (person.key === key ? { ...person, ...change } : person)),
    );
  const removePerson = (key: string) => {
    setPeople((current) =>
      current
        .filter((person) => person.key !== key)
        .map((person) => (person.guardianKey === key ? { ...person, guardianKey: '' } : person)),
    );
    setLines((current) => current.filter((line) => line.participantKey !== key));
  };
  const updateLine = (key: string, change: Partial<WalkInLine>) =>
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...change } : line)),
    );

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    const problem = walkInProblem(people, lines);
    if (problem) {
      setMessage(
        problem === 'people'
          ? t.walkIn.needPeople
          : problem === 'name'
            ? t.walkIn.needName
            : t.walkIn.childNeedsAdult,
      );
      return;
    }
    if (!idempotencyKey.current) idempotencyKey.current = crypto.randomUUID();
    setPending(true);
    setMessage(null);
    try {
      setResult(
        await api.post<WalkInVisitResponse>(
          `/api/v1/operations/branches/${branchId}/walk-ins`,
          walkInRequest(people, lines, idempotencyKey.current),
        ),
      );
    } catch (error) {
      setMessage(boardErrorMessage(error, t));
    } finally {
      setPending(false);
    }
  }

  if (branches.loading && !branches.data) return <Loading t={t} />;
  if (allowed.length === 0) {
    return (
      <>
        <PageHeader title={t.walkIn.title} intro={t.walkIn.intro} />
        <Empty>{t.walkIn.noBranch}</Empty>
      </>
    );
  }

  if (result) {
    const zone = result.timezone;
    return (
      <>
        <PageHeader title={fill(t.walkIn.resultTitle, { code: result.visitCode })} />
        <div className="wf-cards">
          {result.participants.map((participant) => (
            <article key={participant.participantId} className="wf-card">
              <h3>
                {participant.displayName}{' '}
                <Badge tone="neutral">{t.walkIn.kinds[participant.kind]}</Badge>{' '}
                {participant.state === 'ASSIGNED' ? (
                  <Badge tone="success">{t.walkIn.assigned}</Badge>
                ) : participant.state === 'WAITING' ? (
                  <Badge tone="warning">{t.walkIn.waiting}</Badge>
                ) : null}
              </h3>
              {participant.state === 'WAITING' ? (
                <p className="wf-muted">{waitReasonText(participant.waitReason, t)}</p>
              ) : null}
              <ol className="wf-plain-list">
                {participant.lines.map((line) => (
                  <li key={line.id}>
                    {name(line.serviceNameVi, line.serviceNameEn)} ·{' '}
                    {line.employee
                      ? `${line.employee.displayName} · ${branchTime(line.plannedStartAt!, zone, locale)}–${branchTime(line.plannedEndAt!, zone, locale)}`
                      : line.requestedEmployee
                        ? fill(t.bookingBoard.requested, {
                            name: line.requestedEmployee.displayName,
                          })
                        : t.bookingBoard.any}
                  </li>
                ))}
              </ol>
            </article>
          ))}
        </div>
        <div className="wf-row-actions">
          <Link className="wf-button wf-button-primary" href={`${base}/booking-board`}>
            {t.walkIn.goBoard}
          </Link>
          <button type="button" className="wf-button" onClick={reset}>
            {t.walkIn.newWalkIn}
          </button>
        </div>
      </>
    );
  }

  const adults = guardians(people);
  const serviceById = new Map((options?.services ?? []).map((service) => [service.id, service]));
  return (
    <>
      <PageHeader title={t.walkIn.title} intro={t.walkIn.intro} />
      <div className="wf-filters">
        <Field id="walkin-branch" label={t.walkIn.branch}>
          <select
            id="walkin-branch"
            value={branchId}
            onChange={(event) => (reset(), setBranchId(event.target.value))}
          >
            {allowed.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {optionsError ? <Notice tone="error">{boardErrorMessage(optionsError, t)}</Notice> : null}
      {!options && !optionsError ? <Loading t={t} /> : null}
      {message ? <Notice tone="error">{message}</Notice> : null}

      <Section title={t.walkIn.lookupTitle}>
        <form className="wf-inline-form" onSubmit={(event) => void search(event)}>
          <Field id="walkin-lookup-by" label={t.walkIn.lookupBy}>
            <select
              id="walkin-lookup-by"
              value={lookupBy}
              onChange={(event) => (
                setLookupBy(event.target.value as 'phone' | 'email'),
                setLookup(null)
              )}
            >
              <option value="phone">{t.walkIn.phone}</option>
              <option value="email">{t.walkIn.email}</option>
            </select>
          </Field>
          <Field
            id="walkin-lookup"
            label={lookupBy === 'phone' ? t.walkIn.phone : t.walkIn.email}
            hint={t.walkIn.lookupHint}
          >
            <input
              id="walkin-lookup"
              type={lookupBy === 'phone' ? 'tel' : 'email'}
              inputMode={lookupBy === 'phone' ? 'tel' : 'email'}
              autoComplete="off"
              maxLength={lookupBy === 'phone' ? 32 : 320}
              value={lookupValue}
              onChange={(event) => (setLookupValue(event.target.value), setLookup(null))}
            />
          </Field>
          <SubmitButton
            pending={looking}
            label={t.walkIn.search}
            pendingLabel={t.walkIn.searching}
            tone="quiet"
          />
        </form>
        {lookup && lookup.members[0] ? (
          <Notice tone="success">
            <p>
              {fill(t.walkIn.found, { name: lookup.members[0].displayName })}
              {lookup.members[0].phoneMasked ? ` · ${lookup.members[0].phoneMasked}` : ''}
              {lookup.members[0].emailMasked ? ` · ${lookup.members[0].emailMasked}` : ''}
            </p>
            <button
              type="button"
              className="wf-button"
              disabled={people.some((person) => person.customerUserId === lookup.members[0]!.id)}
              onClick={() => {
                const member = lookup.members[0]!;
                addPerson({
                  kind: 'MEMBER',
                  customerUserId: member.id,
                  displayName: member.displayName,
                  phone: '',
                });
                setLookup(null);
                setLookupValue('');
              }}
            >
              {t.walkIn.addMember}
            </button>
          </Notice>
        ) : null}
        {lookup && lookup.members.length === 0 ? (
          <Notice tone="info">{t.walkIn.notFound}</Notice>
        ) : null}
        <div className="wf-row-actions">
          <button
            type="button"
            className="wf-button"
            onClick={() => addPerson({ kind: 'GUEST', displayName: '', phone: '' })}
          >
            + {t.walkIn.addGuest}
          </button>
          <button
            type="button"
            className="wf-button"
            disabled={adults.length === 0}
            title={adults.length === 0 ? t.walkIn.childNeedsAdult : undefined}
            onClick={() =>
              addPerson({
                kind: 'CHILD',
                displayName: '',
                phone: '',
                guardianKey: adults[0]?.key ?? '',
              })
            }
          >
            + {t.walkIn.addChild}
          </button>
        </div>
        {adults.length === 0 ? <p className="wf-small">{t.walkIn.childNeedsAdult}</p> : null}
      </Section>

      <form onSubmit={(event) => void submit(event)}>
        <Section title={t.walkIn.people}>
          {people.length === 0 ? <Empty>{t.walkIn.needPeople}</Empty> : null}
          {options && options.services.length === 0 ? <Empty>{t.walkIn.noServices}</Empty> : null}
          <div className="wf-cards">
            {people.map((person) => (
              <fieldset key={person.key} className="wf-card wf-fieldset">
                <legend>
                  {t.walkIn.kinds[person.kind]}
                  {person.kind === 'MEMBER' ? `: ${person.displayName}` : ''}
                </legend>
                {person.kind !== 'MEMBER' ? (
                  <Field id={`${person.key}-name`} label={t.walkIn.name} required>
                    <input
                      id={`${person.key}-name`}
                      required
                      maxLength={200}
                      autoComplete="off"
                      value={person.displayName}
                      onChange={(event) =>
                        updatePerson(person.key, { displayName: event.target.value })
                      }
                    />
                  </Field>
                ) : null}
                {person.kind === 'GUEST' ? (
                  <Field id={`${person.key}-phone`} label={t.walkIn.guestPhone}>
                    <input
                      id={`${person.key}-phone`}
                      type="tel"
                      inputMode="tel"
                      maxLength={24}
                      autoComplete="off"
                      value={person.phone}
                      onChange={(event) => updatePerson(person.key, { phone: event.target.value })}
                    />
                  </Field>
                ) : null}
                {person.kind === 'CHILD' ? (
                  <Field id={`${person.key}-guardian`} label={t.walkIn.guardian} required>
                    <select
                      id={`${person.key}-guardian`}
                      value={person.guardianKey ?? ''}
                      onChange={(event) =>
                        updatePerson(person.key, { guardianKey: event.target.value })
                      }
                    >
                      {adults.map((adult) => (
                        <option key={adult.key} value={adult.key}>
                          {adult.displayName || t.walkIn.kinds[adult.kind]}
                        </option>
                      ))}
                    </select>
                  </Field>
                ) : null}
                <p className="wf-small">{t.walkIn.services}</p>
                {lines
                  .filter((line) => line.participantKey === person.key)
                  .map((line) => {
                    const service = serviceById.get(line.serviceId);
                    return (
                      <div key={line.key} className="wf-row">
                        <Field id={`${line.key}-service`} label={t.walkIn.chooseService}>
                          <select
                            id={`${line.key}-service`}
                            value={line.serviceId}
                            onChange={(event) =>
                              updateLine(line.key, { serviceId: event.target.value, staff: 'ANY' })
                            }
                          >
                            <option value="">—</option>
                            {options?.services.map((entry) => (
                              <option key={entry.id} value={entry.id}>
                                {name(entry.nameVi, entry.nameEn)} · {entry.durationMinutes}′
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field id={`${line.key}-staff`} label={t.walkIn.staff}>
                          <select
                            id={`${line.key}-staff`}
                            value={line.staff}
                            disabled={!service}
                            onChange={(event) =>
                              updateLine(line.key, { staff: event.target.value })
                            }
                          >
                            <option value="ANY">{t.walkIn.anyStaff}</option>
                            {service?.employees.map((employee) => (
                              <option key={employee.id} value={employee.id}>
                                {employee.displayName}
                                {employee.checkedIn ? '' : ` ${t.walkIn.notCheckedIn}`}
                              </option>
                            ))}
                          </select>
                        </Field>
                        {service && service.employees.length === 0 ? (
                          <p className="wf-small">{t.walkIn.noQualified}</p>
                        ) : null}
                        <button
                          type="button"
                          className="wf-button wf-button-quiet"
                          onClick={() =>
                            setLines((current) => current.filter((entry) => entry.key !== line.key))
                          }
                        >
                          {t.walkIn.remove}
                        </button>
                      </div>
                    );
                  })}
                <div className="wf-row-actions">
                  <button
                    type="button"
                    className="wf-button wf-button-quiet"
                    onClick={() =>
                      setLines((current) => [
                        ...current,
                        {
                          key: nextKey('l'),
                          participantKey: person.key,
                          serviceId: '',
                          staff: 'ANY',
                        },
                      ])
                    }
                  >
                    + {t.walkIn.addService}
                  </button>
                  <button
                    type="button"
                    className="wf-button wf-button-quiet"
                    onClick={() => removePerson(person.key)}
                  >
                    {t.walkIn.remove}
                  </button>
                </div>
              </fieldset>
            ))}
          </div>
          <p className="wf-small">{t.walkIn.priceNote}</p>
        </Section>
        <SubmitButton
          pending={pending}
          label={t.walkIn.create}
          pendingLabel={t.walkIn.creating}
          disabled={!options || people.length === 0}
        />
      </form>
    </>
  );
}
