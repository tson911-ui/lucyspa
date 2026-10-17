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
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { organizationDictionary } from '../../../i18n/organization';
import {
  discountErrorMessage,
  discountFieldProblems,
  formFromProgram,
  versionRequestOf,
  type DiscountForm,
} from '../../../lib/workforce/discounts';
import { discountName } from '../../../lib/workforce/discounts-list';
import { useWorkforce } from '../session';
import { Button, Empty, ErrorState, Loading, Notice, PageHeader, useSuccessToast } from '../ui';
import { DiscountFormFields, discountFieldErrors } from './discount-form';
import { AdminButtonLink } from './admin-button-link';

/**
 * "New version" of a discount program on its own page (long form, contract FR9): the same sections as the
 * create page, prefilled from what is in force. The old version is never edited. Needs MANAGE_DISCOUNTS and
 * a program that has not ended; after saving the program page opens with a toast.
 */
export function DiscountVersionScreen({ id }: { id: string }) {
  const { api, t } = useWorkforce();
  const [program, setProgram] = useState<DiscountDetailResponse | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    api
      .get<DiscountDetailResponse>(`/api/v1/discounts/${id}`)
      .then((data) => active && setProgram(data))
      .catch((error: unknown) => active && setLoadError(error));
    return () => {
      active = false;
    };
  }, [api, id, attempt]);

  if (loadError && !program) {
    return (
      <ErrorState
        error={loadError}
        t={t}
        onRetry={() => {
          setLoadError(null);
          setAttempt((count) => count + 1);
        }}
      />
    );
  }
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
  // After the first submit every field shows its own problem, and the errors follow the typing (validate on submit).
  const [checked, setChecked] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const errors = checked
    ? discountFieldErrors(discountFieldProblems(form, 'version'), d.problems)
    : {};
  const dirty = JSON.stringify(form) !== JSON.stringify(formFromProgram(program));
  useUnsavedChangesGuard(dirty && !pending);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setChecked(true);
    if (Object.keys(discountFieldProblems(form, 'version')).length > 0) {
      setMessage(null);
      // The errors render on the next frame; then the first invalid field takes focus.
      requestAnimationFrame(() => {
        if (formRef.current) focusFirstInvalid(formRef.current);
      });
      return;
    }
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
        breadcrumbs={
          <Breadcrumbs
            label={text.breadcrumbs}
            LinkComponent={ListCrumbLink}
            items={[
              { label: d.title, href: `${base}/discounts` },
              { label: title, href: back },
              { label: d.newVersion },
            ]}
          />
        }
      />
      {!allowed ? (
        <Empty
          title={d.versionLockedTitle}
          action={
            <ButtonLink LinkComponent={AdminButtonLink} href={back} variant="secondary">
              {d.backToProgram}
            </ButtonLink>
          }
        >
          {d.errors.DISCOUNT_STATE_INVALID}
        </Empty>
      ) : (
        <form
          ref={formRef}
          noValidate
          onSubmit={(event) => void submit(event)}
          aria-label={d.newVersion}
        >
          <Stack gap="block">
            <Card as="section" aria-label={d.newVersion}>
              <Stack gap="page">
                <Notice tone="info">{d.newVersionHint}</Notice>
                <DiscountFormFields
                  form={form}
                  setForm={setForm}
                  mode="version"
                  columns={2}
                  errors={errors}
                />
                {message ? <Notice tone="error">{message}</Notice> : null}
              </Stack>
            </Card>
            <FormActions
              // Cancel goes back to the program: a real link in the secondary (outline) style; the primary names the action.
              cancel={
                <ButtonLink LinkComponent={AdminButtonLink} href={back} variant="secondary">
                  {t.common.cancel}
                </ButtonLink>
              }
              primary={
                <Button type="submit" variant="primary" loading={pending}>
                  {pending ? d.saving : d.createVersion}
                </Button>
              }
            />
          </Stack>
        </form>
      )}
    </Page>
  );
}
