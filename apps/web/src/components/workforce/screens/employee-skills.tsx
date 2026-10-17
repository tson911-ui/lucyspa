'use client';

import type {
  BranchSummary,
  EmployeeResponse,
  EmployeeSkillEntry,
  EmployeeSkillHistoryEntry,
  EmployeeSkillsResponse,
  SkillListResponse,
} from '@lucy-spa/contracts';
import {
  ConfirmDialog,
  DataTable,
  Field,
  FormDialog,
  FormGrid,
  ListSection,
  RowActions,
  Select,
  Stack,
  TextInput,
  useUrlState,
  type DataTableColumn,
} from '@lucy-spa/ui';
import { useState } from 'react';
import { organizationDictionary } from '../../../i18n/organization';
import { fill } from '../../../i18n/workforce';
import {
  assignableSkills,
  assignBlocker,
  canManageSkills,
  grantRequest,
  revokeRequest,
  skillCommands,
  skillErrorMessage,
} from '../../../lib/workforce/employee-skills';
import { ApiError } from '../../../lib/workforce/api';
import { formOverlayLabels } from '../../../lib/workforce/form-labels';
import { formatDateTime } from '../../../lib/workforce/format';
import { normalizePage, paginationLabels } from '../../../lib/workforce/list-view';
import { runMutation } from '../../../lib/workforce/workflows';
import { opensInput } from '../../../lib/workforce/opens-input';
import { useAccount, useWorkforce } from '../session';
import {
  Badge,
  Button,
  Empty,
  ErrorState,
  Loading,
  Notice,
  useResource,
  useSubmit,
  useSuccessToast,
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

/** The removed-skills page lives in the address bar (`?shp=`), its own key beside the branch-history pager (`?bhp=`). */
const SKILL_HISTORY_DEFAULTS = { shp: 1 };
const SKILL_HISTORY_OPTIONS = {
  normalize: (state: typeof SKILL_HISTORY_DEFAULTS) => ({ shp: normalizePage(state.shp) }),
};

type Overlay = { kind: 'grant' } | { kind: 'revoke'; entry: EmployeeSkillEntry };

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
  const { t, locale } = useWorkforce();
  const { account } = useAccount();
  const notify = useSuccessToast();
  const texts = t.employees.skillsSection;
  const manage = canManageSkills(account, employee);
  const blocker = assignBlocker(employee, ended);
  const available = assignableSkills(catalog, held);
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [{ shp: historyPage }, updateHistory] = useUrlState(
    SKILL_HISTORY_DEFAULTS,
    SKILL_HISTORY_OPTIONS,
  );
  const name = (skill: { nameVi: string; nameEn: string }) =>
    locale === 'vi' ? skill.nameVi : skill.nameEn;
  // Grant times in the member's (first) branch timezone.
  const zone = (employee.branchIds[0] && branches?.get(employee.branchIds[0])?.timezone) || 'UTC';
  const emptyCatalog =
    catalog !== null && catalog.skills.filter((skill) => skill.isActive).length === 0;
  const showGrant = manage && !blocker && !emptyCatalog && catalog !== null;

  const finish = (message: string) => {
    setOverlay(null);
    notify(message);
  };

  // Name first, the code as a muted second line (no parenthesised code squeezed beside the name).
  const skillCell = (skill: EmployeeSkillEntry['skill']) => (
    <span className="ls-cell-stack">
      <span className="ls-cell-main">{name(skill)}</span>
      <span className="ls-cell-sub" translate="no">
        {skill.code}
      </span>
    </span>
  );
  const columns: DataTableColumn<EmployeeSkillEntry>[] = [
    {
      key: 'skill',
      header: t.employees.skills,
      mobileTitle: true,
      wrap: true,
      width: 'lg',
      cell: (entry) => skillCell(entry.skill),
    },
    {
      key: 'status',
      header: t.common.status,
      cell: (entry) => (
        <span className="ls-cell-stack">
          <Badge tone="success">{texts.active}</Badge>
          {!entry.skill.isActive ? <span className="ls-cell-sub">{texts.skillOff}</span> : null}
        </span>
      ),
    },
    {
      key: 'since',
      header: texts.since,
      hideBelow: 'md',
      cell: (entry) => formatDateTime(entry.grantedAt, zone, locale),
    },
    ...(manage
      ? [
          {
            key: 'actions',
            header: t.common.actions,
            actions: true,
            cell: (entry: EmployeeSkillEntry) => (
              <RowActions
                menuLabel={fill(t.common.list.actionsFor, { name: name(entry.skill) })}
                items={[
                  {
                    id: 'revoke',
                    label: opensInput(t.employees.revokeSkill),
                    tone: 'danger',
                    onSelect: () => setOverlay({ kind: 'revoke', entry }),
                  },
                ]}
              />
            ),
          },
        ]
      : []),
  ];
  const historyColumns: DataTableColumn<EmployeeSkillHistoryEntry>[] = [
    {
      key: 'skill',
      header: t.employees.skills,
      mobileTitle: true,
      wrap: true,
      width: 'lg',
      cell: (entry) => skillCell(entry.skill),
    },
    {
      key: 'granted',
      header: texts.since,
      cell: (entry) => formatDateTime(entry.grantedAt, zone, locale),
    },
    {
      key: 'revoked',
      header: t.employees.revokedAt,
      cell: (entry) => formatDateTime(entry.revokedAt, zone, locale),
    },
  ];

  return (
    <>
      <Stack gap="page">
        {error ? <ErrorState error={error} t={t} onRetry={() => void reload()} /> : null}
        {manage && blocker ? (
          <Notice tone="warning">{blocker === 'ended' ? texts.ended : texts.inactive}</Notice>
        ) : null}
        {manage && !blocker && emptyCatalog ? (
          <Notice tone="info">{texts.emptyCatalog}</Notice>
        ) : null}
        {/* The tab is named "Kỹ năng"; the section says what it lists (current skills), beside "Lịch sử" below. */}
        <ListSection
          title={texts.current}
          actions={
            showGrant ? (
              <Button
                variant="secondary"
                icon="plus"
                disabled={available.length === 0}
                onClick={() => setOverlay({ kind: 'grant' })}
              >
                {opensInput(texts.assign)}
              </Button>
            ) : undefined
          }
        >
          <p className="ls-hint">{texts.intro}</p>
          {showGrant && available.length === 0 ? <p className="ls-hint">{texts.allHeld}</p> : null}
          {loading && !held ? <Loading t={t} /> : null}
          <DataTable
            mode="client"
            caption={texts.current}
            columns={columns}
            rows={held?.skills ?? []}
            rowKey={(entry) => entry.skill.id}
            empty={
              held ? (
                <Empty title={organizationDictionary(locale).people.noSkillsTitle}>
                  {t.employees.noSkills}
                </Empty>
              ) : undefined
            }
            paging={{ off: 'The catalog is short: a member holds a few dozen skills at most.' }}
          />
        </ListSection>
        {held && held.history.length > 0 ? (
          <ListSection title={texts.history}>
            <DataTable
              mode="client"
              caption={texts.history}
              columns={historyColumns}
              rows={held.history}
              rowKey={(entry) => `${entry.skill.id}-${entry.revokedAt}`}
              paging={{
                page: historyPage,
                pageSize: 20,
                onPageChange: (page) => updateHistory({ shp: page }),
                labels: paginationLabels(t, texts.history),
              }}
            />
          </ListSection>
        ) : null}
      </Stack>
      {overlay?.kind === 'grant' ? (
        <GrantSkillDialog
          employee={employee}
          available={available}
          reload={reload}
          onClose={() => setOverlay(null)}
          onDone={finish}
        />
      ) : null}
      {overlay?.kind === 'revoke' ? (
        <RevokeSkillDialog
          employee={employee}
          entry={overlay.entry}
          reload={reload}
          onClose={() => setOverlay(null)}
          onDone={finish}
        />
      ) : null}
    </>
  );
}

