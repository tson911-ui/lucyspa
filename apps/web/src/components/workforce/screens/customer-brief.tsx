'use client';

import type { CustomerBrief, ProductSuggestions } from '@lucy-spa/contracts';
import { DescriptionList, Drawer, Stack } from '@lucy-spa/ui';
import { briefDictionary } from '../../../i18n/brief';
import { fill } from '../../../i18n/workforce';
import { dayText } from '../../../lib/workforce/assistant';
import { useWorkforce } from '../session';
import { Button, Loading, Notice, useResource } from '../ui';
import { listFormat, sentence } from './pos-format';

const BASE = '/api/v1/briefs/lines';

/**
 * The customer card of the staff member serving a visit (Claude integration Wave D, CI-S2 and CI-S3): the facts from earlier visits
 * (computed by code), the summary of staff notes, and up to three talking points about cosmetics. Opened from the service card's menu; the
 * server checks that this person is the one assigned, holds the right at the branch, and that the visit is open. Nothing here is sent to
 * the customer and nothing writes.
 */
export function CustomerBriefDrawer({
  lineId,
  serviceName,
  onClose,
}: {
  lineId: string;
  serviceName: string;
  onClose: () => void;
}) {
  const { api, t, locale } = useWorkforce();
  const text = briefDictionary(locale);
  const brief = useResource(() => api.get<CustomerBrief>(`${BASE}/${lineId}`), [api, lineId]);
  // The talking points are asked for once the card is open (a second call; each is audited).
  const points = useResource(
    () => api.get<ProductSuggestions>(`${BASE}/${lineId}/suggestions`),
    [api, lineId],
  );
  const data = brief.data;
  const forbidden = Reflect.get(Object(brief.error), 'code') === 'FORBIDDEN';

  return (
    <Drawer
      open
      // One dictionary template, not a title glued together in code (wig Locale & i18n).
      title={fill(text.titleFor, { service: serviceName })}
      closeLabel={t.common.close}
      onClose={onClose}
      footer={
        <Button variant="secondary" onClick={onClose}>
          {text.close}
        </Button>
      }
    >
      <Stack gap="page">
        <p className="ls-hint">{text.intro}</p>
        {brief.error && !data ? (
          <Notice tone={forbidden ? 'warning' : 'error'}>
            {forbidden ? text.forbidden : text.loadFailed}
          </Notice>
        ) : !data ? (
          <Loading t={t} />
        ) : !data.available ? (
          <Notice tone="info">
            {text.blocked[(data.block ?? 'OTHER') as keyof typeof text.blocked] ??
              text.blocked.OTHER}
          </Notice>
        ) : (
          <>
            <Stack gap="field">
              <h3 className="ls-pos-brief-heading">{text.facts.title}</h3>
              {data.facts && data.facts.known ? (
                data.facts.visits === 0 ? (
                  <p>{text.facts.firstTime}</p>
                ) : (
                  <DescriptionList
                    items={[
                      { label: text.facts.visits, value: String(data.facts.visits) },
                      {
                        label: text.facts.last,
                        value: data.facts.lastVisitDate
                          ? dayText(data.facts.lastVisitDate)
                          : text.facts.none,
                      },
                      { label: text.facts.ktv, value: data.facts.lastKtvName ?? text.facts.none },
                      {
                        label: text.facts.gap,
                        value:
                          data.facts.averageGapDays === null
                            ? text.facts.none
                            : fill(text.facts.gapDays, {
                                count: String(data.facts.averageGapDays),
                              }),
                      },
                      {
                        label: text.facts.services,
                        value:
                          data.facts.usualServices.length === 0
                            ? text.facts.none
                            : listFormat(locale).format(
                                data.facts.usualServices.map((entry) =>
                                  fill(text.facts.times, {
                                    name: entry.name,
                                    count: String(entry.times),
                                  }),
                                ),
                              ),
                      },
                      {
                        label: text.facts.products,
                        value:
                          data.facts.productsBefore.length === 0
                            ? text.facts.none
                            : listFormat(locale).format(data.facts.productsBefore),
                      },
                    ]}
                  />
                )
              ) : (
                <p>{text.facts.unknown}</p>
              )}
            </Stack>
            <Stack gap="field">
              <h3 className="ls-pos-brief-heading">{text.summary.title}</h3>
              {data.summaryStatus === 'READY' && data.summary ? (
                <>
                  <p>{data.summary}</p>
                  <p className="ls-hint">{text.summary.aiNote}</p>
                </>
              ) : data.summaryStatus === 'UNAVAILABLE' ? (
                <p className="ls-hint">{text.summary.unavailable}</p>
              ) : (
                <p className="ls-hint">{text.summary.none}</p>
              )}
            </Stack>
            <Stack gap="field">
              <h3 className="ls-pos-brief-heading">{text.suggestions.title}</h3>
              <p className="ls-hint">{text.suggestions.intro}</p>
              {/* The talking points arrive from a second request: the region announces them when they come (wig :136). */}
              <div aria-live="polite">
                {points.loading && !points.data ? (
                  <p className="ls-hint">{text.suggestions.loading}</p>
                ) : points.data && points.data.available && points.data.items.length > 0 ? (
                  <ul>
                    {points.data.items.map((item) => (
                      <li key={item.productId}>
                        <strong>{sentence(item.name)}</strong> {item.line}
                      </li>
                    ))}
                  </ul>
                ) : points.error || points.data?.status === 'UNAVAILABLE' ? (
                  <p className="ls-hint">{text.suggestions.unavailable}</p>
                ) : (
                  <p className="ls-hint">{text.suggestions.none}</p>
                )}
              </div>
            </Stack>
          </>
        )}
      </Stack>
    </Drawer>
  );
}
