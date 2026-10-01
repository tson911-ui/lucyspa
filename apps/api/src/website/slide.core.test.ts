import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { WebsiteSlideInput } from '@lucy-spa/contracts';
import { AuthError } from '../auth/auth.error.js';
import {
  MAX_VISIBLE_SLIDES,
  maxConcurrentSlides,
  parseSlideFields,
  slideStatus,
  type SlideWindow,
} from './slide.core.js';

const media = randomUUID();
const input = (patch: Partial<WebsiteSlideInput> = {}): WebsiteSlideInput => ({
  mediaId: media,
  mobileMediaId: null,
  titleVi: 'Tết',
  titleEn: null,
  subtitleVi: null,
  subtitleEn: null,
  linkUrl: null,
  linkLabelVi: null,
  linkLabelEn: null,
  altVi: null,
  altEn: null,
  startsAt: null,
  endsAt: null,
  isEnabled: false,
  ...patch,
});

const refused = (patch: Partial<WebsiteSlideInput>, field: string) =>
  assert.throws(
    () => parseSlideFields(input(patch)),
    (error: unknown) =>
      error instanceof AuthError && error.code === 'VALIDATION_FAILED' && error.field === field,
  );

const at = (value: string) => new Date(value);
const window = (startsAt: string | null, endsAt: string | null): SlideWindow => ({
  startsAt: startsAt === null ? null : at(startsAt),
  endsAt: endsAt === null ? null : at(endsAt),
});

test('slide status: Hidden is "not enabled"; an open window is Visible; ends are exclusive', () => {
  const start = at('2090-01-02T00:00:00Z');
  const end = at('2090-01-03T00:00:00Z');
  const status = (enabled: boolean, now: string, s: Date | null = start, e: Date | null = end) =>
    slideStatus(enabled, s, e, at(now));
  assert.equal(status(false, '2090-01-02T12:00:00Z'), 'HIDDEN');
  assert.equal(status(true, '2090-01-01T23:59:59.999Z'), 'SCHEDULED');
  assert.equal(status(true, '2090-01-02T00:00:00Z'), 'VISIBLE', 'the start instant is inside');
  assert.equal(status(true, '2090-01-03T00:00:00Z'), 'ENDED', 'the end instant is outside');
  assert.equal(status(true, '2099-01-01T00:00:00Z', null, null), 'VISIBLE', 'no window = always');
  assert.equal(
    status(true, '2090-01-01T00:00:00Z', null, end),
    'VISIBLE',
    'no start = from always',
  );
  assert.equal(status(true, '2090-06-01T00:00:00Z', start, null), 'VISIBLE', 'no end = for ever');
});

test('slide fields: the main image is required, text is normalized, the link and window rules hold', () => {
  const fields = parseSlideFields(
    input({
      titleVi: '  Khuyến   mãi  ',
      titleEn: '   ',
      linkUrl: ' /{locale}/account/book ',
      linkLabelVi: 'Đặt lịch',
      startsAt: '2090-01-01T00:00:00Z',
      endsAt: '2090-01-02T00:00:00+07:00',
      isEnabled: true,
    }),
  );
  assert.equal(fields.titleVi, 'Khuyến mãi');
  assert.equal(fields.titleEn, null);
  assert.equal(fields.linkUrl, '/{locale}/account/book');
  assert.equal(fields.mediaId, media);
  // Optional window ends: null stays null.
  const open = parseSlideFields(input());
  assert.equal(open.startsAt, null);
  assert.equal(open.endsAt, null);

  refused({ mediaId: null as unknown as string }, 'mediaId');
  refused({ mediaId: 'not-a-uuid' }, 'mediaId');
  refused({ mobileMediaId: 'nope' }, 'mobileMediaId');
  refused({ mobileMediaId: media }, 'mobileMediaId');
  refused({ titleVi: 'a'.repeat(121) }, 'titleVi');
  refused({ subtitleEn: 'a'.repeat(201) }, 'subtitleEn');
  refused({ altVi: 'a'.repeat(301) }, 'altVi');
  refused({ isEnabled: 'yes' as unknown as boolean }, 'isEnabled');
  refused({ linkUrl: 'javascript:alert(1)', linkLabelVi: 'x' }, 'linkUrl');
  refused({ linkUrl: '//evil.example', linkLabelVi: 'x' }, 'linkUrl');
  refused({ linkUrl: '/vi/account/book' }, 'linkLabel');
  refused({ linkLabelEn: 'Book' }, 'linkUrl');
  refused({ startsAt: '2090-01-01T00:00:00' }, 'startsAt');
  refused({ endsAt: 'tomorrow' }, 'endsAt');
  refused({ startsAt: '2090-01-02T00:00:00Z', endsAt: '2090-01-02T00:00:00Z' }, 'endsAt');
  // A slide may have no text at all: the image is the content.
  assert.doesNotThrow(() => parseSlideFields(input({ titleVi: null })));
});

test('visible limit: the busiest instant counts, touching windows do not, ended windows are ignored', () => {
  const now = at('2090-01-01T00:00:00Z');
  assert.equal(MAX_VISIBLE_SLIDES, 8);
  assert.equal(maxConcurrentSlides([], now), 0);
  // Always-on slides stack.
  assert.equal(
    maxConcurrentSlides(
      Array.from({ length: 8 }, () => window(null, null)),
      now,
    ),
    8,
  );
  assert.equal(
    maxConcurrentSlides(
      Array.from({ length: 9 }, () => window(null, null)),
      now,
    ),
    9,
  );
  // [a, b) and [b, c) never show together.
  assert.equal(
    maxConcurrentSlides(
      [
        window('2090-02-01T00:00:00Z', '2090-03-01T00:00:00Z'),
        window('2090-03-01T00:00:00Z', null),
      ],
      now,
    ),
    1,
  );
  // One overlapping day is enough to reach 2.
  assert.equal(
    maxConcurrentSlides(
      [
        window('2090-02-01T00:00:00Z', '2090-03-02T00:00:00Z'),
        window('2090-03-01T00:00:00Z', '2090-04-01T00:00:00Z'),
      ],
      now,
    ),
    2,
  );
  // Nine slides that each run on their own week never exceed one at a time, even with a 9th always-on one: 2.
  const weeks = Array.from({ length: 9 }, (_, index) =>
    window(
      new Date(Date.UTC(2090, 1, 1 + index * 7)).toISOString(),
      new Date(Date.UTC(2090, 1, 8 + index * 7)).toISOString(),
    ),
  );
  assert.equal(maxConcurrentSlides(weeks, now), 1);
  assert.equal(maxConcurrentSlides([...weeks, window(null, null)], now), 2);
  // Windows that ended before now can never be visible again.
  const past = Array.from({ length: 12 }, () =>
    window('2089-01-01T00:00:00Z', '2089-02-01T00:00:00Z'),
  );
  assert.equal(maxConcurrentSlides(past, now), 0);
});
