'use client';

import type { CampaignDetailResponse } from '@lucy-spa/contracts';
import {
  Breadcrumbs,
  Cluster,
  DescriptionList,
  PageHeader,
  RowActions,
  Stack,
  Tabs,
  useUrlState,
  type MenuItem,
} from '@lucy-spa/ui';
import { ListCrumbLink } from '../link';
import { useState, type ReactNode } from 'react';
import { campaignDictionary } from '../../../i18n/campaigns';
import { fill } from '../../../i18n/workforce';
import {
  activeTab,
  CAMPAIGN_DETAIL_DEFAULTS,
  CAMPAIGN_DETAIL_PAGE_KEYS,
  CAMPAIGN_ZONE,
  campaignName,
  campaignTone,
  campaignWindow,
  isStaleVersion,
  normalizeCampaignDetail,
  publishBlocker,
  rangeText,
  type CampaignDetailState,
  type CampaignProblem,
  type CampaignTabId,
} from '../../../lib/workforce/campaigns';
import { formatDateTime } from '../../../lib/workforce/format';
import { opensInput } from '../../../lib/workforce/opens-input';
import { useWorkforce } from '../session';
import {
  Badge,
  Button,
  ErrorState,
  Loading,
  Notice,
  Section,
  useResource,
  useSuccessToast,
} from '../ui';
import { DeleteDialog, EndDialog, PublishDialog, type SendCampaign } from './campaign-dialogs';
import { DisplaySection } from './campaign-display';
import { GroupsSection } from './campaign-groups';
import { InfoSection } from './campaign-info';
import { ItemsPanel } from './campaign-items';
import { PickerPanel } from './campaign-picker';
import { metaLine } from './pos-format';
import { scrollToSection } from './products-links';

/** One campaign's page: its products and groups, the picker, the display and the details. Every campaign command returns this same data. */
export function CampaignDetailScreen({ id }: { id: string }) {
  const { api, t } = useWorkforce();
  const campaign = useResource(
    () => api.get<CampaignDetailResponse>(`/api/v1/product-campaigns/${id}`),
    [api, id],
  );
  if (campaign.error && !campaign.data) {
    return <ErrorState error={campaign.error} t={t} onRetry={() => void campaign.reload()} />;
  }
  if (!campaign.data) return <Loading t={t} page />;
  return <CampaignDetailView campaign={campaign.data} reload={campaign.reload} />;
}

type Overlay = 'publish' | 'end' | 'delete';

/**
 * The page header carries the state as a badge under the title, the period as its one muted line and the one primary action:
 * "Công bố" on a draft; "Kết thúc chiến dịch" and "Xóa bản nháp" are in the more-actions menu (destructive, with confirmation). What each person may do follows `campaign.can`, never
 * the state. The address bar keeps the tab and the filters of the two product lists.
 */
