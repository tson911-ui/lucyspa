'use client';

import type { AssistantAnswer, AssistantStatus } from '@lucy-spa/contracts';
import {
  ButtonLink,
  Card,
  CardHeader,
  Cluster,
  ErrorState,
  Field,
  FormActions,
  Icon,
  Stack,
  Textarea,
} from '@lucy-spa/ui';
import { useRef, useState } from 'react';
import { assistantDictionary } from '../../../i18n/assistant';
import { fill } from '../../../i18n/workforce';
import {
  QUESTION_MAX,
  askErrorKey,
  blockKey,
  dayText,
  readyQuestion,
  reportHref,
  reportPages,
} from '../../../lib/workforce/assistant';
import { canGlobal } from '../../../lib/workforce/permissions';
import { useAccount, useWorkforce } from '../session';
import { Button, Notice, useResource } from '../ui';
import { AdminButtonLink } from './admin-button-link';

const BASE = '/api/v1/ai/assistant';

/**
 * The report assistant's question box (Claude integration Wave C, CI-S1): a card at the top of the report pages, only for the holders of
 * "Dùng trợ lý AI". It asks the server one question at a time; the answer quotes only numbers the report tools returned, says which dates it
 * used, and links to the report pages it read. When the assistant is off, the card says why instead of hiding. Nothing here writes.
 */
export function AssistantBox() {
  const { account } = useAccount();
  if (!canGlobal(account, 'USE_AI_ASSISTANT')) return null;
  return <Box />;
}

function Box() {
  const { api, t, locale, base } = useWorkforce();
  const text = assistantDictionary(locale);
  const status = useResource(() => api.get<AssistantStatus>(BASE), [api]);
  const [question, setQuestion] = useState('');
  const [pending, setPending] = useState(false);
  const [answer, setAnswer] = useState<AssistantAnswer | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const info = status.data;
  const ready = readyQuestion(question);
  // The button stays enabled; an empty question is explained at the field after a try (WIG Forms).
  const missing = tried && !ready.ok;

  async function ask() {
    if (pending) return;
    if (!ready.ok) {
      setTried(true);
      box.current?.focus();
      return;
    }
    setPending(true);
    setFailure(null);
    setAnswer(null);
    try {
      setAnswer(await api.post<AssistantAnswer>(`${BASE}/ask`, { question: ready.text }));
    } catch (error) {
      setFailure(text.errors[askErrorKey(error)]);
    } finally {
      setPending(false);
      void status.reload();
    }
  }

  const pages = answer ? reportPages(answer.reports) : [];
  // Switched off (no key, no rate, AI off): the card says so in one line, with no dead question box or disabled button above the figures
  // (plan reports-revenue: no dead UI).
  if (info && !info.available) {
    return (
      <Card as="section" aria-label={text.title}>
        <CardHeader title={text.title} />
        <p className="ls-adminb-note" role="status">
          <Icon name="info" size={16} />
          <span>{text.blocked[blockKey(info.block)]}</span>
        </p>
      </Card>
    );
  }
  return (
    <Card as="section" aria-label={text.title}>
      <CardHeader title={text.title} description={text.intro} />
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void ask();
        }}
      >
        <Stack gap="field">
          {status.error && !info ? (
            <ErrorState
              message={text.loadFailed}
              onRetry={() => void status.reload()}
              retryLabel={t.common.reload}
            />
          ) : null}
          <Field
            label={text.label}
            hint={fill(text.characters, {
              count: String([...question].length),
              max: String(QUESTION_MAX),
            })}
            error={missing ? text.empty : undefined}
          >
            {(control) => (
              <Textarea
                {...control}
                ref={box}
                name="question"
                autoComplete="off"
                rows={2}
                maxLength={QUESTION_MAX}
                placeholder={text.placeholder}
                value={question}
                disabled={pending}
                onChange={(event) => setQuestion(event.target.value)}
              />
            )}
          </Field>
          <FormActions
            {...(info && info.available && info.leftThisHour < 10
              ? { note: fill(text.left, { count: String(info.leftThisHour) }) }
              : {})}
            primary={
              <Button type="submit" variant="secondary" icon="sparkles" loading={pending}>
                {pending ? text.asking : text.ask}
              </Button>
            }
          />
        </Stack>
      </form>
      {failure ? <Notice tone="error">{failure}</Notice> : null}
      {/* A live region that is always mounted, so the answer is announced when it arrives (WIG Accessibility). */}
      <div aria-live="polite">
        {answer ? (
          <Stack gap="field">
            <h3 className="ls-adminb-heading">{text.answerTitle}</h3>
            <p>{answer.status === 'ANSWERED' ? answer.answer : text.unsure}</p>
            {answer.periods.length > 0 ? (
              <p className="ls-hint">
                {answer.periods
                  .map((period) =>
                    fill(text.period, { from: dayText(period.from), to: dayText(period.to) }),
                  )
                  .join(' ')}
              </p>
            ) : null}
            {pages.length > 0 ? (
              <Cluster>
                {pages.map((page) => (
                  <ButtonLink
                    key={page}
                    variant="secondary"
                    href={reportHref(base, page)}
                    LinkComponent={AdminButtonLink}
                  >
                    {`${text.openReport}: ${text.pages[page]}`}
                  </ButtonLink>
                ))}
              </Cluster>
            ) : null}
          </Stack>
        ) : null}
      </div>
    </Card>
  );
}
