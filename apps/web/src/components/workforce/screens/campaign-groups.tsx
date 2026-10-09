'use client';

import {
  CAMPAIGN_MAX_GROUPS,
  CAMPAIGN_RULE_KINDS,
  type CampaignDetailResponse,
  type CampaignGroupResponse,
  type CampaignRuleKindName,
} from '@lucy-spa/contracts';
import {
  ConfirmDialog,
  DataTable,
  Field,
  FormDialog,
  FormGrid,
  ListSection,
  MoneyInput,
  NumberInput,
  RowActions,
  Select,
  type DataTableColumn,
} from '@lucy-spa/ui';
import { useState } from 'react';
import { campaignDictionary } from '../../../i18n/campaigns';
import { fill } from '../../../i18n/workforce';
import {
  EMPTY_RULE_DRAFT,
  groupNumbers,
  groupRequest,
  RULE_EXAMPLE_LIST_VND,
  ruleDraftOf,
  ruleRange,
  rulePreviewPrice,
  ruleText,
  ruleValueValid,
  type RuleDraft,
} from '../../../lib/workforce/campaigns';
import { formOverlayLabels } from '../../../lib/workforce/form-labels';
import { formatVnd } from '../../../lib/workforce/format';
import { useWorkforce } from '../session';
import { Button, Empty, Notice, useSuccessToast } from '../ui';
import { useCampaignAction, useConfirmError, type SendCampaign } from './campaign-dialogs';

type Overlay =
  | { kind: 'add' }
  | { kind: 'edit'; group: CampaignGroupResponse }
  | { kind: 'remove'; group: CampaignGroupResponse };

/**
 * The price groups of a campaign: each has one rule (percent off, amount off or a flat price) and the products it covers. A draft
 * can add, change and remove groups; a published campaign shows them read-only. At most ten groups.
 */
export function GroupsSection({
  campaign,
  send,
}: {
  campaign: CampaignDetailResponse;
  send: SendCampaign;
}) {
  const { t, locale } = useWorkforce();
  const c = campaignDictionary(locale);
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const notify = useSuccessToast();
  const editable = campaign.can.changeItems;
  const numbers = groupNumbers(campaign.groups);
  const atLimit = campaign.groups.length >= CAMPAIGN_MAX_GROUPS;
  const nameOf = (group: CampaignGroupResponse) =>
    fill(c.groups.name, { n: numbers.get(group.id) ?? group.position });
  const rows = [...campaign.groups].sort((a, b) => a.position - b.position);

  const columns: DataTableColumn<CampaignGroupResponse>[] = [
    { key: 'name', header: c.items.inGroup, mobileTitle: true, cell: (group) => nameOf(group) },
    { key: 'rule', header: c.groups.kind, cell: (group) => ruleText(group.rule, locale) },
    {
      key: 'count',
      header: c.list.products,
      numeric: true,
      cell: (group) => group.itemCount,
    },
    ...(editable
      ? [
          {
            key: 'actions',
            header: t.common.actions,
            actions: true as const,
            cell: (group: CampaignGroupResponse) => (
              <RowActions
                menuLabel={fill(c.groups.actionsFor, { name: nameOf(group) })}
                items={[
                  {
                    id: 'edit',
                    label: c.groups.edit,
                    icon: 'edit',
                    onSelect: () => setOverlay({ kind: 'edit', group }),
                  },
                  {
                    id: 'remove',
                    label: c.groups.remove,
                    icon: 'trash',
                    tone: 'danger',
                    onSelect: () => setOverlay({ kind: 'remove', group }),
                  },
                ]}
              />
            ),
          },
        ]
      : []),
  ];

  return (
    <>
      <ListSection
        title={c.groups.title}
        actions={
          editable && !atLimit ? (
            <Button variant="secondary" icon="plus" onClick={() => setOverlay({ kind: 'add' })}>
              {c.groups.add}
            </Button>
          ) : undefined
        }
      >
        <DataTable
          caption={fill(t.common.list.table, { list: c.groups.title })}
          columns={columns}
          rows={rows}
          rowKey={(group) => group.id}
          loadingLabel={t.common.loading}
          empty={<Empty>{c.groups.empty}</Empty>}
          paging={{ off: 'A campaign has at most ten groups.' }}
        />
        {editable && atLimit ? (
          <Notice tone="info">{fill(c.groups.limit, { max: CAMPAIGN_MAX_GROUPS })}</Notice>
        ) : null}
      </ListSection>
      {overlay?.kind === 'add' ? (
        <GroupDialog
          campaign={campaign}
          send={send}
          onClose={() => setOverlay(null)}
          onDone={() => {
            setOverlay(null);
            notify(c.saved);
          }}
        />
      ) : null}
      {overlay?.kind === 'edit' ? (
        <GroupDialog
          campaign={campaign}
          group={overlay.group}
          name={nameOf(overlay.group)}
          send={send}
          onClose={() => setOverlay(null)}
          onDone={() => {
            setOverlay(null);
            notify(c.saved);
          }}
        />
      ) : null}
      {overlay?.kind === 'remove' ? (
        <RemoveGroupDialog
          campaign={campaign}
          group={overlay.group}
          name={nameOf(overlay.group)}
          send={send}
          onClose={() => setOverlay(null)}
          onDone={() => {
            setOverlay(null);
            notify(c.saved);
          }}
        />
      ) : null}
    </>
  );
}

