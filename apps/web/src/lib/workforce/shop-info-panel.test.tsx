import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WebsiteFooterBlock } from '@lucy-spa/contracts';
import { MediaLibraryScreen } from '../../components/workforce/screens/media-library';
import { FooterBlocksEditor } from '../../components/workforce/screens/website-footer-blocks';
import { ShopInfoPanel } from '../../components/workforce/screens/website-shop-info';
import type { ShopInfoForm } from './shop-info';
import { getWorkforceDictionary } from '../../i18n/workforce';
import { employee, owner, render } from '../../test/support';

const vi = getWorkforceDictionary('vi');
const en = getWorkforceDictionary('en');

test('the website page offers the Shop info tab to the people who manage website content', () => {
  const page = render(<MediaLibraryScreen />, owner);
  assert.ok(page.includes(vi.website.shop));
  const english = render(<MediaLibraryScreen />, owner, 'en');
  assert.ok(english.includes(en.website.shop));
  const branchOnly = render(<MediaLibraryScreen />, employee([['MANAGE_WEBSITE_CONTENT', 'B']]));
  assert.ok(!branchOnly.includes(vi.website.shop));
});

test('the Shop info panel loads before it shows a form and refuses everyone without the global permission', () => {
  const loading = render(<ShopInfoPanel />, owner);
  assert.ok(loading.includes(vi.common.loading));
  assert.ok(!loading.includes(vi.shopInfo.save));
  for (const account of [employee([['MANAGE_WEBSITE_CONTENT', 'B']]), employee([])]) {
    const denied = render(<ShopInfoPanel />, account);
    assert.ok(denied.includes(vi.shopInfo.noAccess));
    assert.ok(!denied.includes(vi.shopInfo.save));
  }
});

test('Vietnamese and English shop info texts cover the same problems', () => {
  assert.deepEqual(Object.keys(vi.shopInfo.problems), Object.keys(en.shopInfo.problems));
  assert.deepEqual(Object.keys(vi.shopInfo), Object.keys(en.shopInfo));
  // The footer block wording has the same types, hints and networks in both languages.
  for (const key of ['footerTypes', 'footerTypeHints', 'footerNetworks'] as const) {
    assert.deepEqual(Object.keys(vi.shopInfo[key]), Object.keys(en.shopInfo[key]), key);
  }
  assert.deepEqual(Object.keys(vi.shopInfo.footerTypes), [
    'SOCIAL',
    'APP',
    'TEXT',
    'LINKS',
    'IMAGE',
    'SLOGAN',
  ]);
});

const form: ShopInfoForm = {
  taglineVi: 'Thư Giãn Tận Tâm',
  taglineEn: 'Heartfelt Relaxation',
  introVi: '',
  introEn: '',
  address: '04 Nguyễn Quang Bích',
  hotline: '0934 936 101',
  mapUrl: '',
  facebookUrl: '',
  zaloContact: '',
  hoursBranchId: '',
  heroMediaId: '',
  factsVisible: true,
  facts: [],
  featuredGroups: [],
  whyVisible: false,
  whyTitleVi: '',
  whyTitleEn: '',
  whyCards: [],
  footerBlocks: [],
};
const noop = () => undefined;

test('footer blocks editor: an empty area says the footer shows only the logo, and offers to add a block', () => {
  const html = render(
    <FooterBlocksEditor form={form} onChange={noop} onEdit={noop} problem={undefined} />,
    owner,
  );
  assert.ok(html.includes(vi.shopInfo.footerSection));
  assert.ok(html.includes(vi.shopInfo.footerEmpty));
  assert.ok(html.includes(vi.shopInfo.footerAdd));
  const english = render(
    <FooterBlocksEditor form={form} onChange={noop} onEdit={noop} problem={undefined} />,
    owner,
    'en',
  );
  assert.ok(english.includes(en.shopInfo.footerEmpty));
});

test('footer blocks editor: each block is a row with its type, what it holds, a hidden mark and a menu; the add button stops at 12', () => {
  const blocks: WebsiteFooterBlock[] = [
    {
      id: '8f6f2a4e-5b0c-4a53-9f4e-2f9a4a1c7d01',
      type: 'SOCIAL',
      visible: true,
      urls: {
        facebook: 'https://facebook.com/lucyspa',
        zalo: null,
        tiktok: null,
        instagram: 'https://instagram.com/lucyspa',
        youtube: null,
        messenger: null,
      },
    },
    {
      id: '8f6f2a4e-5b0c-4a53-9f4e-2f9a4a1c7d02',
      type: 'APP',
      visible: false,
      googlePlayUrl: 'https://play.google.com/x',
      appStoreUrl: null,
    },
    { id: '8f6f2a4e-5b0c-4a53-9f4e-2f9a4a1c7d03', type: 'SLOGAN', visible: true },
  ];
  const html = render(
    <FooterBlocksEditor
      form={{ ...form, footerBlocks: blocks }}
      onChange={noop}
      onEdit={noop}
      problem={undefined}
    />,
    owner,
  );
  assert.ok(!html.includes(vi.shopInfo.footerEmpty));
  assert.ok(html.includes(vi.shopInfo.footerTypes.SOCIAL));
  assert.ok(html.includes('Facebook, Instagram'), 'only the networks that have a link');
  assert.ok(html.includes(vi.shopInfo.footerTypes.APP));
  assert.ok(html.includes('Google Play'));
  assert.ok(html.includes(vi.shopInfo.footerHidden), 'the hidden block is marked');
  // The slogan row shows the shop slogan (the one of the form), not a copy.
  assert.ok(html.includes(vi.shopInfo.footerTypes.SLOGAN));
  assert.ok(html.includes('Thư Giãn Tận Tâm'));
  assert.ok(html.includes('Thao tác cho khối'), 'each row has its menu');
  const full = render(
    <FooterBlocksEditor
      form={{
        ...form,
        footerBlocks: Array.from({ length: 12 }, (_, index) => ({
          id: `8f6f2a4e-5b0c-4a53-9f4e-2f9a4a1c7d${String(index).padStart(2, '0')}`,
          type: 'SLOGAN' as const,
          visible: true,
        })),
      }}
      onChange={noop}
      onEdit={noop}
      problem={vi.shopInfo.problems.footerBlocks}
    />,
    owner,
  );
  // The add button is the last button before its label: disabled at 12 blocks, enabled while there is room.
  const addButton = (html: string) => {
    const label = html.indexOf(vi.shopInfo.footerAdd);
    assert.ok(label > 0, 'the add button is drawn');
    return html.slice(html.lastIndexOf('<button', label), label);
  };
  assert.match(addButton(full), /disabled/);
  const room = render(
    <FooterBlocksEditor form={form} onChange={noop} onEdit={noop} problem={undefined} />,
    owner,
  );
  assert.doesNotMatch(addButton(room), /disabled/);
  assert.ok(full.includes(vi.shopInfo.problems.footerBlocks), 'a refused list shows its problem');
});
