'use client';

import { SERVICE_CONTENT_LIMITS, type ServiceFaqItem } from '@lucy-spa/contracts';
import { Cluster, Field, FormGrid, FormSection, Stack, Textarea, TextInput } from '@lucy-spa/ui';
import { fill } from '../../../i18n/workforce';
import {
  contentProblem,
  FAQ_KEYS,
  type ServiceContentForm,
} from '../../../lib/workforce/service-content';
import { useWorkforce } from '../session';
import { Button, Notice } from '../ui';

const LIST_FIELDS = [
  { key: 'includedVi', hint: 'includedHint', max: SERVICE_CONTENT_LIMITS.listItems },
  { key: 'includedEn', hint: 'includedHint', max: SERVICE_CONTENT_LIMITS.listItems },
  { key: 'stepsVi', hint: 'stepsHint', max: SERVICE_CONTENT_LIMITS.listItems },
  { key: 'stepsEn', hint: 'stepsHint', max: SERVICE_CONTENT_LIMITS.listItems },
] as const;

/**
 * The optional content of a service page (redesign group 1, C11b), inside the existing service form: what is included and the steps
 * (a text box, one item per line) and the FAQ (question and answer rows), each in Vietnamese and in English. Empty = that block is
 * not drawn for customers. The form look is unchanged: the same fields, grid and buttons as the rest of the form.
 */
export function ServiceContentFields({
  value,
  onChange,
}: {
  value: ServiceContentForm;
  onChange: (next: ServiceContentForm) => void;
}) {
  const { t } = useWorkforce();
  const text = t.services;
  const broken = contentProblem(value);
  const faqHint = fill(text.faqHint, { max: String(SERVICE_CONTENT_LIMITS.faqItems) });

  function setPair(key: (typeof FAQ_KEYS)[number], index: number, patch: Partial<ServiceFaqItem>) {
    onChange({
      ...value,
      [key]: value[key].map((row, at) => (at === index ? { ...row, ...patch } : row)),
    });
  }

  return (
    <FormSection title={text.contentSection} description={text.contentHint}>
      <FormGrid cols={2}>
        {LIST_FIELDS.map(({ key, hint, max }) => (
          <Field
            key={key}
            label={text[key]}
            hint={fill(text[hint], { max: String(max) })}
            error={broken === key ? fill(text[hint], { max: String(max) }) : undefined}
          >
            {(control) => (
              <Textarea
                {...control}
                name={key}
                rows={5}
                value={value[key]}
                onChange={(event) => onChange({ ...value, [key]: event.target.value })}
              />
            )}
          </Field>
        ))}
      </FormGrid>
      <FormGrid cols={2}>
        {FAQ_KEYS.map((key) => (
          <Stack key={key}>
            {/* A heading, not a styled paragraph: the FAQ group is a sub-section of "Nội dung trang dịch vụ" (h3). */}
            <h4 className="ls-form-section-title">{text[key]}</h4>
            <p className="ls-hint">{faqHint}</p>
            {broken === key ? <Notice tone="error">{faqHint}</Notice> : null}
            {value[key].map((row, index) => (
              <Stack key={index}>
                <Field label={text.faqQuestion}>
                  {(control) => (
                    <TextInput
                      {...control}
                      name="question"
                      maxLength={SERVICE_CONTENT_LIMITS.faqQuestionMaxCodePoints}
                      value={row.question}
                      onChange={(event) => setPair(key, index, { question: event.target.value })}
                    />
                  )}
                </Field>
                <Field label={text.faqAnswer}>
                  {(control) => (
                    <Textarea
                      {...control}
                      name="answer"
                      rows={3}
                      maxLength={SERVICE_CONTENT_LIMITS.faqAnswerMaxCodePoints}
                      value={row.answer}
                      onChange={(event) => setPair(key, index, { answer: event.target.value })}
                    />
                  )}
                </Field>
                <Cluster>
                  <Button
                    variant="ghost"
                    icon="trash"
                    onClick={() =>
                      onChange({ ...value, [key]: value[key].filter((_, at) => at !== index) })
                    }
                  >
                    {text.faqRemove}
                  </Button>
                </Cluster>
              </Stack>
            ))}
            <Cluster>
              <Button
                variant="secondary"
                icon="plus"
                disabled={value[key].length >= SERVICE_CONTENT_LIMITS.faqItems}
                onClick={() =>
                  onChange({ ...value, [key]: [...value[key], { question: '', answer: '' }] })
                }
              >
                {text.faqAdd}
              </Button>
            </Cluster>
          </Stack>
        ))}
      </FormGrid>
    </FormSection>
  );
}
