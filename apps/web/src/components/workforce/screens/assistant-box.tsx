'use client';

import type { AssistantAnswer, AssistantStatus } from '@lucy-spa/contracts';
import {
  ButtonLink,
  Card,
  CardHeader,
  Cluster,
  Field,
  FormActions,
  Stack,
  Textarea,
} from '@lucy-spa/ui';
import { useState } from 'react';
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
  const { api, locale, base } = useWorkforce();
  const text = assistantDictionary(locale);
  const status = useResource(() => api.get<AssistantStatus>(BASE), [api]);
  const [question, setQuestion] = useState('');
  const [pending, setPending] = useState(false);
  const [answer, setAnswer] = useState<AssistantAnswer | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const info = status.data;
  const ready = readyQuestion(question);

  async function ask() {
    if (pending || !ready.ok) return;
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
          {status.error && !info ? <Notice tone="error">{text.loadFailed}</Notice> : null}
          {info && !info.available ? (
            <Notice tone="info">{text.blocked[blockKey(info.block)]}</Notice>
          ) : null}
          <Field
            label={text.label}
            hint={fill(text.characters, {
              count: String([...question].length),
              max: String(QUESTION_MAX),
            })}
          >
            {(control) => (
              <Textarea
                {...control}
                rows={2}
                maxLength={QUESTION_MAX}
                placeholder={text.placeholder}
                value={question}
                disabled={pending || info?.available === false}
                onChange={(event) => setQuestion(event.target.value)}
              />
            )}
          </Field>
          <FormActions
            {...(info && info.available && info.leftThisHour < 10
              ? { note: fill(text.left, { count: String(info.leftThisHour) }) }
              : {})}
            primary={
              <Button
                type="submit"
                variant="secondary"
                icon="sparkles"
                loading={pending}
                disabled={!ready.ok || info?.available !== true}
              >
                {pending ? text.asking : text.ask}
              </Button>
            }
          />
        </Stack>
      </form>
      {failure ? <Notice tone="error">{failure}</Notice> : null}
      {answer ? (
        <Stack gap="field">
          <h3>{text.answerTitle}</h3>
          <p aria-live="polite">{answer.status === 'ANSWERED' ? answer.answer : text.unsure}</p>
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
                <ButtonLink key={page} variant="secondary" href={reportHref(base, page)}>
                  {`${text.openReport}: ${text.pages[page]}`}
                </ButtonLink>
              ))}
            </Cluster>
          ) : null}
        </Stack>
      ) : null}
    </Card>
  );
}
