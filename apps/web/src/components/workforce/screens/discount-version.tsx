'use client';

import type { DiscountDetailResponse } from '@lucy-spa/contracts';
import { Breadcrumbs, Card, FormActions, Page, Stack, useUnsavedChangesGuard } from '@lucy-spa/ui';
import { PrefetchLink as Link } from '../link';
import { useEffect, useState, type FormEvent } from 'react';
import { organizationDictionary } from '../../../i18n/organization';
import {
  discountErrorMessage,
  formFromProgram,
  versionRequestOf,
  type DiscountForm,
} from '../../../lib/workforce/discounts';
import { discountName } from '../../../lib/workforce/discounts-list';
import { useWorkforce } from '../session';
import { Button, ErrorState, Loading, Notice, PageHeader, useSuccessToast } from '../ui';
import { DiscountFormFields } from './discount-form';

/**
 * "New version" of a discount program on its own page (long form, contract FR9): the same sections as the
 * create page, prefilled from what is in force. The old version is never edited. Needs MANAGE_DISCOUNTS and
 * a program that has not ended; after saving the program page opens with a toast.
 */
export function DiscountVersionScreen({ id }: { id: string }) {
  const { api, t } = useWorkforce();
  const [program, setProgram] = useState<DiscountDetailResponse | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);

  useEffect(() => {
    let active = true;
    api
      .get<DiscountDetailResponse>(`/api/v1/discounts/${id}`)
      .then((data) => active && setProgram(data))
      .catch((error: unknown) => active && setLoadError(error));
    return () => {
      active = false;
    };
  }, [api, id]);

  if (loadError && !program) return <ErrorState error={loadError} t={t} />;
  if (!program) return <Loading t={t} page />;
  return <VersionPage program={program} />;
}

function VersionPage({ program }: { program: DiscountDetailResponse }) {
  const { api, t, locale, base, navigate } = useWorkforce();
  const notify = useSuccessToast();
  const text = organizationDictionary(locale);
  const d = t.discounts;
  const title = discountName(program, locale);
  const back = `${base}/discounts/${program.id}`;
  const allowed = program.permissions.manage && program.status !== 'TERMINATED';
  const [form, setForm] = useState<DiscountForm>(() => formFromProgram(program));
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const dirty = JSON.stringify(form) !== JSON.stringify(formFromProgram(program));
  useUnsavedChangesGuard(dirty && !pending);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    const request = versionRequestOf(form, program.version);
    if ('problem' in request) {
      setMessage(d.problems[request.problem]);
      return;
    }
    setPending(true);
    setMessage(null);
    try {
      await api.post<DiscountDetailResponse>(
        `/api/v1/discounts/${program.id}/versions`,
        request.body,
      );
      notify(d.versionSaved);
      navigate?.(back);
    } catch (failure) {
      setMessage(discountErrorMessage(failure, t));
      setPending(false);
    }
  }

  return (
    <Page width="form">
      <PageHeader
        title={d.newVersion}
        intro={title}
        breadcrumbs={
          <Breadcrumbs
            label={text.breadcrumbs}
            LinkComponent={Link}
            items={[
              { label: d.title, href: `${base}/discounts` },
              { label: title, href: back },
              { label: d.newVersion },
            ]}
          />
        }
      />
      {!allowed ? (
        <Notice tone="info">{d.errors.DISCOUNT_STATE_INVALID}</Notice>
      ) : (
        <form noValidate onSubmit={(event) => void submit(event)} aria-label={d.newVersion}>
          <Stack gap="block">
            <Card as="section" aria-label={d.newVersion}>
              <Stack gap="page">
                <p className="ls-hint">{d.newVersionHint}</p>
                <DiscountFormFields form={form} setForm={setForm} mode="version" columns={2} />
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
                  {pending ? d.saving : d.save}
                </Button>
              }
            />
          </Stack>
        </form>
      )}
    </Page>
  );
}