export function CampaignDetailView({
  campaign,
  reload,
}: {
  campaign: CampaignDetailResponse;
  reload: () => Promise<void>;
}) {
  const { api, locale, base, navigate } = useWorkforce();
  const c = campaignDictionary(locale);
  const notify = useSuccessToast();
  const [list, updateList] = useUrlState(CAMPAIGN_DETAIL_DEFAULTS, {
    normalize: normalizeCampaignDetail,
    resetOnChange: CAMPAIGN_DETAIL_PAGE_KEYS,
  });
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [stale, setStale] = useState(false);
  const name = campaignName(campaign, locale);
  const blocker = publishBlocker(campaign);

  /** A stale version is not reloaded silently: the page asks, so nobody loses what they were reading. */
  const send: SendCampaign = async (path, body) => {
    try {
      await api.post(path, body);
    } catch (failure) {
      if (isStaleVersion(failure)) setStale(true);
      throw failure;
    }
    setStale(false);
    await reload().catch(() => undefined);
  };

  // The state is the header badge; the period (and an early end) is the one muted line under it, joined by Intl, not " · ".
  const intro = metaLine(locale, [
    campaignWindow(campaign, locale),
    campaign.endedEarlyAt
      ? fill(c.detail.endedEarlyAt, {
          at: formatDateTime(campaign.endedEarlyAt, CAMPAIGN_ZONE, locale),
        })
      : null,
  ]);
  // "Kết thúc chiến dịch" and "Xóa bản nháp" are destructive: they live in the header `⋮` (each opens its confirmation), never in
  // the primary slot.
  const menu: MenuItem[] = [
    ...(campaign.can.end
      ? [
          {
            id: 'end',
            label: opensInput(c.detail.end),
            tone: 'danger' as const,
            onSelect: () => setOverlay('end'),
          },
        ]
      : []),
    ...(campaign.can.remove
      ? [
          {
            id: 'delete',
            label: c.detail.delete,
            icon: 'trash' as const,
            tone: 'danger' as const,
            onSelect: () => setOverlay('delete'),
          },
        ]
      : []),
  ];

  const tab = activeTab(list, campaign.can.changeItems);
  const blockerText = (code: NonNullable<typeof blocker>) =>
    code === 'CAMPAIGN_START_PASSED'
      ? c.review.startPassed
      : code === 'CAMPAIGN_EMPTY'
        ? c.review.emptyDraft
        : c.review.allNoDiscount;
  const panels: Record<CampaignTabId, ReactNode> = {
    items: (
      <Stack gap="page">
        {blocker ? (
          <Notice tone={blocker === 'CAMPAIGN_EMPTY' ? 'info' : 'warning'}>
            {blockerText(blocker)}
          </Notice>
        ) : null}
        <ReviewCard campaign={campaign} onView={(problem) => viewProblem(problem)} />
        <GroupsSection campaign={campaign} send={send} />
        <ItemsPanel campaign={campaign} send={send} list={list} updateList={updateList} />
      </Stack>
    ),
    picker: <PickerPanel campaign={campaign} send={send} list={list} updateList={updateList} />,
    display: <DisplaySection campaign={campaign} send={send} />,
    info: <InfoSection campaign={campaign} send={send} />,
  };

  function viewProblem(problem: CampaignProblem) {
    updateList({
      tab: '',
      problem,
      iq: '',
      group: '',
      ipage: 1,
    } satisfies Partial<CampaignDetailState>);
    scrollToSection('campaign-items-q');
  }

  return (
    <>
      <PageHeader
        title={name}
        status={
          <Badge tone={campaignTone(campaign.state)}>
            {campaign.endedEarlyAt ? c.list.endedEarly : c.states[campaign.state]}
          </Badge>
        }
        description={intro}
        breadcrumbs={
          <Breadcrumbs
            label={c.breadcrumbs}
            LinkComponent={ListCrumbLink}
            items={[{ label: c.title, href: `${base}/product-campaigns` }, { label: name }]}
          />
        }
        actions={
          menu.length > 0 || campaign.can.publish ? (
            <>
              {menu.length > 0 ? (
                <RowActions menuLabel={c.detail.moreActions} items={menu} />
              ) : null}
              {campaign.can.publish ? (
                <Button
                  variant="primary"
                  disabled={blocker !== null}
                  onClick={() => setOverlay('publish')}
                >
                  {c.detail.publish}
                </Button>
              ) : null}
            </>
          ) : undefined
        }
      />
      <Stack gap="page">
        {stale ? (
          <Notice tone="warning">
            <Cluster>
              <span>{c.stale.text}</span>
              <Button
                variant="secondary"
                icon="refresh"
                onClick={() => {
                  setStale(false);
                  void reload();
                }}
              >
                {c.stale.reload}
              </Button>
            </Cluster>
          </Notice>
        ) : null}
        <Tabs
          label={c.detail.tabsLabel}
          value={tab}
          onChange={(id) => updateList({ tab: id === 'items' ? '' : id })}
          tabs={[
            { id: 'items', label: c.detail.tabs.items, panel: panels.items },
            ...(campaign.can.changeItems
              ? [{ id: 'picker', label: c.detail.tabs.picker, panel: panels.picker }]
              : []),
            { id: 'display', label: c.detail.tabs.display, panel: panels.display },
            { id: 'info', label: c.detail.tabs.info, panel: panels.info },
          ]}
        />
      </Stack>
      {overlay === 'publish' ? (
        <PublishDialog
          campaign={campaign}
          send={send}
          onClose={() => setOverlay(null)}
          onDone={() => {
            setOverlay(null);
            notify(c.publishDialog.done);
          }}
        />
      ) : null}
      {overlay === 'end' ? (
        <EndDialog
          campaign={campaign}
          send={send}
          onClose={() => setOverlay(null)}
          onDone={() => {
            setOverlay(null);
            notify(c.endDialog.done);
          }}
        />
      ) : null}
      {overlay === 'delete' ? (
        <DeleteDialog
          campaign={campaign}
          onClose={() => setOverlay(null)}
          onDeleted={() => {
            setOverlay(null);
            notify(c.deleteDialog.done);
            navigate?.(`${base}/product-campaigns`);
          }}
        />
      ) : null}
    </>
  );
}

/** How many products the rules reach and what to look at before publishing; each problem count opens the filtered product list. */
function ReviewCard({
  campaign,
  onView,
}: {
  campaign: CampaignDetailResponse;
  onView: (problem: CampaignProblem) => void;
}) {
  const { locale } = useWorkforce();
  const c = campaignDictionary(locale);
  const r = c.review;
  const { review } = campaign;
  const counted = (count: number, problem: CampaignProblem) =>
    count > 0 ? (
      <a
        className="ls-link ls-adm-c-count-link"
        href={`?problem=${problem}`}
        aria-label={fill(r.view, { n: count })}
        onClick={(event) => {
          event.preventDefault();
          onView(problem);
        }}
      >
        {count}
      </a>
    ) : (
      0
    );
  return (
    <Section title={campaign.can.publish ? r.titleDraft : r.titlePublished}>
      <Stack gap="block">
        <DescriptionList
          columns={2}
          items={[
            { label: r.items, value: review.itemCount },
            { label: r.discounted, value: review.itemCount - review.noDiscountCount },
            { label: r.noDiscount, value: counted(review.noDiscountCount, 'NO_DISCOUNT') },
            { label: r.overlap, value: counted(review.overlapCount, 'OVERLAP') },
            { label: r.own, value: counted(review.ownPromotionCount, 'OWN_PROMOTION') },
            { label: r.range, value: rangeText(review, locale) },
          ]}
        />
        {review.noDiscountCount > 0 ? <p className="ls-hint">{r.noDiscountHint}</p> : null}
        {review.overlapCount > 0 ? <p className="ls-hint">{r.overlapHint}</p> : null}
        {review.ownPromotionCount > 0 ? <p className="ls-hint">{r.ownHint}</p> : null}
        {campaign.can.publish ? <p className="ls-hint">{r.frozen}</p> : null}
      </Stack>
    </Section>
  );
}
