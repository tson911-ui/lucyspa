import type { CampaignDetailResponse } from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { campaignDictionary } from '../../../i18n/campaigns';
import { owner, render } from '../../../test/support';
import { DisplaySection } from './campaign-display';
import { CampaignDetailView } from './campaign-detail';
import { InfoSection } from './campaign-info';

const c = campaignDictionary('vi');
const noop = () => Promise.resolve();

const campaign = (patch: Partial<CampaignDetailResponse> = {}): CampaignDetailResponse => ({
  id: 'c1',
  slug: 'ngay-hoi',
  nameVi: 'Ngày hội làm đẹp',
  nameEn: 'Beauty days',
  internalNote: 'Chốt giá với kế toán',
  startsAt: '2099-10-20T01:00:00.000Z',
  endsAt: '2099-10-25T16:59:00.000Z',
  state: 'DRAFT',
  publishedAt: null,
  endedEarlyAt: null,
  endedEarlyReason: null,
  rowVersion: 3,
  badgeVi: '-20%',
  badgeEn: null,
  headlineVi: 'Ngày hội làm đẹp',
  headlineEn: null,
  messageVi: null,
  messageEn: null,
  ctaLabelVi: 'Mua ngay',
  ctaLabelEn: null,
  bannerMediaId: null,
  bannerUrl: null,
  groups: [
    { id: 'g1', position: 1, rule: { kind: 'PERCENT', value: '20' }, itemCount: 5 },
    { id: 'g2', position: 2, rule: { kind: 'AMOUNT', value: '30000' }, itemCount: 2 },
  ],
  review: {
    itemCount: 7,
    noDiscountCount: 1,
    overlapCount: 2,
    ownPromotionCount: 0,
    minPercent: 8,
    maxPercent: 30,
  },
  can: {
    edit: true,
    editPresentation: true,
    changeItems: true,
    publish: true,
    end: false,
    remove: true,
  },
  ...patch,
});

const running = (patch: Partial<CampaignDetailResponse> = {}) =>
  campaign({
    state: 'ACTIVE',
    publishedAt: '2026-10-01T00:00:00.000Z',
    can: {
      edit: false,
      editPresentation: true,
      changeItems: false,
      publish: false,
      end: true,
      remove: false,
    },
    ...patch,
  });

const view = (data: CampaignDetailResponse) =>
  render(<CampaignDetailView campaign={data} reload={noop} />, owner);

test('a draft shows its state in the header, one primary action, the review, the groups and the picker tab', () => {
  const markup = view(campaign());
  assert.ok(markup.includes('Ngày hội làm đẹp'));
  assert.ok(markup.includes(`${c.states.DRAFT} ·`), 'the state is text in the header line');
  assert.ok(markup.includes(c.detail.publish));
  assert.ok(!markup.includes(c.detail.end));
  assert.ok(markup.includes(c.review.titleDraft));
  assert.ok(markup.includes(c.detail.tabs.picker), 'a draft can pick products');
  assert.ok(markup.includes(c.detail.moreActions), 'the delete lives in the more-actions menu');
  assert.ok(markup.includes(c.groups.add));
  assert.ok(markup.includes('Giảm 20%'));
  assert.ok(markup.includes('Giảm 30.000 ₫'));
  assert.ok(markup.includes('8% đến 30%'));
  assert.ok(markup.includes(c.review.noDiscountHint));
  assert.ok(markup.includes(c.review.overlapHint));
  assert.ok(!markup.includes(c.review.ownHint), 'no own promotion, no hint');
  assert.ok(markup.includes('?problem=NO_DISCOUNT'), 'a problem count links to the filtered list');
  assert.ok(!markup.includes('?problem=OWN_PROMOTION'));
});

test('a draft that cannot be published says why, and its Publish button is disabled', () => {
  const empty = view(
    campaign({
      review: {
        ...campaign().review,
        itemCount: 0,
        noDiscountCount: 0,
        minPercent: null,
        maxPercent: null,
      },
    }),
  );
  assert.ok(empty.includes(c.review.emptyDraft));
  assert.match(empty, new RegExp(`<button[^>]*disabled[^>]*>(?:<[^>]+>)*${c.detail.publish}`));
  const past = view(campaign({ startsAt: '2020-01-01T00:00:00.000Z' }));
  assert.ok(past.includes(c.review.startPassed));
  const none = view(
    campaign({ review: { ...campaign().review, itemCount: 2, noDiscountCount: 2 } }),
  );
  assert.ok(none.includes(c.review.allNoDiscount));
});

test('a running campaign offers End, no publish, no picker, no group edits, and a published summary', () => {
  const markup = view(running());
  assert.ok(markup.includes(c.detail.end));
  assert.ok(!markup.includes(c.detail.publish));
  assert.ok(!markup.includes(c.detail.tabs.picker));
  assert.ok(!markup.includes(c.groups.add));
  assert.ok(!markup.includes(c.detail.moreActions));
  assert.ok(markup.includes(c.review.titlePublished));
  assert.ok(markup.includes(`${c.states.ACTIVE} ·`));
  assert.ok(!markup.includes(c.review.frozen), 'the freeze notice is for drafts');
});

test('an ended campaign has no action and says it stopped early', () => {
  const markup = view(
    running({
      state: 'ENDED',
      endedEarlyAt: '2026-10-05T03:00:00.000Z',
      endedEarlyReason: 'Hết hàng',
      can: {
        edit: false,
        editPresentation: false,
        changeItems: false,
        publish: false,
        end: false,
        remove: false,
      },
    }),
  );
  assert.ok(!markup.includes(c.detail.end));
  assert.ok(!markup.includes(c.detail.publish));
  assert.ok(markup.includes(c.list.endedEarly));
});

test('the display section shows the texts, the automatic badge when none is set, and edits only while allowed', () => {
  const shown = render(<DisplaySection campaign={campaign()} send={noop} />, owner);
  assert.ok(shown.includes('-20%'));
  assert.ok(shown.includes(c.display.edit));
  assert.ok(shown.includes(c.display.bannerNone));
  assert.ok(shown.includes(c.display.notSet));
  const auto = render(<DisplaySection campaign={campaign({ badgeVi: null })} send={noop} />, owner);
  assert.ok(auto.includes(c.display.badgeAuto));
  const closed = render(
    <DisplaySection
      campaign={campaign({ can: { ...campaign().can, editPresentation: false } })}
      send={noop}
    />,
    owner,
  );
  assert.ok(!closed.includes(c.display.edit));
});

test('the info section is read-only after publishing and shows the public sale address', () => {
  const draft = render(<InfoSection campaign={campaign()} send={noop} />, owner);
  assert.ok(draft.includes(c.info.edit));
  assert.ok(draft.includes('/vi/products?campaign=ngay-hoi'));
  assert.ok(draft.includes('Chốt giá với kế toán'));
  assert.ok(draft.includes(c.info.notPublished));
  assert.ok(!draft.includes(c.info.locked));
  const locked = render(<InfoSection campaign={running()} send={noop} />, owner);
  assert.ok(!locked.includes(c.info.edit));
  assert.ok(locked.includes(c.info.locked));
});
