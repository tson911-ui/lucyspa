import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PublicSiteImage } from '@lucy-spa/contracts';
import { AuthError } from '../auth/auth.error.js';
import {
  footerMediaIds,
  parseFooterBlocks,
  publicFooterBlocks,
  readFooterBlocks,
} from './shop-info.footer.js';

const id = (n: number) => `8f6f2a4e-5b0c-4a53-9f4e-2f9a4a1c7d${String(n).padStart(2, '0')}`;
const refused = (action: () => unknown) =>
  assert.throws(
    action,
    (error: unknown) =>
      error instanceof AuthError &&
      error.code === 'VALIDATION_FAILED' &&
      error.field === 'footerBlocks',
  );

const social = (patch: object = {}) => ({
  id: id(1),
  type: 'SOCIAL',
  visible: true,
  urls: {
    facebook: 'https://facebook.com/lucyspa',
    zalo: null,
    tiktok: 'https://www.tiktok.com/@lucyspa',
    instagram: null,
    youtube: null,
    messenger: 'https://m.me/lucyspa',
  },
  ...patch,
});
const app = (patch: object = {}) => ({
  id: id(2),
  type: 'APP',
  visible: true,
  googlePlayUrl: 'https://play.google.com/store/apps/details?id=vn.lucyspa',
  appStoreUrl: null,
  ...patch,
});
const text = (patch: object = {}) => ({
  id: id(3),
  type: 'TEXT',
  visible: true,
  textVi: 'Thư giãn tận tâm.\nMở cửa mỗi ngày.',
  textEn: 'Relax with care.\nOpen every day.',
  ...patch,
});
const links = (patch: object = {}) => ({
  id: id(4),
  type: 'LINKS',
  visible: true,
  titleVi: 'Khám phá',
  titleEn: 'Explore',
  items: [
    { labelVi: 'Dịch vụ', labelEn: 'Services', url: '/{locale}/services' },
    { labelVi: 'Fanpage', labelEn: 'Fan page', url: 'https://facebook.com/lucyspa' },
  ],
  ...patch,
});
const image = (patch: object = {}) => ({
  id: id(5),
  type: 'IMAGE',
  visible: true,
  mediaId: id(90),
  linkUrl: null,
  ...patch,
});
const slogan = (patch: object = {}) => ({ id: id(6), type: 'SLOGAN', visible: true, ...patch });

test('footer blocks: the default is no blocks, and a request must be a list of at most 12', () => {
  assert.deepEqual(readFooterBlocks([]), []);
  assert.deepEqual(readFooterBlocks(null), []);
  assert.deepEqual(parseFooterBlocks([]), []);
  refused(() => parseFooterBlocks(undefined));
  refused(() => parseFooterBlocks('blocks'));
  refused(() => parseFooterBlocks({}));
  const many = Array.from({ length: 13 }, (_, index) => slogan({ id: id(index) }));
  refused(() => parseFooterBlocks(many));
  assert.equal(parseFooterBlocks(many.slice(0, 12)).length, 12);
});

test('footer blocks: all six types round-trip in the Owner order', () => {
  const all = [social(), app(), text(), links(), image(), slogan()];
  const parsed = parseFooterBlocks(all);
  assert.deepEqual(
    parsed.map((block) => block.type),
    ['SOCIAL', 'APP', 'TEXT', 'LINKS', 'IMAGE', 'SLOGAN'],
  );
  assert.deepEqual(readFooterBlocks(JSON.parse(JSON.stringify(parsed))), parsed);
  // Ids are normalized to lower case.
  const upper = parseFooterBlocks([slogan({ id: id(7).toUpperCase() })]);
  assert.equal(upper[0]?.id, id(7));
});

test('footer blocks: ids are UUIDs, unique, and every block says whether it is visible', () => {
  refused(() => parseFooterBlocks([slogan({ id: 'not-a-uuid' })]));
  refused(() => parseFooterBlocks([slogan(), slogan()]));
  refused(() => parseFooterBlocks([slogan({ visible: 'yes' })]));
  refused(() => parseFooterBlocks([{ id: id(8), type: 'SLOGAN' }]));
  refused(() => parseFooterBlocks([slogan({ type: 'WIDGET' })]));
  refused(() => parseFooterBlocks(['x']));
});