/** Give the member one skill from the active catalog; the reason is optional. */
export function GrantSkillDialog({
  employee,
  available,
  reload,
  onClose,
  onDone,
}: {
  employee: EmployeeResponse;
  available: ReturnType<typeof assignableSkills>;
  reload: () => Promise<void>;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const { api, t, locale } = useWorkforce();
  const texts = t.employees.skillsSection;
  const [skillId, setSkillId] = useState('');
  const [reason, setReason] = useState('');
  const submit = useSubmit();

  // Validate on submit: the button stays enabled and an empty choice says so at the field.
  const [tried, setTried] = useState(false);

  async function save() {
    if (skillId === '') {
      setTried(true);
      return;
    }
    const ok = await submit.run(
      () =>
        runMutation(
          () => skillCommands.grant(api, employee.id, grantRequest(skillId, reason)),
          reload,
        ),
      '',
    );
    if (ok) {
      await reload();
      onDone(texts.assigned);
    }
  }

  return (
    <FormDialog
      title={texts.assign}
      labels={formOverlayLabels(t, texts.assign)}
      busy={submit.pending}
      dirty={skillId !== '' || reason !== ''}
      error={
        submit.error ? (
          <Notice tone="error">{skillErrorMessage(submit.error, t)}</Notice>
        ) : undefined
      }
      onClose={onClose}
      onSubmit={save}
    >
      <FormGrid>
        <Field
          label={t.employees.skills}
          required
          error={tried && skillId === '' ? t.common.form.choiceRequired : undefined}
        >
          {(control) => (
            <Select
              {...control}
              placeholder={t.common.form.choose}
              value={skillId}
              onChange={(event) => setSkillId(event.target.value)}
              options={available.map((skill) => ({
                value: skill.id,
                label: `${locale === 'vi' ? skill.nameVi : skill.nameEn} (${skill.code})`,
              }))}
            />
          )}
        </Field>
        <Field label={t.common.reasonOptional} hint={texts.reasonHint}>
          {(control) => (
            <TextInput
              {...control}
              name="reason"
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          )}
        </Field>
      </FormGrid>
    </FormDialog>
  );
}

/** Remove a skill: the grant moves to the history, nothing is deleted. */
export function RevokeSkillDialog({
  employee,
  entry,
  reload,
  onClose,
  onDone,
}: {
  employee: EmployeeResponse;
  entry: EmployeeSkillEntry;
  reload: () => Promise<void>;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const { api, t, locale } = useWorkforce();
  const texts = t.employees.skillsSection;
  const skill = entry.skill;
  return (
    <ConfirmDialog
      title={t.employees.detail.revokeSkillTitle}
      description={t.employees.detail.revokeSkillBody}
      facts={[
        {
          label: t.employees.skills,
          value: `${locale === 'vi' ? skill.nameVi : skill.nameEn} (${skill.code})`,
        },
        { label: t.common.name, value: employee.fullName },
      ]}
      tone="danger"
      confirmLabel={t.employees.revokeSkill}
      busyLabel={t.common.removing}
      cancelLabel={t.common.cancel}
      referenceLabel={t.errors.reference}
      reasonField={{ label: t.common.reasonOptional, hint: texts.reasonHint }}
      describeError={(error) => ({
        message: skillErrorMessage(error, t),
        reference: error instanceof ApiError ? error.requestId : null,
      })}
      onCancel={onClose}
      onConfirm={async (reason) => {
        const outcome = await runMutation(
          () => skillCommands.revoke(api, employee.id, skill.id, revokeRequest(reason ?? '')),
          reload,
        );
        if (!outcome.ok) throw outcome.error;
        await reload();
        onDone(texts.removed);
      }}
    />
  );
}