const numberText = (value: number, locale: 'vi' | 'en') =>
  value.toLocaleString(locale === 'vi' ? 'vi-VN' : 'en-US');

/** One rule as a short form: how to discount, the value, and what it gives for an example list price. */
function GroupDialog({
  campaign,
  group,
  name,
  send,
  onClose,
  onDone,
}: {
  campaign: CampaignDetailResponse;
  group?: CampaignGroupResponse;
  name?: string;
  send: SendCampaign;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t, locale } = useWorkforce();
  const c = campaignDictionary(locale);
  const [initial] = useState<RuleDraft>(() => (group ? ruleDraftOf(group.rule) : EMPTY_RULE_DRAFT));
  const [draft, setDraft] = useState<RuleDraft>(initial);
  const [checked, setChecked] = useState(false);
  const command = useCampaignAction(send);
  const valid = ruleValueValid(draft);
  const range = ruleRange(draft.kind);
  const price = rulePreviewPrice(draft, RULE_EXAMPLE_LIST_VND);
  const list = formatVnd(RULE_EXAMPLE_LIST_VND, locale);
  const example = !valid
    ? undefined
    : price === null
      ? fill(c.groups.exampleNone, { list })
      : fill(c.groups.example, { list, price: formatVnd(price, locale) });

  async function submit() {
    setChecked(true);
    if (!valid) {
      document.getElementById('campaign-rule-value')?.focus();
      return;
    }
    const body = groupRequest(draft, campaign.rowVersion);
    const path = group
      ? `/api/v1/product-campaigns/${campaign.id}/groups/${group.id}/edit`
      : `/api/v1/product-campaigns/${campaign.id}/groups`;
    if (await command.run(path, body)) onDone();
  }

  return (
    <FormDialog
      title={group && name ? fill(c.groups.editTitle, { name }) : c.groups.addTitle}
      labels={{
        ...formOverlayLabels(t, group ? c.save : c.groups.submitAdd),
        submitting: c.saving,
      }}
      busy={command.pending}
      dirty={JSON.stringify(draft) !== JSON.stringify(initial)}
      error={command.message ? <Notice tone="error">{command.message}</Notice> : undefined}
      onClose={onClose}
      onSubmit={submit}
    >
      <FormGrid cols={1}>
        <Field label={c.groups.kind} hint={c.groups.valueHints[draft.kind]}>
          {(control) => (
            <Select
              {...control}
              value={draft.kind}
              options={CAMPAIGN_RULE_KINDS.map((kind) => ({
                value: kind,
                label: c.groups.kinds[kind],
              }))}
              onChange={(event) =>
                setDraft({ ...draft, kind: event.target.value as CampaignRuleKindName })
              }
            />
          )}
        </Field>
        <Field
          id="campaign-rule-value"
          label={c.groups.valueLabels[draft.kind]}
          hint={example}
          error={
            checked && !valid
              ? fill(c.problems.ruleValue, {
                  min: range.min,
                  max: numberText(range.max, locale),
                })
              : undefined
          }
          required
        >
          {(control) =>
            draft.kind === 'PERCENT' ? (
              <NumberInput
                {...control}
                inputMode="numeric"
                min={1}
                max={90}
                value={draft.value}
                onChange={(event) =>
                  setDraft({ ...draft, value: event.target.value.replace(/\D/g, '').slice(0, 2) })
                }
              />
            ) : (
              <MoneyInput
                {...control}
                unit="₫"
                separator={locale === 'vi' ? '.' : ','}
                value={draft.value === '' ? null : Number(draft.value)}
                onValueChange={(value) =>
                  setDraft({ ...draft, value: value === null ? '' : String(value) })
                }
              />
            )
          }
        </Field>
      </FormGrid>
    </FormDialog>
  );
}

function RemoveGroupDialog({
  campaign,
  group,
  name,
  send,
  onClose,
  onDone,
}: {
  campaign: CampaignDetailResponse;
  group: CampaignGroupResponse;
  name: string;
  send: SendCampaign;
  onClose: () => void;
  onDone: () => void;
}) {
  const { locale } = useWorkforce();
  const c = campaignDictionary(locale);
  const describeError = useConfirmError();
  return (
    <ConfirmDialog
      title={c.groups.removeTitle}
      description={c.groups.removeBody}
      facts={[
        { label: c.items.inGroup, value: name },
        { label: c.groups.kind, value: ruleText(group.rule, locale) },
        { label: c.list.products, value: String(group.itemCount) },
      ]}
      tone="danger"
      confirmLabel={c.groups.removeConfirm}
      cancelLabel={c.cancel}
      describeError={describeError}
      onCancel={onClose}
      onConfirm={async () => {
        await send(`/api/v1/product-campaigns/${campaign.id}/groups/${group.id}/remove`, {
          expectedVersion: campaign.rowVersion,
        });
        onDone();
      }}
    />
  );
}