test('social block: https links only, at least one, unknown networks ignored', () => {
  refused(() => parseFooterBlocks([social({ urls: { facebook: 'http://facebook.com/x' } })]));
  refused(() => parseFooterBlocks([social({ urls: { facebook: 'javascript:alert(1)' } })]));
  refused(() => parseFooterBlocks([social({ urls: { zalo: '//evil.example/x' } })]));
  refused(() => parseFooterBlocks([social({ urls: { zalo: '/vi/services' } })]));
  refused(() =>
    parseFooterBlocks([social({ urls: { youtube: 'https://user:pw@youtube.com/x' } })]),
  );
  refused(() => parseFooterBlocks([social({ urls: {} })]));
  refused(() => parseFooterBlocks([social({ urls: { facebook: ' ' } })]));
  refused(() => parseFooterBlocks([social({ urls: undefined })]));
  const parsed = parseFooterBlocks([
    social({ urls: { instagram: ' https://instagram.com/lucyspa ' } }),
  ]);
  const block = parsed[0];
  assert.equal(
    block?.type === 'SOCIAL' ? block.urls.instagram : null,
    'https://instagram.com/lucyspa',
  );
  assert.equal(block?.type === 'SOCIAL' ? block.urls.facebook : 'x', null);
});

test('app block: each store link is https and optional, but one is required', () => {
  refused(() => parseFooterBlocks([app({ googlePlayUrl: null, appStoreUrl: null })]));
  refused(() => parseFooterBlocks([app({ googlePlayUrl: 'http://play.google.com/x' })]));
  refused(() => parseFooterBlocks([app({ appStoreUrl: '/en/services' })]));
  assert.equal(
    parseFooterBlocks([
      app({ googlePlayUrl: '', appStoreUrl: 'https://apps.apple.com/vn/app/lucy/id1' }),
    ]).length,
    1,
  );
});

test('text block: both languages, 300 characters, plain text only', () => {
  refused(() => parseFooterBlocks([text({ textEn: null })]));
  refused(() => parseFooterBlocks([text({ textVi: '   ' })]));
  refused(() => parseFooterBlocks([text({ textVi: 'a'.repeat(301) })]));
  refused(() => parseFooterBlocks([text({ textVi: 5 })]));
  refused(() => parseFooterBlocks([text({ textVi: 'bad\u0007control' })]));
  const block = parseFooterBlocks([text({ textVi: '  Một   dòng\n\n\n\nHai  ' })])[0];
  assert.equal(block?.type === 'TEXT' ? block.textVi : '', 'Một dòng\n\nHai');
  // Markup is never interpreted: it is stored as the text it is.
  const markup = parseFooterBlocks([text({ textVi: '<b>Đậm</b>', textEn: '<b>Bold</b>' })])[0];
  assert.equal(markup?.type === 'TEXT' ? markup.textVi : '', '<b>Đậm</b>');
});

test('link list: 1 to 8 items, labels in both languages, https or an internal path, title in both or neither', () => {
  refused(() => parseFooterBlocks([links({ items: [] })]));
  refused(() => parseFooterBlocks([links({ items: undefined })]));
  refused(() =>
    parseFooterBlocks([
      links({
        items: Array.from({ length: 9 }, () => ({
          labelVi: 'A',
          labelEn: 'A',
          url: '/vi/services',
        })),
      }),
    ]),
  );
  refused(() => parseFooterBlocks([links({ items: [{ labelVi: 'A', labelEn: '', url: '/vi' }] })]));
  refused(() => parseFooterBlocks([links({ items: [{ labelVi: 'A', labelEn: 'A', url: '' }] })]));
  refused(() =>
    parseFooterBlocks([
      links({ items: [{ labelVi: 'A', labelEn: 'A', url: 'http://x.example' }] }),
    ]),
  );
  refused(() =>
    parseFooterBlocks([links({ items: [{ labelVi: 'A', labelEn: 'A', url: '//evil.example' }] })]),
  );
  refused(() =>
    parseFooterBlocks([
      links({ items: [{ labelVi: 'A', labelEn: 'A', url: 'javascript:alert(1)' }] }),
    ]),
  );
  refused(() =>
    parseFooterBlocks([links({ items: [{ labelVi: 'A', labelEn: 'A', url: '/services' }] })]),
  );
  refused(() => parseFooterBlocks([links({ titleEn: null })]));
  refused(() => parseFooterBlocks([links({ titleVi: 'x'.repeat(41), titleEn: 'ok' })]));
  const untitled = parseFooterBlocks([links({ titleVi: null, titleEn: '' })])[0];
  assert.equal(untitled?.type === 'LINKS' ? untitled.titleVi : 'x', null);
});

