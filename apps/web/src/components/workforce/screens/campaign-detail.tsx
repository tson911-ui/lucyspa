'use client';

import type { CampaignDetailResponse } from '@lucy-spa/contracts';
import {
  Breadcrumbs,
  Cluster,
  DescriptionList,
  RowActions,
  Stack,
  Tabs,
  useUrlState,
} from '@lucy-spa/ui';
import { PrefetchLink as Link } from '../link';
import { useState, type ReactNode } from 'react';
import { campaignDictionary } from '../../../i18n/campaigns';
import { fill } from '../../../i18n/workforce';
import {
  activeTab,
  CAMPAIGN_DETAIL_DEFAULTS,
  CAMPAIGN_DETAIL_PAGE_KEYS,
  CAMPAIGN_ZONE,
  campaignName,
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
import { useWorkforce } from '../session';
import {
  Button,
  ErrorState,
  Loading,
  Notice,
  PageHeader,
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
 * The page header carries the state in its one line of text and the one primary action: "Công bố" on a draft, "Kết thúc chiến dịch"
 * on a scheduled or running one; "Xóa bản nháp" is in the more-actions menu. What each person may do follows `campaign.can`, never
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

  const intro = [
    c.states[campaign.state],
    campaignWindow(campaign, locale),
    ...(campaign.endedEarlyAt
      ? [
          fill(c.detail.endedEarlyAt, {
            at: formatDateTime(campaign.endedEarlyAt, CAMPAIGN_ZONE, locale),
          }),
        ]
      : []),
  ].join(' · ');

  const tab = activeTab(list, campaign.can.changeItems);
  const panels: Record<CampaignTabId, ReactNode> = {
    items: (
      <Stack gap="page">
        {blocker ? (
          <Notice tone={blocker === 'CAMPAIGN_EMPTY' ? 'info' : 'warning'}>
            {blocker === 'CAMPAIGN_START_PASSED'
              ? c.review.startPassed
              : blocker === 'CAMPAIGN_EMPTY'
                ? c.review.emptyDraft
                : c.review.allNoDiscount}
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
    document
      .getElementById('campaign-items-q')
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  return (
    <>
      <PageHeader
        title={name}
        intro={intro}
        breadcrumbs={
          <Breadcrumbs
            label={c.breadcrumbs}
            LinkComponent={Link}
            items={[{ label: c.title, href: `${base}/product-campaigns` }, { label: name }]}
          />
        }
      >
        {campaign.can.remove ? (
          <RowActions
            menuLabel={c.detail.moreActions}
            items={[
              {
                id: 'delete',
                label: c.detail.delete,
                icon: 'trash',
                tone: 'danger',
                onSelect: () => setOverlay('delete'),
              },
            ]}
          />
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
        {campaign.can.end ? (
          <Button variant="danger-outline" onClick={() => setOverlay('end')}>
            {c.detail.end}
          </Button>
        ) : null}
      </PageHeader>
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
        className="ls-link"
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
