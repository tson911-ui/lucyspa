'use client';

import type {
  RewardEntitlementResponse,
  RewardIssueOptionsResponse,
  RewardUseResponse,
} from '@lucy-spa/contracts';
import {
  ConfirmDialog,
  DataTable,
  DescriptionList,
  Dialog,
  Field,
  FormDialog,
  FormGrid,
  NumberInput,
  Select,
  Textarea,
  type DataTableColumn,
} from '@lucy-spa/ui';
import { useState } from 'react';
import { rewardDictionary } from '../../../i18n/reward';
import { fill } from '../../../i18n/workforce';
import { confirmError, formOverlayLabels } from '../../../lib/workforce/form-labels';
import { formatDateTime } from '../../../lib/workforce/format';
import { paginationLabels } from '../../../lib/workforce/list-view';
import {
  emptyIssueDraft,
  expiryText,
  issueRequest,
  rewardErrorText,
  rewardName,
  statusTone,
  validateIssueDraft,
  type IssueDraft,
  type RewardIssue,
} from '../../../lib/workforce/reward';
import { errorMessage } from '../../../lib/workforce/workflows';
import { useWorkforce } from '../session';
import { Badge, Button, Empty, Notice, useResource } from '../ui';

const ZONE = 'Asia/Ho_Chi_Minh';

/**
 * Grants a reward to the customer (Phase 5 P5-9, `ISSUE_REWARDS` at the branch): the reward, the quantity and a written reason.
 * A short form, so a dialog. The reward list is the active part of the catalog; nothing is preselected.
 */
export function IssueRewardDialog({
  branchId,
  customerId,
  onDone,
  onClose,
}: {
  branchId: string;
  customerId: string;
  onDone: () => void;
  onClose: () => void;
}) {
  const { api, t, locale } = useWorkforce();
  const r = rewardDictionary(locale);
  const d = r.desk.issueDialog;
  const options = useResource(
    () => api.get<RewardIssueOptionsResponse>(`/api/v1/rewards/branches/${branchId}/options`),
    [api, branchId],
  );
  const [draft, setDraft] = useState<IssueDraft>(emptyIssueDraft);
  const [checked, setChecked] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errors = validateIssueDraft(draft);
  const set = (patch: Partial<IssueDraft>) => setDraft((state) => ({ ...state, ...patch }));
  const issueText = (issue: RewardIssue | undefined) =>
    checked && issue ? (issue === 'required' ? d.required : d.invalid) : undefined;
  const items = options.data?.items ?? [];
  const chosen = items.find((item) => item.id === draft.catalogItemId);

  async function submit() {
    if (pending) return;
    setChecked(true);
    setError(null);
    const body = issueRequest(draft);
    if (!body) return;
    setPending(true);
    try {
      await api.post(
        `/api/v1/rewards/branches/${branchId}/customers/${customerId}/entitlements`,
        body,
      );
      onDone();
    } catch (failure) {
      setError(rewardErrorText(failure, locale, (cause) => errorMessage(cause, t)));
      setPending(false);
    }
  }

  const loaded = options.data !== null && options.data !== undefined;
  return (
    <FormDialog
      title={d.title}
      description={d.description}
      labels={{ ...formOverlayLabels(t, d.submit), submitting: d.submitting }}
      busy={pending}
      dirty={draft.catalogItemId !== '' || draft.reason !== ''}
      submitDisabled={!loaded || items.length === 0}
      error={error ? <Notice tone="error">{error}</Notice> : undefined}
      onClose={onClose}
      onSubmit={submit}
    >
      <FormGrid>
        <Field
          label={d.item}
          hint={
            loaded && items.length === 0
              ? d.noItems
              : chosen
                ? chosen.expiryDays === null
                  ? d.expiryNone
                  : fill(d.expiryDays, { n: chosen.expiryDays })
                : undefined
          }
          error={issueText(errors.catalogItemId)}
          required
          full
        >
          {(control) => (
            <Select
              {...control}
              value={draft.catalogItemId}
              placeholder={d.itemPlaceholder}
              options={items.map((item) => ({
                value: item.id,
                label: `${rewardName(item, locale)} · ${r.kind[item.kind]}`,
              }))}
              onChange={(event) => set({ catalogItemId: event.target.value })}
            />
          )}
        </Field>
        <Field label={d.quantity} error={issueText(errors.quantity)} width="sm" required>
          {(control) => (
            <NumberInput
              {...control}
              inputMode="numeric"
              min={1}
              max={50}
              value={draft.quantity}
              onChange={(event) => set({ quantity: event.target.value })}
            />
          )}
        </Field>
        <Field label={d.reason} hint={d.reasonHint} error={issueText(errors.reason)} required full>
          {(control) => (
            <Textarea
              {...control}
              rows={3}
              maxLength={500}
              value={draft.reason}
              onChange={(event) => set({ reason: event.target.value })}
            />
          )}
        </Field>
      </FormGrid>
    </FormDialog>
  );
}

