'use client';

import type { SkillListResponse, SkillResponse } from '@lucy-spa/contracts';
import { useState, type FormEvent } from 'react';
import { canGlobal } from '../../../lib/workforce/permissions';
import { runMutation } from '../../../lib/workforce/workflows';
import { useAccount, useWorkforce } from '../session';
import {
  Badge,
  Empty,
  ErrorState,
  Field,
  FormFeedback,
  Loading,
  PageHeader,
  Section,
  SubmitButton,
  useResource,
  useSubmit,
} from '../ui';

/** Skill catalog: GLOBAL MANAGE_SKILLS creates, renames and (de)activates skills. */
export function SkillsScreen() {
  const { api, t } = useWorkforce();
  const { account } = useAccount();
  const manage = canGlobal(account, 'MANAGE_SKILLS');
  const skills = useResource(() => api.get<SkillListResponse>('/api/v1/skills'), [api]);

  return (
    <>
      <PageHeader title={t.skills.title} />
      {manage ? <SkillCreate reload={skills.reload} /> : null}
      <Section title={t.skills.title}>
        {skills.loading ? <Loading t={t} /> : null}
        {skills.error ? (
          <ErrorState error={skills.error} t={t} onRetry={() => void skills.reload()} />
        ) : null}
        {skills.data && skills.data.skills.length === 0 ? <Empty>{t.common.empty}</Empty> : null}
        {skills.data && skills.data.skills.length > 0 ? (
          <table className="wf-table">
            <thead>
              <tr>
                <th scope="col">{t.common.code}</th>
                <th scope="col">{t.skills.nameVi}</th>
                <th scope="col">{t.skills.nameEn}</th>
                <th scope="col">{t.common.status}</th>
                {manage ? <th scope="col">{t.common.actions}</th> : null}
              </tr>
            </thead>
            <tbody>
              {skills.data.skills.map((skill) => (
                <tr key={skill.id}>
                  <td data-label={t.common.code}>{skill.code}</td>
                  <td data-label={t.skills.nameVi}>{skill.nameVi}</td>
                  <td data-label={t.skills.nameEn}>{skill.nameEn}</td>
                  <td data-label={t.common.status}>
                    <Badge tone={skill.isActive ? 'success' : 'neutral'}>
                      {skill.isActive ? t.common.active : t.common.inactive}
                    </Badge>
                  </td>
                  {manage ? (
                    <td data-label={t.common.actions}>
                      <SkillEdit skill={skill} reload={skills.reload} />
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </Section>
    </>
  );
}

function SkillCreate({ reload }: { reload: () => Promise<void> }) {
  const { api, t } = useWorkforce();
  const empty = { code: '', nameVi: '', nameEn: '' };
  const [form, setForm] = useState(empty);
  const submit = useSubmit();

  async function save(event: FormEvent) {
    event.preventDefault();
    const ok = await submit.run(
      () => runMutation(() => api.post('/api/v1/skills', form), reload),
      t.skills.created,
    );
    if (ok) {
      setForm(empty);
      await reload();
    }
  }

  return (
    <Section title={t.skills.create}>
      <details className="wf-disclosure">
        <summary>{t.skills.create}</summary>
        <form className="wf-form" onSubmit={(event) => void save(event)}>
          <Field id="skill-code" label={t.common.code} required>
            <input
              id="skill-code"
              required
              maxLength={64}
              value={form.code}
              onChange={(event) => setForm({ ...form, code: event.target.value })}
            />
          </Field>
          <div className="wf-row">
            <Field id="skill-vi" label={t.skills.nameVi} required>
              <input
                id="skill-vi"
                required
                maxLength={200}
                value={form.nameVi}
                onChange={(event) => setForm({ ...form, nameVi: event.target.value })}
              />
            </Field>
            <Field id="skill-en" label={t.skills.nameEn} required>
              <input
                id="skill-en"
                required
                maxLength={200}
                value={form.nameEn}
                onChange={(event) => setForm({ ...form, nameEn: event.target.value })}
              />
            </Field>
          </div>
          <FormFeedback error={submit.error} success={submit.success} t={t} />
          <SubmitButton
            pending={submit.pending}
            label={t.common.create}
            pendingLabel={t.common.saving}
          />
        </form>
      </details>
    </Section>
  );
}

function SkillEdit({ skill, reload }: { skill: SkillResponse; reload: () => Promise<void> }) {
  const { api, t } = useWorkforce();
  const [form, setForm] = useState({ nameVi: skill.nameVi, nameEn: skill.nameEn, reason: '' });
  const submit = useSubmit();
  const id = `skill-${skill.id}`;

  async function rename(event: FormEvent) {
    event.preventDefault();
    const ok = await submit.run(
      () =>
        runMutation(
          () =>
            api.post(`/api/v1/skills/${skill.id}`, {
              expectedVersion: skill.version,
              ...(form.nameVi !== skill.nameVi ? { nameVi: form.nameVi } : {}),
              ...(form.nameEn !== skill.nameEn ? { nameEn: form.nameEn } : {}),
            }),
          reload,
        ),
      t.common.saved,
    );
    if (ok) await reload();
  }

  async function toggle() {
    const ok = await submit.run(
      () =>
        runMutation(
          () =>
            api.post(`/api/v1/skills/${skill.id}/status`, {
              expectedVersion: skill.version,
              isActive: !skill.isActive,
              reason: form.reason,
            }),
          reload,
        ),
      t.common.saved,
    );
    if (ok) await reload();
  }

  return (
    <details className="wf-disclosure">
      <summary>{t.common.edit}</summary>
      <form className="wf-inline-form" onSubmit={(event) => void rename(event)}>
        <Field id={`${id}-vi`} label={t.skills.nameVi} required>
          <input
            id={`${id}-vi`}
            required
            maxLength={200}
            value={form.nameVi}
            onChange={(event) => setForm({ ...form, nameVi: event.target.value })}
          />
        </Field>
        <Field id={`${id}-en`} label={t.skills.nameEn} required>
          <input
            id={`${id}-en`}
            required
            maxLength={200}
            value={form.nameEn}
            onChange={(event) => setForm({ ...form, nameEn: event.target.value })}
          />
        </Field>
        <SubmitButton
          pending={submit.pending}
          label={t.common.save}
          pendingLabel={t.common.saving}
          disabled={form.nameVi === skill.nameVi && form.nameEn === skill.nameEn}
        />
        <Field id={`${id}-reason`} label={t.common.reason}>
          <input
            id={`${id}-reason`}
            maxLength={500}
            value={form.reason}
            onChange={(event) => setForm({ ...form, reason: event.target.value })}
          />
        </Field>
        <button
          type="button"
          className="wf-button wf-button-quiet"
          disabled={submit.pending || form.reason.trim() === ''}
          onClick={() => void toggle()}
        >
          {skill.isActive ? t.common.deactivate : t.common.activate}
        </button>
        <FormFeedback error={submit.error} success={submit.success} t={t} />
      </form>
    </details>
  );
}
