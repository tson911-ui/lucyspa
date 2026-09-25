'use client';

import type {
  BranchSummary,
  EmployeeResponse,
  EmployeeSkillsResponse,
  SkillListResponse,
} from '@lucy-spa/contracts';
import { useState, type FormEvent } from 'react';
import {
  assignableSkills,
  assignBlocker,
  canManageSkills,
  grantRequest,
  revokeRequest,
  skillCommands,
  skillErrorMessage,
} from '../../../lib/workforce/employee-skills';
import { formatDateTime } from '../../../lib/workforce/format';
import { runMutation } from '../../../lib/workforce/workflows';
import { useAccount, useWorkforce } from '../session';
import {
  Badge,
  Empty,
  ErrorState,
  Field,
  Loading,
  Notice,
  Section,
  SubmitButton,
  useResource,
  useSubmit,
} from '../ui';

/**
 * "Kỹ năng" on employee detail (Employee management Step 5): current qualifications,
 * removed ones (history) and assign/remove through the existing employee-skill commands.
 */
export function SkillsSection({
  employee,
  ended,
  branches,
}: {
  employee: EmployeeResponse;
  ended: boolean;
  branches: ReadonlyMap<string, BranchSummary> | null;
}) {
  const { api } = useWorkforce();
  const held = useResource(() => skillCommands.employee(api, employee.id), [api, employee.id]);
  const catalog = useResource(() => skillCommands.catalog(api), [api]);
  return (
    <SkillsView
      employee={employee}
      ended={ended}
      branches={branches}
      held={held.data}
      catalog={catalog.data}
      loading={held.loading}
      error={held.error ?? catalog.error}
      reload={async () => {
        await Promise.all([held.reload(), catalog.reload()]);
      }}
    />
  );
}

/** The skills view for loaded data (renders without a network in tests). */
export function SkillsView({
  employee,
  ended,
  branches,
  held,
  catalog,
  loading,
  error,
  reload,
}: {
  employee: EmployeeResponse;
  ended: boolean;
  branches: ReadonlyMap<string, BranchSummary> | null;
  held: EmployeeSkillsResponse | null;
  catalog: SkillListResponse | null;
  loading: boolean;
  error: unknown;
  reload: () => Promise<void>;
}) {
  const { api, t, locale } = useWorkforce();
  const { account } = useAccount();
  const texts = t.employees.skillsSection;
  const manage = canManageSkills(account, employee);
  const blocker = assignBlocker(employee, ended);
  const available = assignableSkills(catalog, held);
  const [skillId, setSkillId] = useState('');
  const [reason, setReason] = useState('');
  const submit = useSubmit();
  const name = (skill: { nameVi: string; nameEn: string }) =>
    locale === 'vi' ? skill.nameVi : skill.nameEn;
  // Grant times in the member's (first) branch timezone.
  const zone = (employee.branchIds[0] && branches?.get(employee.branchIds[0])?.timezone) || 'UTC';

  async function grant(event: FormEvent) {
    event.preventDefault();
    if (skillId === '') return;
    const ok = await submit.run(
      () =>
        runMutation(
          () => skillCommands.grant(api, employee.id, grantRequest(skillId, reason)),
          reload,
        ),
      texts.assigned,
    );
    if (ok) {
      setSkillId('');
      setReason('');
      await reload();
    }
  }

  async function revoke(id: string) {
    const ok = await submit.run(
      () =>
        runMutation(
          () => skillCommands.revoke(api, employee.id, id, revokeRequest(reason)),
          reload,
        ),
      texts.removed,
    );
    if (ok) {
      setReason('');
      await reload();
    }
  }

  return (
    <Section title={t.employees.skills}>
      <p className="wf-muted">{texts.intro}</p>
      {loading && !held ? <Loading t={t} /> : null}
      {error ? <ErrorState error={error} t={t} onRetry={() => void reload()} /> : null}
      {submit.error ? <Notice tone="error">{skillErrorMessage(submit.error, t)}</Notice> : null}
      {submit.success ? <Notice tone="success">{submit.success}</Notice> : null}
      <h3>{texts.current}</h3>
      {held && held.skills.length === 0 ? <Empty>{t.employees.noSkills}</Empty> : null}
      <ul className="wf-plain-list">
        {held?.skills.map((entry) => (
          <li key={entry.skill.id} className="wf-list-row">
            <span>
              <strong>{name(entry.skill)}</strong>{' '}
              <span className="wf-muted wf-small">({entry.skill.code})</span>{' '}
              <Badge tone="success">{texts.active}</Badge>{' '}
              <span className="wf-muted wf-small">
                {texts.since} {formatDateTime(entry.grantedAt, zone, locale)}
              </span>
              {!entry.skill.isActive ? (
                <span className="wf-muted wf-small"> — {texts.skillOff}</span>
              ) : null}
            </span>
            {manage ? (
              <button
                type="button"
                className="wf-button wf-button-quiet"
                disabled={submit.pending}
                onClick={() => void revoke(entry.skill.id)}
              >
                {t.employees.revokeSkill}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {manage ? (
        <form className="wf-form wf-member-form" onSubmit={(event) => void grant(event)}>
          <Field id="skill-reason" label={t.common.reasonOptional} hint={texts.reasonHint}>
            <input
              id="skill-reason"
              maxLength={500}
              aria-describedby="skill-reason-hint"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
          {blocker ? (
            <Notice tone="warning">{blocker === 'ended' ? texts.ended : texts.inactive}</Notice>
          ) : catalog && catalog.skills.filter((skill) => skill.isActive).length === 0 ? (
            <Notice tone="info">{texts.emptyCatalog}</Notice>
          ) : catalog && available.length === 0 ? (
            <p className="wf-hint">{texts.allHeld}</p>
          ) : (
            <div className="wf-filters">
              <Field id="grant-skill" label={texts.assign} required>
                <select
                  id="grant-skill"
                  required
                  value={skillId}
                  onChange={(event) => setSkillId(event.target.value)}
                >
                  <option value="" disabled>
                    —
                  </option>
                  {available.map((skill) => (
                    <option key={skill.id} value={skill.id}>
                      {name(skill)} ({skill.code})
                    </option>
                  ))}
                </select>
              </Field>
              <SubmitButton
                pending={submit.pending}
                label={texts.assign}
                pendingLabel={t.common.saving}
                disabled={skillId === ''}
              />
            </div>
          )}
        </form>
      ) : null}
      {held && held.history.length > 0 ? (
        <>
          <h3>{texts.history}</h3>
          <ul className="wf-plain-list">
            {held.history.map((entry, index) => (
              <li key={`${entry.skill.id}-${index}`} className="wf-muted">
                {name(entry.skill)} ({entry.skill.code}) ·{' '}
                {formatDateTime(entry.grantedAt, zone, locale)} –{' '}
                {formatDateTime(entry.revokedAt, zone, locale)}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </Section>
  );
}