/** Marks one unit as used, with an optional note. No invoice line, no points (Owner decision, provisional). */
export function UseRewardDialog({
  branchId,
  entitlement,
  onDone,
  onClose,
}: {
  branchId: string;
  entitlement: RewardEntitlementResponse;
  onDone: () => void;
  onClose: () => void;
}) {
  const { api, t, locale } = useWorkforce();
  const r = rewardDictionary(locale);
  const d = r.desk.useDialog;
  return (
    <ConfirmDialog
      title={d.title}
      description={d.body}
      facts={[
        { label: r.desk.list.item, value: rewardName(entitlement.item, locale) },
        { label: r.desk.list.left, value: String(entitlement.quantityLeft) },
      ]}
      tone="neutral"
      confirmLabel={d.confirm}
      busyLabel={d.busy}
      cancelLabel={t.common.cancel}
      referenceLabel={t.errors.reference}
      reasonField={{ label: d.note, required: false }}
      describeError={(error) => ({
        ...confirmError(t)(error),
        message: rewardErrorText(error, locale, (cause) => errorMessage(cause, t)),
      })}
      onCancel={onClose}
      onConfirm={async (note) => {
        await api.post(`/api/v1/rewards/branches/${branchId}/entitlements/${entitlement.id}/use`, {
          ...(note ? { note } : {}),
        });
        onDone();
      }}
    />
  );
}

/** Revokes the rest of a grant; the reason is required and the used units stay in the history. */
export function RevokeRewardDialog({
  branchId,
  entitlement,
  onDone,
  onClose,
}: {
  branchId: string;
  entitlement: RewardEntitlementResponse;
  onDone: () => void;
  onClose: () => void;
}) {
  const { api, t, locale } = useWorkforce();
  const r = rewardDictionary(locale);
  const d = r.desk.revokeDialog;
  return (
    <ConfirmDialog
      title={d.title}
      description={d.body}
      facts={[
        { label: r.desk.list.item, value: rewardName(entitlement.item, locale) },
        { label: r.desk.list.left, value: String(entitlement.quantityLeft) },
      ]}
      tone="danger"
      confirmLabel={d.confirm}
      busyLabel={d.busy}
      cancelLabel={t.common.cancel}
      referenceLabel={t.errors.reference}
      reasonField={{
        label: d.reason,
        required: true,
        requiredLabel: t.common.required,
        requiredMessage: d.needReason,
      }}
      describeError={(error) => ({
        ...confirmError(t)(error),
        message: rewardErrorText(error, locale, (cause) => errorMessage(cause, t)),
      })}
      onCancel={onClose}
      onConfirm={async (reason) => {
        const text = (reason ?? '').trim();
        if (!text) throw new Error(d.needReason);
        await api.post(
          `/api/v1/rewards/branches/${branchId}/entitlements/${entitlement.id}/revoke`,
          { reason: text },
        );
        onDone();
      }}
    />
  );
}

