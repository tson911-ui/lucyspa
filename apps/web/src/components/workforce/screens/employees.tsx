'use client';

import type {
  EmployeeDirectoryEntry,
  EmployeeDirectoryResponse,
  EmployeeResponse,
  EmployeeStatus,
  InitialEmploymentClassification,
} from '@lucy-spa/contracts';
import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { fill } from '../../../i18n/workforce';
import {
  canOfferCreate,
  classificationText,
  directoryClassification,
} from '../../../lib/workforce/employee-create';
import { branchLabel, useBranches } from '../data';
import { useAccount, useWorkforce } from '../session';
import {
  Badge,
  Empty,
  ErrorState,
  Field,
  Loading,
  Notice,
  PageHeader,
  Section,
  type Tone,
} from '../ui';
import { EmployeeCreateForm } from './employee-create';

const STATUSES: EmployeeStatus[] = ['ACTIVE', 'PENDING_SETUP', 'INACTIVE'];
const NO_FILTERS = { q: '', branchId: '', status: '' };
export const EMPLOYEE_STATUS_TONE: Record<EmployeeStatus, Tone> = {
  ACTIVE: 'success',
  PENDING_SETUP: 'warning',
  INACTIVE: 'neutral',
};

/**
 * Employee directory (VIEW_EMPLOYEES scope, enforced by the API before paging) and the
 * "Add workforce member" action for accounts with CREATE_EMPLOYEES.
 */
export function EmployeesScreen() {
  const { api, t, base, locale } = useWorkforce();
  const { account } = useAccount();
  const branches = useBranches(api);
  const offerCreate = canOfferCreate(account);
  const [adding, setAdding] = useState(false);
  const [created, setCreated] = useState<CreatedMember | null>(null);
  const [filters, setFilters] = useState(NO_FILTERS);
  const [applied, setApplied] = useState(filters);
  const [items, setItems] = useState<EmployeeDirectoryEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(
    async (after: string | null) => {
      setLoading(true);
      setError(null);
      try {
        const page = await api.get<EmployeeDirectoryResponse>('/api/v1/employees', {
          q: applied.q.trim() || undefined,
          branchId: applied.branchId || undefined,
          status: applied.status || undefined,
          cursor: after ?? undefined,
          limit: 50,
        });
        setItems((current) => (after ? [...current, ...page.items] : page.items));
        setCursor(page.nextCursor);
      } catch (failure) {
        setError(failure);
      } finally {
        setLoading(false);
      }
    },
    [api, applied],
  );

  useEffect(() => {
    void load(null);
  }, [load]);

  function search(event: FormEvent) {
    event.preventDefault();
    setApplied(filters);
  }

  function onCreated(employee: EmployeeResponse, classification: InitialEmploymentClassification) {
    setAdding(false);
    setCreated({ employee, classification });
    // Show the whole directory again so the new member is listed.
    setFilters(NO_FILTERS);
    setApplied({ ...NO_FILTERS });
  }

  return (
    <>
      <PageHeader title={t.employees.title}>
        {offerCreate && !adding ? (
          <button
            type="button"
            className="wf-button wf-button-primary"
            aria-controls="add-workforce-member"
            aria-expanded={false}
            onClick={() => {
              setCreated(null);
              setAdding(true);
            }}
          >
            {t.employees.add}
          </button>
        ) : null}
      </PageHeader>
      {created ? <CreatedNotice {...created} /> : null}
      {offerCreate && adding ? (
        <div id="add-workforce-member">
          <Section title={t.employees.create.title}>
            {branches.error ? (
              <ErrorState error={branches.error} t={t} onRetry={() => void branches.reload()} />
            ) : branches.data ? (
              <EmployeeCreateForm
                branches={branches.data}
                onCreated={onCreated}
                onCancel={() => setAdding(false)}
              />
            ) : (
              <Loading t={t} />
            )}
          </Section>
        </div>
      ) : null}
      <Section title={t.common.search}>
        <form className="wf-filters" role="search" onSubmit={search}>
          <Field id="emp-q" label={t.employees.search}>
            <input
              id="emp-q"
              type="search"
              maxLength={100}
              value={filters.q}
              onChange={(event) => setFilters({ ...filters, q: event.target.value })}
            />
          </Field>
          <Field id="emp-branch" label={t.employees.branchFilter}>
            <select
              id="emp-branch"
              value={filters.branchId}
              onChange={(event) => setFilters({ ...filters, branchId: event.target.value })}
            >
              <option value="">{t.common.all}</option>
              {[...(branches.data?.values() ?? [])].map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          </Field>
          <Field id="emp-status" label={t.employees.statusFilter}>
            <select
              id="emp-status"
              value={filters.status}
              onChange={(event) => setFilters({ ...filters, status: event.target.value })}
            >
              <option value="">{t.common.all}</option>
              {STATUSES.map((status) => (
                <option key={status} value={status}>
                  {t.employees.statuses[status]}
                </option>
              ))}
            </select>
          </Field>
          <button type="submit" className="wf-button">
            {t.common.search}
          </button>
        </form>
      </Section>
      <Section title={t.employees.title}>
        {error ? <ErrorState error={error} t={t} onRetry={() => void load(null)} /> : null}
        {!loading && !error && items.length === 0 ? <Empty>{t.common.empty}</Empty> : null}
        {items.length > 0 ? (
          <table className="wf-table">
            <thead>
              <tr>
                <th scope="col">{t.employees.employeeId}</th>
                <th scope="col">{t.employees.fullName}</th>
                <th scope="col">{t.common.branch}</th>
                <th scope="col">{t.employees.classification}</th>
                <th scope="col">{t.common.status}</th>
                <th scope="col">{t.common.actions}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((employee) => (
                <tr key={employee.id}>
                  <td data-label={t.employees.employeeId}>{employee.employeeId}</td>
                  <td data-label={t.employees.fullName}>{employee.fullName}</td>
                  <td data-label={t.common.branch}>
                    {employee.branchIds.map((id) => branchLabel(id, branches.data, t)).join(', ') ||
                      '—'}
                  </td>
                  <td data-label={t.employees.classification}>
                    {directoryClassification(employee, branches.data, t, locale)}
                  </td>
                  <td data-label={t.common.status}>
                    <Badge tone={EMPLOYEE_STATUS_TONE[employee.status]}>
                      {t.employees.statuses[employee.status]}
                    </Badge>
                  </td>
                  <td data-label={t.common.actions}>
                    <Link href={`${base}/employees/${employee.id}`}>{t.common.details}</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        {loading ? <Loading t={t} /> : null}
        {cursor && !loading ? (
          <button type="button" className="wf-button" onClick={() => void load(cursor)}>
            {t.common.loadMore}
          </button>
        ) : null}
      </Section>
    </>
  );
}

interface CreatedMember {
  employee: EmployeeResponse;
  classification: InitialEmploymentClassification;
}

/** Success after creation: who was created, as what, and that sign-in is not yet granted. */
export function CreatedNotice({ employee, classification }: CreatedMember) {
  const { t, base } = useWorkforce();
  return (
    <Notice tone="success">
      <p>
        {fill(
          employee.status === 'ACTIVE'
            ? t.employees.create.createdWithAccess
            : t.employees.create.created,
          {
            name: employee.fullName,
            code: employee.employeeId,
            classification: classificationText(classification, t),
          },
        )}
      </p>
      <Link href={`${base}/employees/${employee.id}`}>{t.employees.create.viewCreated}</Link>
    </Notice>
  );
}
