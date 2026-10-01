import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WebsitePopupInput } from '@lucy-spa/contracts';
import { AuthError } from '../auth/auth.error.js';
import { parsePopupFields, popupStatus, validPopupUrl } from './popup.core.js';

const input = (patch: Partial<WebsitePopupInput> = {}): WebsitePopupInput => ({
  mediaId: null,
  titleVi: 'Tết',
  titleEn: null,
  bodyVi: null,
  bodyEn: null,
  ctaLabelVi: null,
  ctaLabelEn: null,
  ctaUrl: null,
  startsAt: '2090-01-01T00:00:00Z',
  endsAt: '2090-01-02T00:00:00+07:00',
  isEnabled: false,
  ...patch,
});

const refused = (patch: Partial<WebsitePopupInput>, field: string) =>
  assert.throws(
    () => parsePopupFields(input(patch)),
    (error: unknown) =>
      error instanceof AuthError && error.code === 'VALIDATION_FAILED' && error.field === field,
  );

test('popup status: Draft is "not enabled"; enabled is Scheduled, Active, then Ended at the end instant', () => {
  const start = new Date('2090-01-02T00:00:00Z');
  const end = new Date('2090-01-03T00:00:00Z');
  const status = (enabled: boolean, now: string) => popupStatus(enabled, start, end, new Date(now));
  assert.equal(status(false, '2090-01-02T12:00:00Z'), 'DRAFT');
  assert.equal(
    status(false, '2091-01-01T00:00:00Z'),
    'DRAFT',
    'a disabled popup is a draft even when past',
  );
  assert.equal(status(true, '2090-01-01T23:59:59.999Z'), 'SCHEDULED');
  assert.equal(status(true, '2090-01-02T00:00:00Z'), 'ACTIVE', 'the start instant is inside');
  assert.equal(status(true, '2090-01-02T23:59:59.999Z'), 'ACTIVE');
  assert.equal(status(true, '2090-01-03T00:00:00Z'), 'ENDED', 'the end instant is outside');
});

test('popup link: an internal /vi, /en or /{locale} path or an https URL, nothing else', () => {
  for (const ok of [
    '/vi',
    '/en',
    '/vi/account/book',
    '/en/account/book?x=1#top',
    '/{locale}',
    '/{locale}/account/book',
    'https://example.com',
    'https://example.com/promo?utm=1',
    'https://sub.example.com:8443/a',
  ]) {
    assert.equal(validPopupUrl(ok), true, ok);
  }
  for (const bad of [
    '',
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,hi',
    'vbscript:x',
    'http://example.com',
    '//evil.example/x',
    '/\\evil.example',
    '/vimeo',
    '/fr/home',
    '/{locale}x',
    '/vi/a b',
    '/vi/<script>',
    '/vi/"x"',
    'https://',
    'https:///x',
    'https://user:pw@example.com',
    'https://exa mple.com',
    'ftp://example.com',
    `https://example.com/${'a'.repeat(500)}`,
  ]) {
    assert.equal(validPopupUrl(bad), false, bad);
  }
});

test('popup fields: text is normalized to plain text, limits and pairings are enforced with a field name', () => {
  const fields = parsePopupFields(
    input({
      titleVi: '  Khuyến   mãi\tTết ',
      titleEn: '   ',
      bodyVi: ' Dòng 1  \r\n\r\n\r\n\r\n Dòng 2 ',
      ctaLabelVi: 'Đặt lịch',
      ctaUrl: ' /vi/account/book ',
      isEnabled: true,
    }),
  );
  assert.equal(fields.titleVi, 'Khuyến mãi Tết');
  assert.equal(fields.titleEn, null);
  assert.equal(fields.bodyVi, 'Dòng 1\n\nDòng 2');
  assert.equal(fields.ctaUrl, '/vi/account/book');
  assert.equal(fields.startsAt.toISOString(), '2090-01-01T00:00:00.000Z');
  assert.equal(fields.endsAt.toISOString(), '2090-01-01T17:00:00.000Z', 'an offset is honoured');
  assert.equal(fields.isEnabled, true);
  // The body is plain text: markup is kept as text, never interpreted, and counted in characters.
  assert.equal(parsePopupFields(input({ bodyVi: '<b>x</b>' })).bodyVi, '<b>x</b>');
  assert.equal(parsePopupFields(input({ bodyVi: 'ệ'.repeat(300) })).bodyVi?.length, 300);

  refused({ titleVi: null }, 'title');
  refused({ titleVi: '  ', titleEn: ' ' }, 'title');
  refused({ titleVi: 'x'.repeat(121) }, 'titleVi');
  refused({ titleEn: 'x'.repeat(121) }, 'titleEn');
  refused({ bodyVi: 'x'.repeat(301) }, 'bodyVi');
  refused({ bodyEn: 'x\u0000y' }, 'bodyEn');
  refused({ titleVi: 'a\u0007b' }, 'titleVi');
  refused({ titleVi: 5 as unknown as string }, 'titleVi');
  refused({ ctaLabelVi: 'x'.repeat(41), ctaUrl: '/vi' }, 'ctaLabelVi');
  refused({ ctaLabelVi: 'Go', ctaUrl: 'javascript:alert(1)' }, 'ctaUrl');
  refused({ ctaLabelVi: null, ctaUrl: '/vi' }, 'ctaLabel');
  refused({ ctaLabelVi: 'Go', ctaUrl: null }, 'ctaUrl');
  refused({ mediaId: 'not-a-uuid' }, 'mediaId');
  refused({ isEnabled: 'true' as unknown as boolean }, 'isEnabled');
  refused({ startsAt: '2090-01-02T00:00:00Z', endsAt: '2090-01-02T00:00:00Z' }, 'endsAt');
  refused({ startsAt: '2090-01-03T00:00:00Z', endsAt: '2090-01-02T00:00:00Z' }, 'endsAt');
  refused({ startsAt: '2090-01-01T10:00:00' }, 'startsAt');
  refused({ startsAt: '2090-13-01T10:00:00Z' }, 'startsAt');
  refused({ endsAt: null as unknown as string }, 'endsAt');
  // An image alone is enough content, and the id is lower-cased.
  const id = '2F1B2D8E-5C3A-4B7A-9D2E-1A2B3C4D5E6F';
  const withImage = parsePopupFields(input({ mediaId: id, titleVi: null }));
  assert.equal(withImage.mediaId, id.toLowerCase());
});
