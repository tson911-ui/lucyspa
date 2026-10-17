'use client';

import type { WalkInOptionsResponse, WalkInVisitResponse } from '@lucy-spa/contracts';
import {
  Button,
  buttonClass,
  Card,
  ConfirmDialog,
  CardHeader,
  Field,
  FormActions,
  FormGrid,
  FormSection,
  Grid,
  IconButton,
  Page,
  Select,
  Stack,
  TextInput,
  useOptionalToast,
  useUnsavedChangesGuard,
} from '@lucy-spa/ui';
import { PrefetchLink as Link } from '../link';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { fill } from '../../../i18n/workforce';
import { boardErrorMessage } from '../../../lib/workforce/booking-board';
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
import { Badge, Empty, Loading, Notice, PageHeader } from '../ui';
import { MemberLookupDialog } from './walk-in-lookup';
import { focusFirstInvalid } from './pos-dom';
import { clockRange, metaLine, minutes } from './pos-format';

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
  const [chosenBranch, setBranchId] = useState('');
  // The first allowed branch is derived, not copied in by an effect (rbp :69-71).
  const branchId = chosenBranch || allowed[0]?.id || '';
  // A branch change asks first while guests are entered (wig :253): their services and staff belong to the old branch.
  const [pendingBranch, setPendingBranch] = useState<string | null>(null);
  const toast = useOptionalToast();
  const [options, setOptions] = useState<WalkInOptionsResponse | null>(null);
  const [optionsError, setOptionsError] = useState<unknown>(null);
  const [people, setPeopleState] = useState<WalkInPerson[]>([]);
  const [lines, setLinesState] = useState<WalkInLine[]>([]);
  const [finding, setFinding] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // After a refused submit the missing names and guardians are marked on their own fields (wig Forms: errors inline).
  const [checked, setChecked] = useState(false);
  const [result, setResult] = useState<WalkInVisitResponse | null>(null);
  const messageRef = useRef<HTMLDivElement>(null);
  // One key per intake: retries of the same submission replay the same visit.
  const idempotencyKey = useRef<string>('');
  // Any edit starts a new intake: the key is cleared where the edit happens, not by an effect after every keystroke (rbp :64-66).
  const setPeople: typeof setPeopleState = (update) => {
    idempotencyKey.current = '';
    setPeopleState(update);
  };
  const setLines: typeof setLinesState = (update) => {
    idempotencyKey.current = '';
    setLinesState(update);
  };
  useUnsavedChangesGuard(people.length > 0 && !pending && result === null);

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
  // The service list and its options only change with the branch's answer and the language, not on each keystroke in a guest's
  // name or phone (rbp rerender-memo, baseline walk-in.tsx:224, :377-380).
  const serviceById = useMemo(
    () => new Map((options?.services ?? []).map((service) => [service.id, service])),
    [options],
  );
  const serviceOptions = useMemo(
    () =>
      (options?.services ?? []).map((entry) => ({
        value: entry.id,
        label: metaLine(locale, [
          locale === 'vi' ? entry.nameVi : entry.nameEn,
          minutes(locale, entry.durationMinutes),
        ]),
      })),
    [options, locale],
  );
  const reset = () => {
    setPeople([]);
    setLines([]);
    setResult(null);
    setMessage(null);
    setChecked(false);
  };

  const addPerson = (person: Omit<WalkInPerson, 'key'>) => {
    const key = nextKey('p');
    setPeople((current) => [...current, { ...person, key }]);
    setLines((current) => [
      ...current,
      { key: nextKey('l'), participantKey: key, serviceId: '', staff: 'ANY' },
    ]);
  };
  const addLine = (participantKey: string) =>
    setLines((current) => [
      ...current,
      { key: nextKey('l'), participantKey, serviceId: '', staff: 'ANY' },
    ]);
  const updatePerson = (key: string, change: Partial<WalkInPerson>) =>
    setPeople((current) =>
      current.map((person) => (person.key === key ? { ...person, ...change } : person)),
    );
  const removePerson = (key: string, label: string) => {
    const index = people.findIndex((person) => person.key === key);
    const removed = people[index];
    const removedLines = lines.filter((line) => line.participantKey === key);
    const wards = people.filter((person) => person.guardianKey === key).map((person) => person.key);
    setPeople((current) =>
      current
        .filter((person) => person.key !== key)
        .map((person) => (person.guardianKey === key ? { ...person, guardianKey: '' } : person)),
    );
    setLines((current) => current.filter((line) => line.participantKey !== key));
    // Undo (wig :309, C72): the person comes back in place with their services and as the guardian of the same children.
    if (removed && toast) {
      toast.push({
        tone: 'info',
        message: fill(t.walkIn.personRemoved, { name: label }),
        action: {
          label: t.walkIn.undo,
          onAction: () => {
            setPeople((current) => {
              const next = current.map((person) =>
                wards.includes(person.key) && !person.guardianKey
                  ? { ...person, guardianKey: key }
                  : person,
              );
              next.splice(Math.min(index, next.length), 0, removed);
              return next;
            });
            setLines((current) => [...current, ...removedLines]);
          },
        },
      });
    }
  };
  // Removing a service line offers the same one-click undo (wig :309, the remove-service button at the line).
  const removeLine = (line: WalkInLine, message: string) => {
    const index = lines.findIndex((entry) => entry.key === line.key);
    setLines((current) => current.filter((entry) => entry.key !== line.key));
    toast?.push({
      tone: 'info',
      message,
      action: {
        label: t.walkIn.undo,
        onAction: () =>
          setLines((current) => {
            const next = [...current];
            next.splice(Math.min(index, next.length), 0, line);
            return next;
          }),
      },
    });
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
      setChecked(true);
      // After React has drawn the messages: the first field to fix takes focus (a missing name or guardian); with nothing to
      // point at (no one or no service yet) the refusal notice does, so it is read first, not lost below the fold.
      if (problem === 'people') requestAnimationFrame(() => messageRef.current?.focus());
      else focusFirstInvalid();
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

  if (branches.loading && !branches.data) return <Loading t={t} page />;
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
        <PageHeader title={fill(t.walkIn.resultTitle, { code: result.visitCode })}>
          <Button variant="secondary" onClick={reset}>
            {t.walkIn.newWalkIn}
          </Button>
          <Link className={buttonClass('primary')} href={`${base}/booking-board`}>
            {t.walkIn.goBoard}
          </Link>
        </PageHeader>
        <Grid min="md">
          {result.participants.map((participant) => (
            <Card as="article" key={participant.participantId} aria-label={participant.displayName}>
              <CardHeader
                title={participant.displayName}
                // h2 right under the page's h1 (wig :182); the name wraps, never cut (Owner answer 7).
                headingLevel={2}
                actions={
                  <>
                    <Badge tone="neutral">{t.walkIn.kinds[participant.kind]}</Badge>
                    {participant.state === 'ASSIGNED' ? (
                      <Badge tone="success">{t.walkIn.assigned}</Badge>
                    ) : participant.state === 'WAITING' ? (
                      <Badge tone="warning">{t.walkIn.waiting}</Badge>
                    ) : null}
                  </>
                }
              />
              <Stack gap="block">
                {participant.state === 'WAITING' ? (
                  <p className="ls-hint">{waitReasonText(participant.waitReason, t)}</p>
                ) : null}
                <ol className="ls-list-plain">
                  {participant.lines.map((line) => (
                    <li key={line.id}>
                      {metaLine(
                        locale,
                        line.employee
                          ? [
                              name(line.serviceNameVi, line.serviceNameEn),
                              line.employee.displayName,
                              clockRange(locale, zone, line.plannedStartAt!, line.plannedEndAt!),
                            ]
                          : [
                              name(line.serviceNameVi, line.serviceNameEn),
                              line.requestedEmployee
                                ? fill(t.bookingBoard.requested, {
                                    name: line.requestedEmployee.displayName,
                                  })
                                : t.bookingBoard.any,
                            ],
                      )}
                    </li>
                  ))}
                </ol>
              </Stack>
            </Card>
          ))}
        </Grid>
      </>
    );
  }

  const adults = guardians(people);
  // One branch: its name leads the intro and the picker is not needed (it also cut long names short).
  const onlyBranch = allowed.length === 1 ? allowed[0] : null;
  const adultKeys = new Set(adults.map((adult) => adult.key));
  const taken = new Set(
    people.flatMap((person) => (person.customerUserId ? [person.customerUserId] : [])),
  );
  // Each person's service lines, grouped once per render instead of a filter per person (rbp js-index-maps, walk-in.tsx:365-366).
  const linesOf = new Map<string, WalkInLine[]>();
  for (const line of lines) {
    const own = linesOf.get(line.participantKey);
    if (own) own.push(line);
    else linesOf.set(line.participantKey, [line]);
  }
  // Each person is numbered within their kind ("Khách lẻ 2: Lan") so headings and remove buttons are told apart (wig :300, :308);
  // the titles are worked out once per render, not once per use.
  const titles = new Map<string, string>();
  const counts = new Map<WalkInPerson['kind'], number>();
  for (const person of people) {
    const n = (counts.get(person.kind) ?? 0) + 1;
    counts.set(person.kind, n);
    const kind = t.walkIn.kinds[person.kind];
    const label = person.displayName.trim();
    titles.set(
      person.key,
      label
        ? fill(t.walkIn.personTitleNamed, { kind, n, name: label })
        : fill(t.walkIn.personTitle, { kind, n }),
    );
  }
  const titleOf = (person: WalkInPerson) => titles.get(person.key) ?? '';
  return (
    <Page width="form">
      <PageHeader
        title={t.walkIn.title}
        intro={
          onlyBranch ? fill(t.walkIn.introBranch, { branch: onlyBranch.name }) : t.walkIn.intro
        }
      />
      {optionsError ? <Notice tone="error">{boardErrorMessage(optionsError, t)}</Notice> : null}
      {!options && !optionsError ? <Loading t={t} /> : null}
      <form noValidate onSubmit={(event) => void submit(event)} aria-label={t.walkIn.title}>
        <Stack gap="block">
          <Card>
            <Stack gap="page">
              {onlyBranch ? null : (
                <FormGrid>
                  <Field label={t.walkIn.branch}>
                    {(control) => (
                      <Select
                        {...control}
                        value={branchId}
                        options={allowed.map((branch) => ({
                          value: branch.id,
                          label: branch.name,
                        }))}
                        onChange={(event) =>
                          people.length > 0
                            ? setPendingBranch(event.target.value)
                            : (reset(), setBranchId(event.target.value))
                        }
                      />
                    )}
                  </Field>
                </FormGrid>
              )}

              <FormSection
                title={t.walkIn.people}
                actions={
                  <>
                    <Button icon="search" onClick={() => setFinding(true)}>
                      {t.walkIn.lookupOpen}
                    </Button>
                    <Button
                      icon="user-plus"
                      onClick={() => addPerson({ kind: 'GUEST', displayName: '', phone: '' })}
                    >
                      {t.walkIn.addGuest}
                    </Button>
                    <Button
                      icon="user-plus"
                      disabled={adults.length === 0}
                      disabledReason={adults.length === 0 ? t.walkIn.childNeedsAdult : ''}
                      onClick={() =>
                        addPerson({
                          kind: 'CHILD',
                          displayName: '',
                          phone: '',
                          guardianKey: adults[0]?.key ?? '',
                        })
                      }
                    >
                      {t.walkIn.addChild}
                    </Button>
                  </>
                }
              >
                {people.length === 0 ? <p className="ls-hint">{t.walkIn.needPeople}</p> : null}
                {options && options.services.length === 0 ? (
                  <Empty>{t.walkIn.noServices}</Empty>
                ) : null}
              </FormSection>

              {people.map((person) => (
                <FormSection
                  key={person.key}
                  title={titleOf(person)}
                  actions={
                    <>
                      <Button icon="plus" onClick={() => addLine(person.key)}>
                        {t.walkIn.addService}
                      </Button>
                      <IconButton
                        icon="trash"
                        label={fill(t.walkIn.removePersonNamed, { name: titleOf(person) })}
                        onClick={() => removePerson(person.key, titleOf(person))}
                      />
                    </>
                  }
                >
                  <FormGrid cols={2}>
                    {person.kind !== 'MEMBER' ? (
                      <Field
                        label={t.walkIn.name}
                        required
                        requiredLabel={t.common.required}
                        error={
                          checked && !person.displayName.trim() ? t.walkIn.needName : undefined
                        }
                      >
                        {(control) => (
                          <TextInput
                            {...control}
                            maxLength={200}
                            autoComplete="off"
                            value={person.displayName}
                            onChange={(event) =>
                              updatePerson(person.key, { displayName: event.target.value })
                            }
                          />
                        )}
                      </Field>
                    ) : null}
                    {person.kind === 'GUEST' ? (
                      <Field label={t.walkIn.guestPhone}>
                        {(control) => (
                          <TextInput
                            {...control}
                            type="tel"
                            inputMode="tel"
                            maxLength={24}
                            autoComplete="off"
                            value={person.phone}
                            onChange={(event) =>
                              updatePerson(person.key, { phone: event.target.value })
                            }
                          />
                        )}
                      </Field>
                    ) : null}
                    {person.kind === 'CHILD' ? (
                      <Field
                        label={t.walkIn.guardian}
                        required
                        requiredLabel={t.common.required}
                        error={
                          checked && !adultKeys.has(person.guardianKey ?? '')
                            ? t.walkIn.childNeedsAdult
                            : undefined
                        }
                      >
                        {(control) => (
                          <Select
                            {...control}
                            value={person.guardianKey ?? ''}
                            options={adults.map((adult) => ({
                              value: adult.key,
                              label: adult.displayName || t.walkIn.kinds[adult.kind],
                            }))}
                            onChange={(event) =>
                              updatePerson(person.key, { guardianKey: event.target.value })
                            }
                          />
                        )}
                      </Field>
                    ) : null}
                  </FormGrid>
                  {(linesOf.get(person.key) ?? []).map((line) => {
                    const service = serviceById.get(line.serviceId);
                    return (
                      <div key={line.key} className="ls-repeat-row">
                        <Field label={t.walkIn.chooseService}>
                          {(control) => (
                            <Select
                              {...control}
                              value={line.serviceId}
                              placeholder={t.walkIn.servicePlaceholder}
                              options={serviceOptions}
                              onChange={(event) =>
                                updateLine(line.key, {
                                  serviceId: event.target.value,
                                  staff: 'ANY',
                                })
                              }
                            />
                          )}
                        </Field>
                        <Field
                          label={t.walkIn.staff}
                          {...(service && service.employees.length === 0
                            ? { hint: t.walkIn.noQualified }
                            : {})}
                        >
                          {(control) => (
                            <Select
                              {...control}
                              value={line.staff}
                              disabled={!service}
                              options={[
                                { value: 'ANY', label: t.walkIn.anyStaff },
                                ...(service?.employees ?? []).map((employee) => ({
                                  value: employee.id,
                                  label: employee.checkedIn
                                    ? employee.displayName
                                    : fill(t.walkIn.staffNotCheckedIn, {
                                        name: employee.displayName,
                                      }),
                                })),
                              ]}
                              onChange={(event) =>
                                updateLine(line.key, { staff: event.target.value })
                              }
                            />
                          )}
                        </Field>
                        <IconButton
                          icon="trash"
                          label={
                            service
                              ? fill(t.walkIn.removeServiceNamed, {
                                  name: name(service.nameVi, service.nameEn),
                                  person: titleOf(person),
                                })
                              : t.walkIn.removeService
                          }
                          onClick={() =>
                            removeLine(
                              line,
                              service
                                ? fill(t.walkIn.serviceRemoved, {
                                    name: name(service.nameVi, service.nameEn),
                                  })
                                : t.walkIn.serviceRemovedEmpty,
                            )
                          }
                        />
                      </div>
                    );
                  })}
                </FormSection>
              ))}
              {/* Focus moves here when a submit is refused, so the reason is read first (wig :129). */}
              <div ref={messageRef} tabIndex={-1} className="ls-pos-focus-target">
                {message ? <Notice tone="error">{message}</Notice> : null}
              </div>
            </Stack>
          </Card>
          <FormActions
            note={t.walkIn.priceNote}
            primary={
              <Button
                type="submit"
                variant="primary"
                loading={pending}
                // Enabled until the request starts (wig :438): an incomplete form says what is missing on submit instead.
                disabled={!options}
              >
                {pending ? t.walkIn.creating : t.walkIn.create}
              </Button>
            }
          />
        </Stack>
      </form>
      {pendingBranch ? (
        <ConfirmDialog
          title={t.walkIn.branchChangeTitle}
          description={t.walkIn.branchChangeBody}
          tone="warning"
          confirmLabel={t.walkIn.branchChangeConfirm}
          cancelLabel={t.walkIn.branchChangeKeep}
          referenceLabel={t.errors.reference}
          describeError={() => ({ message: '', reference: null })}
          onCancel={() => setPendingBranch(null)}
          onConfirm={async () => {
            reset();
            setBranchId(pendingBranch);
            setPendingBranch(null);
          }}
        />
      ) : null}
      {finding ? (
        <MemberLookupDialog
          branchId={branchId}
          taken={taken}
          onAdd={(member) =>
            addPerson({
              kind: 'MEMBER',
              customerUserId: member.id,
              displayName: member.displayName,
              phone: '',
            })
          }
          onClose={() => setFinding(false)}
        />
      ) : null}
    </Page>
  );
}
