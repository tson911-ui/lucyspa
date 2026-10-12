'use client';

import {
  REVIEW_MAX_COMMENT,
  type CustomerReviewPrompt,
  type CustomerReviewView,
} from '@lucy-spa/contracts';
import {
  Button,
  Card,
  CardHeader,
  DescriptionList,
  Field,
  Notice,
  Reveal,
  SegmentedControl,
  Select,
  Textarea,
} from '@lucy-spa/ui';
import { useState } from 'react';
import { reviewDictionary, type ReviewDictionary } from '../../../i18n/customer-review';
import { fill } from '../../../i18n/customer';
import {
  reviewErrorKey,
  reviewRequest,
  STAR_CHOICES,
  type StarChoice,
} from '../../../lib/customer/review';
import { useCustomer } from '../session';
import { useFetch } from './bookings';

/**
 * The review card of a paid invoice (Phase 8 P8-17, Owner OQ-P8-7): 1 to 5 stars, an optional note and an optional rating of each person who
 * served, or "Để sau". PRIVATE: the card says so in its first lines. Once given, the card shows what was said and thanks the customer; the review
 * is never changed. If the prompt cannot be read (a network problem), the invoice page simply goes on without the card.
 */
export function ReviewCard({ invoiceId }: { invoiceId: string }) {
  const { api, locale } = useCustomer();
  const r = reviewDictionary(locale);
  const prompt = useFetch(
    () => api.get<CustomerReviewPrompt>(`/api/v1/me/reviews/invoices/${invoiceId}`),
    invoiceId,
  );
  const [given, setGiven] = useState<CustomerReviewView | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const data = prompt.data;
  if (!data) return null;
  const review = given ?? data.review;
  if (review) return <ReviewThanks review={review} r={r} />;
  if (!data.canReview || dismissed) return null;
  return <ReviewForm prompt={data} r={r} onGiven={setGiven} onLater={() => setDismissed(true)} />;
}

function stars(r: ReviewDictionary, value: number): string {
  return fill(r.stars, { n: value });
}

export function ReviewThanks({ review, r }: { review: CustomerReviewView; r: ReviewDictionary }) {
  return (
    <Reveal>
      <Card as="section" aria-label={r.thanksTitle}>
        <CardHeader title={r.thanksTitle} description={r.thanksText} />
        <DescriptionList
          items={[
            { label: r.yourRating, value: <strong>{stars(r, review.rating)}</strong> },
            ...(review.comment ? [{ label: r.commentLabel, value: review.comment }] : []),
            ...review.staff.map((person) => ({
              label: person.name,
              value: stars(r, person.rating),
            })),
          ]}
        />
      </Card>
    </Reveal>
  );
}

export function ReviewForm({
  prompt,
  r,
  onGiven,
  onLater,
}: {
  prompt: CustomerReviewPrompt;
  r: ReviewDictionary;
  onGiven: (review: CustomerReviewView) => void;
  onLater: () => void;
}) {
  const { api } = useCustomer();
  const [rating, setRating] = useState<StarChoice | ''>('');
  const [comment, setComment] = useState('');
  const [staff, setStaff] = useState<Record<string, StarChoice | '0'>>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = reviewRequest(prompt.invoiceId, rating, comment, staff);

  async function submit() {
    if (!request || pending) return;
    setPending(true);
    setError(null);
    try {
      onGiven(await api.post<CustomerReviewView>('/api/v1/me/reviews', request));
    } catch (failure) {
      setError(r.errors[reviewErrorKey(failure)]);
      setPending(false);
    }
  }

  const options = STAR_CHOICES.map((value) => ({ value, label: value }));
  return (
    <Reveal>
      <Card as="section" aria-label={r.title}>
        <CardHeader title={r.title} description={r.intro} />
        <form
          className="ls-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div>
            <p className="ls-label">{r.ratingLabel}</p>
            <SegmentedControl<StarChoice | ''>
              label={r.ratingLabel}
              value={rating}
              onChange={setRating}
              options={options}
            />
            <p className="ls-hint">{r.scale}</p>
          </div>
          <Field label={r.commentLabel} hint={fill(r.commentHint, { max: REVIEW_MAX_COMMENT })}>
            {(control) => (
              <Textarea
                {...control}
                value={comment}
                maxLength={REVIEW_MAX_COMMENT}
                placeholder={r.commentPlaceholder}
                onChange={(event) => setComment(event.target.value)}
              />
            )}
          </Field>
          {prompt.staff.length > 0 ? (
            <div>
              <p className="ls-label">{r.staffTitle}</p>
              <p className="ls-hint">{r.staffIntro}</p>
              <div className="ls-form">
                {prompt.staff.map((person) => (
                  <Field key={person.employeeUserId} label={person.name}>
                    {(control) => (
                      <Select
                        {...control}
                        value={staff[person.employeeUserId] ?? '0'}
                        onChange={(event) =>
                          setStaff((current) => ({
                            ...current,
                            [person.employeeUserId]: event.target.value as StarChoice | '0',
                          }))
                        }
                        options={[
                          { value: '0', label: r.staffSkip },
                          ...STAR_CHOICES.map((value) => ({
                            value,
                            label: fill(r.point, { n: value }),
                          })),
                        ]}
                      />
                    )}
                  </Field>
                ))}
              </div>
            </div>
          ) : null}
          {error ? <Notice tone="danger">{error}</Notice> : null}
          <div className="ls-form-actions">
            <Button type="button" variant="secondary" disabled={pending} onClick={onLater}>
              {r.later}
            </Button>
            <Button type="submit" variant="primary" loading={pending} disabled={request === null}>
              {pending ? r.submitting : r.submit}
            </Button>
          </div>
        </form>
      </Card>
    </Reveal>
  );
}