test('image block: a media id (UUID) and an optional https or internal link', () => {
  refused(() => parseFooterBlocks([image({ mediaId: 'logo.png' })]));
  refused(() => parseFooterBlocks([image({ mediaId: undefined })]));
  refused(() => parseFooterBlocks([image({ linkUrl: 'http://x.example' })]));
  refused(() => parseFooterBlocks([image({ linkUrl: 'data:text/html,x' })]));
  const parsed = parseFooterBlocks([
    image({ mediaId: id(90).toUpperCase(), linkUrl: '/{locale}/services' }),
  ]);
  assert.deepEqual(footerMediaIds(parsed), [id(90)]);
  assert.deepEqual(footerMediaIds(parseFooterBlocks([image(), image({ id: id(9) }), slogan()])), [
    id(90),
  ]);
});

test('stored blocks are read tolerantly: a bad entry is dropped, never an error', () => {
  const stored = [
    social(),
    { id: 'bad', type: 'SOCIAL' },
    'junk',
    text({ textEn: null }),
    slogan(),
  ];
  assert.deepEqual(
    readFooterBlocks(stored).map((block) => block.type),
    ['SOCIAL', 'SLOGAN'],
  );
  assert.deepEqual(readFooterBlocks({ not: 'a list' }), []);
});

const photo: PublicSiteImage = {
  alt: 'Lucy Spa',
  width: 800,
  height: 600,
  sources: [{ url: '/api/v1/public/media/x/md', width: 640 }],
};

test('public footer: visible, complete blocks only, in the visitor language, links resolved', () => {
  const blocks = parseFooterBlocks([
    social(),
    app({ id: id(20), visible: false }),
    text({ id: id(21) }),
    links({ id: id(22) }),
    image({ id: id(23), linkUrl: '/{locale}/services' }),
    slogan({ id: id(24) }),
  ]);
  const images = new Map([[id(90), photo]]);
  const vi = publicFooterBlocks(blocks, 'vi', 'Thư giãn tận tâm', images);
  assert.deepEqual(
    vi.map((block) => block.type),
    ['SOCIAL', 'TEXT', 'LINKS', 'IMAGE', 'SLOGAN'],
    'the hidden app block is left out',
  );
  const socialBlock = vi[0];
  assert.deepEqual(
    socialBlock?.type === 'SOCIAL' ? socialBlock.links.map((link) => link.network) : [],
    ['facebook', 'tiktok', 'messenger'],
    'networks keep the fixed order and a network with no link is not drawn',
  );
  const list = vi[2];
  assert.deepEqual(list?.type === 'LINKS' ? list.items : [], [
    { label: 'Dịch vụ', url: '/vi/services' },
    { label: 'Fanpage', url: 'https://facebook.com/lucyspa' },
  ]);
  assert.equal(list?.type === 'LINKS' ? list.title : '', 'Khám phá');
  assert.equal(vi[3]?.type === 'IMAGE' ? vi[3].linkUrl : '', '/vi/services');
  assert.equal(vi[4]?.type === 'SLOGAN' ? vi[4].text : '', 'Thư giãn tận tâm');
  const en = publicFooterBlocks(blocks, 'en', 'Relax with care', images);
  assert.equal(en[1]?.type === 'TEXT' ? en[1].text : '', 'Relax with care.\nOpen every day.');
  const enList = en[2];
  assert.equal(enList?.type === 'LINKS' ? enList.items[0]?.url : '', '/en/services');
  assert.equal(enList?.type === 'LINKS' ? enList.items[0]?.label : '', 'Services');
});

test('public footer: a block that would draw nothing is left out', () => {
  const blocks = parseFooterBlocks([image(), slogan({ id: id(30) })]);
  assert.deepEqual(
    publicFooterBlocks(blocks, 'vi', '', new Map()),
    [],
    'no picture, no slogan text',
  );
  assert.deepEqual(
    publicFooterBlocks([], 'vi', 'Slogan', new Map()),
    [],
    'no blocks: only the logo',
  );
  // Stored data that lost its links (tolerant read keeps no block of this kind, but a hand-edited row could).
  const empty = [
    {
      id: id(31),
      type: 'SOCIAL' as const,
      visible: true,
      urls: {
        facebook: null,
        zalo: null,
        tiktok: null,
        instagram: null,
        youtube: null,
        messenger: null,
      },
    },
  ];
  assert.deepEqual(publicFooterBlocks(empty, 'vi', 'x', new Map()), []);
});