/** A manager corrects a use marked by mistake: choose the use, write the reason (`MANAGE_REWARD_CATALOG`). */
export function RestoreUseDialog({
  entitlement,
  onDone,
  onClose,
}: {
  entitlement: RewardEntitlementResponse;
  onDone: () => void;
  onClose: () => void;
}) {
  const { api, t, locale } = useWorkforce();
  const r = rewardDictionary(locale);
  const d = r.desk.restoreDialog;
  const open = entitlement.uses.filter((use) => use.restoration === null);
  const [useId, setUseId] = useState(open.length === 1 ? open[0]!.id : '');
  const [reason, setReason] = useState('');
  const [checked, setChecked] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const useError = checked && !useId ? d.required : undefined;
  const reasonError = checked && reason.trim().length === 0 ? d.required : undefined;

  async function submit() {
    if (pending) return;
    setChecked(true);
    setError(null);
    if (!useId || reason.trim().length === 0) return;
    setPending(true);
    try {
      await api.post(`/api/v1/rewards/uses/${useId}/restore`, { reason: reason.trim() });
      onDone();
    } catch (failure) {
      setError(rewardErrorText(failure, locale, (cause) => errorMessage(cause, t)));
      setPending(false);
    }
  }

  return (
    <FormDialog
      title={d.title}
      description={d.description}
      labels={{ ...formOverlayLabels(t, d.submit), submitting: d.submitting }}
      busy={pending}
      dirty={reason !== ''}
      error={error ? <Notice tone="error">{error}</Notice> : undefined}
      onClose={onClose}
      onSubmit={submit}
    >
      <FormGrid>
        <Field label={d.use} error={useError} required full>
          {(control) => (
            <Select
              {...control}
              value={useId}
              options={open.map((use) => ({
                value: use.id,
                label: `${formatDateTime(use.usedAt, ZONE, locale)} · ${use.branchName} · ${use.usedByName}`,
              }))}
              placeholder={d.use}
              onChange={(event) => setUseId(event.target.value)}
            />
          )}
        </Field>
        <Field label={d.reason} error={reasonError} required full>
          {(control) => (
            <Textarea
              {...control}
              rows={3}
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

/** The full history of one grant: who granted it and why, every use and its correction, and the revocation. Read-only. */
export function RewardHistoryDialog({
  entitlement,
  onClose,
}: {
  entitlement: RewardEntitlementResponse;
  onClose: () => void;
}) {
  const { t, locale } = useWorkforce();
  const r = rewardDictionary(locale);
  const h = r.desk.history;
  const [paging, setPaging] = useState({ page: 1, pageSize: 20 });
  const columns: DataTableColumn<RewardUseResponse>[] = [
    {
      key: 'when',
      header: h.columns.when,
      mobileTitle: true,
      cell: (use) => formatDateTime(use.usedAt, ZONE, locale),
    },
    {
      key: 'by',
      header: h.columns.by,
      truncate: true,
      cell: (use) => `${use.usedByName} · ${use.branchName}`,
    },
    {
      key: 'state',
      header: h.columns.state,
      cell: (use) => (
        <Badge tone={use.restoration ? 'warning' : 'success'}>
          {use.restoration ? h.restored : h.used}
        </Badge>
      ),
    },
    {
      key: 'note',
      header: h.columns.note,
      truncate: true,
      cell: (use) => use.note ?? '—',
    },
  ];
  return (
    <Dialog
      title={h.title}
      size="lg"
      closeLabel={h.close}
      onClose={onClose}
      footer={
        <Button variant="secondary" onClick={onClose}>
          {h.close}
        </Button>
      }
    >
      <DescriptionList
        columns={2}
        items={[
          { label: h.facts.item, value: rewardName(entitlement.item, locale) },
          {
            label: h.facts.status,
            value: (
              <Badge tone={statusTone(entitlement.status)}>{r.status[entitlement.status]}</Badge>
            ),
          },
          {
            label: h.facts.issued,
            value: `${formatDateTime(entitlement.issuedAt, ZONE, locale)} · ×${entitlement.quantityIssued}`,
          },
          { label: h.facts.by, value: entitlement.issuedByName },
          { label: h.facts.reason, value: entitlement.reason },
          {
            label: h.facts.expires,
            value: entitlement.expiresAt
              ? formatDateTime(entitlement.expiresAt, ZONE, locale)
              : expiryText(null, locale),
          },
          ...(entitlement.void
            ? [
                {
                  label: h.facts.revoked,
                  value: fill(h.revokedText, {
                    name: entitlement.void.byName,
                    at: formatDateTime(entitlement.void.at, ZONE, locale),
                    reason: entitlement.void.reason,
                  }),
                },
              ]
            : []),
          ...entitlement.uses.flatMap((use) =>
            use.restoration
              ? [
                  {
                    label: fill(h.facts.restoredUse, {
                      at: formatDateTime(use.usedAt, ZONE, locale),
                    }),
                    value: fill(h.restoredText, {
                      name: use.restoration.restoredByName,
                      at: formatDateTime(use.restoration.restoredAt, ZONE, locale),
                      reason: use.restoration.reason,
                    }),
                  },
                ]
              : [],
          ),
        ]}
      />
      <DataTable
        mode="client"
        caption={fill(t.common.list.table, { list: h.uses })}
        columns={columns}
        rows={entitlement.uses}
        rowKey={(use) => use.id}
        empty={<Empty>{h.none}</Empty>}
        paging={{
          ...paging,
          onPageChange: (page) => setPaging((state) => ({ ...state, page })),
          onPageSizeChange: (pageSize) => setPaging({ page: 1, pageSize }),
          labels: paginationLabels(t, h.uses),
        }}
      />
    </Dialog>
  );
}
