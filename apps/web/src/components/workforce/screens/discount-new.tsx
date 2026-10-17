'use client';

import type { DiscountDetailResponse } from '@lucy-spa/contracts';
import {
  Breadcrumbs,
  ButtonLink,
  Card,
  FormActions,
  Page,
  Stack,
  focusFirstInvalid,
  useUnsavedChangesGuard,
} from '@lucy-spa/ui';
import { ListCrumbLink } from '../link';
import { useRef, useState, type FormEvent } from 'react';
import { organizationDictionary } from '../../../i18n/organization';
import {
  createRequestOf,
  discountErrorMessage,
  discountFieldProblems,
  emptyDiscountForm,
  type DiscountForm,
} from '../../../lib/workforce/discounts';
import { canGlobal } from '../../../lib/workforce/permissions';
import { useAccount, useWorkforce } from '../session';
import { Button, Empty, Notice, PageHeader, useSuccessToast } from '../ui';
import { DiscountFormFields, discountFieldErrors } from './discount-form';
import { AdminButtonLink } from './admin-button-link';

/**
 * "New discount program" on its own page (long form, contract FR9): `/discounts/new`. After the
 * program is created its page opens with a toast. Programs are created only with MANAGE_DISCOUNTS.
 */
export function DiscountNewScreen() {
  const { api, t, locale, base, navigate } = useWorkforce();
  const { account } = useAccount();
  const notify = useSuccessToast();
  const text = organizationDictionary(locale);
  const d = t.discounts;
  const back = `${base}/discounts`;
  const [form, setForm] = useState<DiscountForm>(emptyDiscountForm);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // After the first submit every field shows its own problem, and the errors follow the typing (validate on submit).
  const [checked, setChecked] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const errors = checked
    ? discountFieldErrors(discountFieldProblems(form, 'create'), d.problems)
    : {};
  const dirty = JSON.stringify(form) !== JSON.stringify(emptyDiscountForm());
  useUnsavedChangesGuard(dirty && !pending);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setChecked(true);
    if (Object.keys(discountFieldProblems(form, 'create')).length > 0) {
      setMessage(null);
      // The errors render on the next frame; then the first invalid field takes focus.
      requestAnimationFrame(() => {
        if (formRef.current) focusFirstInvalid(formRef.current);
      });
      return;
    }
    const request = createRequestOf(form);
    if ('problem' in request) {
      setMessage(d.problems[request.problem]);
      return;
    }
    setPending(true);
    setMessage(null);
    try {
      const created = await api.post<DiscountDetailResponse>('/api/v1/discounts', request.body);
      notify(d.created);
      navigate?.(`${back}/${created.id}`);
    } catch (error) {
      setMessage(discountErrorMessage(error, t));
      setPending(false);
    }
  }

  return (
    <Page width="form">
      <PageHeader
        title={d.createTitle}
        breadcrumbs={
          <Breadcrumbs
            label={text.breadcrumbs}
            LinkComponent={ListCrumbLink}
            items={[{ label: d.title, href: back }, { label: d.createTitle }]}
          />
        }
      />
      {!canGlobal(account, 'MANAGE_DISCOUNTS') ? (
        // Heading, one sentence and the way back (never a dead end).
        <Empty
          title={d.forbiddenTitle}
          action={
            <ButtonLink LinkComponent={AdminButtonLink} href={back} variant="secondary">
              {d.backToList}
            </ButtonLink>
          }
        >
          {d.forbiddenNext}
        </Empty>
      ) : (
        <form
          ref={formRef}
          noValidate
          onSubmit={(event) => void submit(event)}
          aria-label={d.createTitle}
        >
          <Stack gap="block">
            <Card as="section" aria-label={d.createTitle}>
              <Stack gap="page">
                <DiscountFormFields
                  form={form}
                  setForm={setForm}
                  mode="create"
                  columns={2}
                  errors={errors}
                />
                {message ? <Notice tone="error">{message}</Notice> : null}
              </Stack>
            </Card>
            <FormActions
              // Cancel goes back to the list: a real link in the secondary (outline) style, never filled.
              cancel={
                <ButtonLink LinkComponent={AdminButtonLink} href={back} variant="secondary">
                  {t.common.cancel}
                </ButtonLink>
              }
              primary={
                <Button type="submit" variant="primary" loading={pending}>
                  {pending ? d.saving : d.create}
                </Button>
              }
            />
          </Stack>
        </form>
      )}
    </Page>
  );
}
