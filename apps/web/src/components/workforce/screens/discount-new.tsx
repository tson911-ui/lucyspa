'use client';

import type { DiscountDetailResponse } from '@lucy-spa/contracts';
import { Breadcrumbs, Card, FormActions, Page, Stack, useUnsavedChangesGuard } from '@lucy-spa/ui';
import { PrefetchLink as Link } from '../link';
import { useState, type FormEvent } from 'react';
import { organizationDictionary } from '../../../i18n/organization';
import {
  createRequestOf,
  discountErrorMessage,
  emptyDiscountForm,
  type DiscountForm,
} from '../../../lib/workforce/discounts';
import { canGlobal } from '../../../lib/workforce/permissions';
import { useAccount, useWorkforce } from '../session';
import { Button, Notice, PageHeader, useSuccessToast } from '../ui';
import { DiscountFormFields } from './discount-form';

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
  const dirty = JSON.stringify(form) !== JSON.stringify(emptyDiscountForm());
  useUnsavedChangesGuard(dirty && !pending);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
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
            LinkComponent={Link}
            items={[{ label: d.title, href: back }, { label: d.createTitle }]}
          />
        }
      />
      {!canGlobal(account, 'MANAGE_DISCOUNTS') ? (
        <Notice tone="info">{t.errors.forbidden}</Notice>
      ) : (
        <form noValidate onSubmit={(event) => void submit(event)} aria-label={d.createTitle}>
          <Stack gap="block">
            <Card as="section" aria-label={d.createTitle}>
              <Stack gap="page">
                <DiscountFormFields form={form} setForm={setForm} mode="create" columns={2} />
                {message ? <Notice tone="error">{message}</Notice> : null}
              </Stack>
            </Card>
            <FormActions
              cancel={
                <Button variant="secondary" onClick={() => navigate?.(back)} disabled={pending}>
                  {t.common.cancel}
                </Button>
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
