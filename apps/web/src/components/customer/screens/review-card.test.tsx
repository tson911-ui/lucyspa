import type { CustomerReviewPrompt, CustomerReviewView } from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { getCustomerDictionary } from '../../../i18n/customer';
import { reviewDictionary } from '../../../i18n/customer-review';
import type { Locale } from '../../../i18n/locales';
import { ApiClient } from '../../../lib/api/client';
import { CustomerContext } from '../session';
import { ReviewForm, ReviewThanks } from './review-card';

/** A real context and an API whose requests never settle. */
function paint(node: ReactNode, locale: Locale = 'vi'): string {
  const api = new ApiClient({ fetch: () => new Promise<Response>(() => undefined) });
  return renderToStaticMarkup(
    <CustomerContext.Provider
      value={{
        locale,
        t: getCustomerDictionary(locale),
        api,
        base: `/${locale}/account`,
        sessionLost: false,
      }}
    >
      <AppRouterContext.Provider
        value={{ push: () => undefined, replace: () => undefined } as never}
      >
        {node}
      </AppRouterContext.Provider>
    </CustomerContext.Provider>,
  );
}

const r = reviewDictionary('vi');
const prompt: CustomerReviewPrompt = {
  invoiceId: 'inv-1',
  canReview: true,
  review: null,
  staff: [
    { employeeUserId: 'e1', name: 'Thu Hà' },
    { employeeUserId: 'e2', name: 'Minh Anh' },
  ],
};

test('the review card: private and skippable said first, five stars, an optional note, each person rated or skipped, "Để sau" then "Gửi đánh giá"', () => {
  const html = paint(
    <ReviewForm prompt={prompt} r={r} onGiven={() => undefined} onLater={() => undefined} />,
  );
  assert.match(html, /Đánh giá của bạn/);
  assert.match(html, /không đăng công khai/);
  assert.match(html, /Bạn có thể bỏ qua/);
  // The stars are one radio group; each person's own rating is a select that starts on "Bỏ qua".
  assert.equal(html.match(/role="radiogroup"/g)?.length, 1);
  assert.equal(html.match(/<select/g)?.length, 2);
  for (const value of ['1', '2', '3', '4', '5']) assert.match(html, new RegExp(`>${value}<`));
  assert.match(html, /Thu Hà/);
  assert.match(html, /Minh Anh/);
  assert.match(html, /<option value="0"[^>]*>Bỏ qua<\/option>/);
  assert.match(html, /Điều bạn muốn nhắn/);
  assert.match(html, /Tối đa 1000 ký tự/);
  assert.match(html, /maxLength="1000"|maxlength="1000"/i);
  // The footer reads "Để sau" (neutral, never filled) then the primary action last. The primary stays usable before a rating is chosen:
  // used then, it says what is missing (wig review-card.tsx:178), so it is not disabled.
  assert.ok(html.indexOf('Để sau') < html.indexOf('Gửi đánh giá'));
  assert.match(html, /class="[^"]*ls-btn-neutral[^"]*"[^>]*>(<[^>]*>)*Để sau/);
  assert.doesNotMatch(html, /<button[^>]*disabled[^>]*>[^<]*(<[^>]*>)*[^<]*Gửi đánh giá/);
  assert.equal(html.match(/ls-btn-primary/g)?.length, 1, 'one filled button');
  assert.doesNotMatch(html, /wf-|<details/);
});

test('a card for a sale with nobody to rate has no list of people', () => {
  const html = paint(
    <ReviewForm
      prompt={{ ...prompt, staff: [] }}
      r={r}
      onGiven={() => undefined}
      onLater={() => undefined}
    />,
  );
  assert.equal(html.match(/role="radiogroup"/g)?.length, 1);
  assert.equal(html.match(/<select/g), null);
  assert.doesNotMatch(html, new RegExp(r.staffTitle));
});

test('after the review: thanks, what was said and how each person was rated; nothing to change', () => {
  const review: CustomerReviewView = {
    rating: 5,
    comment: 'Rất hài lòng',
    createdAt: '2026-10-12T03:00:00.000Z',
    staff: [{ name: 'Thu Hà', rating: 4 }],
  };
  const html = paint(<ReviewThanks review={review} r={r} />);
  assert.match(html, /Cảm ơn bạn đã đánh giá/);
  assert.match(html, /5\/5 sao/);
  assert.match(html, /Rất hài lòng/);
  assert.match(html, /Thu Hà/);
  assert.match(html, /4\/5 sao/);
  assert.doesNotMatch(html, /<form|<button/);
});

test('English: the card in English', () => {
  const en = reviewDictionary('en');
  const html = paint(
    <ReviewForm prompt={prompt} r={en} onGiven={() => undefined} onLater={() => undefined} />,
    'en',
  );
  assert.match(html, /Your review/);
  assert.match(html, /never posted/);
  assert.match(html, /Send review/);
  assert.match(html, /Not now/);
});
