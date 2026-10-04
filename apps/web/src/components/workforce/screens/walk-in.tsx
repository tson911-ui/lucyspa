'use client';

import type { WalkInOptionsResponse, WalkInVisitResponse } from '@lucy-spa/contracts';
import {
  Button,
  buttonClass,
  Card,
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
  useUnsavedChangesGuard,
} from '@lucy-spa/ui';
import { PrefetchLink as Link } from '../link';
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
import { Badge, Empty, Loading, Notice, PageHeader } from '../ui';
import { MemberLookupDialog } from './walk-in-lookup';

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
  const [finding, setFinding] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [result, setResult] = useState<WalkInVisitResponse | null>(null);
  // One key per intake: retries of the same submission replay the same visit.
  const idempotencyKey = useRef<string>('');
  useEffect(() => {
    idempotencyKey.current = '';
  }, [people, lines, branchId]);
  useUnsavedChangesGuard(people.length > 0 && !pending && result === null);

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
    setResult(null);
    setMessage(null);
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
                headingLevel={3}
                clamp
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
              </Stack>
            </Card>
          ))}
        </Grid>
      </>
    );
  }

  const adults = guardians(people);
  const serviceById = new Map((options?.services ?? []).map((service) => [service.id, service]));
  const taken = new Set(
    people.flatMap((person) => (person.customerUserId ? [person.customerUserId] : [])),
  );
  return (
    <Page width="form">
      <PageHeader title={t.walkIn.title} intro={t.walkIn.intro} />
      {optionsError ? <Notice tone="error">{boardErrorMessage(optionsError, t)}</Notice> : null}
      {!options && !optionsError ? <Loading t={t} /> : null}
      <form noValidate onSubmit={(event) => void submit(event)} aria-label={t.walkIn.title}>
        <Stack gap="block">
          <Card>
            <Stack gap="page">
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
                      onChange={(event) => (reset(), setBranchId(event.target.value))}
                    />
                  )}
                </Field>
              </FormGrid>

              <FormSection
                title={t.walkIn.people}
                actions={
                  <>
                    <Button icon="search" onClick={() => setFinding(true)}>
                      {t.walkIn.lookupTitle}
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
                {people.length === 0 ? <Empty>{t.walkIn.needPeople}</Empty> : null}
                {options && options.services.length === 0 ? (
                  <Empty>{t.walkIn.noServices}</Empty>
                ) : null}
              </FormSection>

              {people.map((person) => (
                <FormSection
                  key={person.key}
                  title={`${t.walkIn.kinds[person.kind]}${person.kind === 'MEMBER' ? `: ${person.displayName}` : ''}`}
                  actions={
                    <>
                      <Button icon="plus" onClick={() => addLine(person.key)}>
                        {t.walkIn.addService}
                      </Button>
                      <IconButton
                        icon="trash"
                        label={t.walkIn.removePerson}
                        onClick={() => removePerson(person.key)}
                      />
                    </>
                  }
                >
                  <FormGrid cols={2}>
                    {person.kind !== 'MEMBER' ? (
                      <Field label={t.walkIn.name} required requiredLabel={t.common.required}>
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
                      <Field label={t.walkIn.guardian} required requiredLabel={t.common.required}>
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
                  {lines
                    .filter((line) => line.participantKey === person.key)
                    .map((line) => {
                      const service = serviceById.get(line.serviceId);
                      return (
                        <div key={line.key} className="ls-repeat-row">
                          <Field label={t.walkIn.chooseService}>
                            {(control) => (
                              <Select
                                {...control}
                                value={line.serviceId}
                                placeholder={t.walkIn.servicePlaceholder}
                                options={(options?.services ?? []).map((entry) => ({
                                  value: entry.id,
                                  label: `${name(entry.nameVi, entry.nameEn)} · ${entry.durationMinutes}′`,
                                }))}
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
                                    label: `${employee.displayName}${employee.checkedIn ? '' : ` ${t.walkIn.notCheckedIn}`}`,
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
                            label={t.walkIn.removeService}
                            onClick={() =>
                              setLines((current) =>
                                current.filter((entry) => entry.key !== line.key),
                              )
                            }
                          />
                        </div>
                      );
                    })}
                </FormSection>
              ))}
              {message ? <Notice tone="error">{message}</Notice> : null}
            </Stack>
          </Card>
          <FormActions
            note={t.walkIn.priceNote}
            primary={
              <Button
                type="submit"
                variant="primary"
                loading={pending}
                disabled={!options || people.length === 0}
              >
                {pending ? t.walkIn.creating : t.walkIn.create}
              </Button>
            }
          />
        </Stack>
      </form>
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
