'use client';

import type { WebsiteShopInfoResponse } from '@lucy-spa/contracts';
import {
  Card,
  Cluster,
  DescriptionList,
  Field,
  focusFirstInvalid,
  FormActions,
  FormGrid,
  FormSection,
  MediaPreview,
  Select,
  Spinner,
  Stack,
  Textarea,
  TextInput,
  useUnsavedChangesGuard,
} from '@lucy-spa/ui';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { getSiteText } from '../../../i18n/site';
import { ApiError } from '../../../lib/api/client';
import { hoursLines } from '../../../lib/hours';
import { mediaVariantUrl } from '../../../lib/workforce/media';
import { canGlobal } from '../../../lib/workforce/permissions';
import {
  formOfShopInfo,
  shopInfoChanged,
  shopInfoInputOf,
  shopInfoRequest,
  shopInfoServerProblem,
  type ShopInfoForm,
  type ShopInfoProblem,
} from '../../../lib/workforce/shop-info';
import { errorMessage } from '../../../lib/workforce/workflows';
import { useAccount, useWorkforce } from '../session';
import { Button, Empty, ErrorState, Notice, useResource, useSuccessToast } from '../ui';
import { MediaPicker } from './media-picker';

/**
 * The "Shop info" tab of the website content page (Part 2 contract 6.3): the tagline, contact, home page image and the
 * branch the opening hours come from, with a preview of what visitors read. One record, saved with the row version;
 * the server decides every rule again and names the field it refused.
 */
export function ShopInfoPanel() {
  const { t } = useWorkforce();
  const { account } = useAccount();
  if (!canGlobal(account, 'MANAGE_WEBSITE_CONTENT')) return <Empty>{t.shopInfo.noAccess}</Empty>;
  return <ShopInfoForm_ />;
}

function ShopInfoForm_() {
  const { api, t, locale, base, navigate } = useWorkforce();
  const notify = useSuccessToast();
  const text = t.shopInfo;
  const loaded = useResource(
    () => api.get<WebsiteShopInfoResponse>('/api/v1/website/shop-info'),
    [api],
  );
  const [info, setInfo] = useState<WebsiteShopInfoResponse | null>(null);
  const [initial, setInitial] = useState<ShopInfoForm | null>(null);
  const [form, setForm] = useState<ShopInfoForm | null>(null);
  const [problem, setProblem] = useState<ShopInfoProblem | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [picking, setPicking] = useState(false);
  const formRef = useRef<HTMLFormElement | null>(null);

  useEffect(() => {
    if (loaded.data) {
      const next = formOfShopInfo(loaded.data);
      setInfo(loaded.data);
      setInitial(next);
      setForm(next);
    }
  }, [loaded.data]);
  useEffect(() => {
    if (problem && formRef.current) focusFirstInvalid(formRef.current);
  }, [problem]);

  const dirty = form !== null && initial !== null && shopInfoChanged(form, initial);
  useUnsavedChangesGuard(dirty && !pending);

  if (loaded.error && !info) {
    return <ErrorState error={loaded.error} t={t} onRetry={() => void loaded.reload()} />;
  }
  if (!form || !info) return <Spinner label={t.common.loading} />;

  const change = (patch: Partial<ShopInfoForm>) => {
    setForm({ ...form, ...patch });
    setProblem(null);
    setMessage(null);
  };
  const error = (field: ShopInfoProblem) => (problem === field ? text.problems[field] : undefined);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending || !form || !info) return;
    const request = shopInfoInputOf(form);
    if ('problem' in request) {
      setProblem(request.problem);
      return;
    }
    setPending(true);
    setProblem(null);
    setMessage(null);
    try {
      const saved = await api.post<WebsiteShopInfoResponse>(
        '/api/v1/website/shop-info',
        shopInfoRequest(request.body, info.rowVersion),
      );
      const next = formOfShopInfo(saved);
      setInfo(saved);
      setInitial(next);
      setForm(next);
      notify(text.saved);
    } catch (failure) {
      const field = shopInfoServerProblem(failure);
      if (field) setProblem(field);
      else {
        setMessage(errorMessage(failure, t));
        if (failure instanceof ApiError && failure.code === 'CONFLICT') await loaded.reload();
      }
    } finally {
      setPending(false);
    }
  }

  const branchOptions = info.branches.map((branch) => ({
    value: branch.id,
    label: `${branch.name} (${branch.code})`,
  }));
  // The preview shows the hours of the saved record: they come from the branch, not from this form's unsaved choice.
  const lines = hoursLines(info.hours, locale, text.hoursClosed);
  const tagline = locale === 'vi' ? form.taglineVi : form.taglineEn;
  // What the home page shows under the headline: the typed sentence, else the website's own.
  const intro =
    (locale === 'vi' ? form.introVi : form.introEn).trim() || getSiteText(locale).home.lead;

  return (
    <>
      <form
        ref={formRef}
        noValidate
        onSubmit={(event) => void submit(event)}
        aria-label={t.website.shop}
      >
        <Stack gap="block">
          <Card as="section" aria-label={t.website.shop}>
            <Stack gap="page">
              <FormSection title={text.textsSection} description={text.textsHint}>
                <FormGrid cols={2}>
                  <Field
                    label={text.taglineVi}
                    required
                    requiredLabel={t.common.required}
                    error={error('taglineVi')}
                  >
                    {(control) => (
                      <TextInput
                        {...control}
                        value={form.taglineVi}
                        onChange={(event) => change({ taglineVi: event.target.value })}
                      />
                    )}
                  </Field>
                  <Field
                    label={text.taglineEn}
                    required
                    requiredLabel={t.common.required}
                    error={error('taglineEn')}
                  >
                    {(control) => (
                      <TextInput
                        {...control}
                        value={form.taglineEn}
                        onChange={(event) => change({ taglineEn: event.target.value })}
                      />
                    )}
                  </Field>
                </FormGrid>
              </FormSection>
              <FormSection title={text.introSection} description={text.introHint}>
                <FormGrid cols={2}>
                  <Field label={text.introVi} hint={text.introFieldHint} error={error('introVi')}>
                    {(control) => (
                      <Textarea
                        {...control}
                        rows={3}
                        value={form.introVi}
                        onChange={(event) => change({ introVi: event.target.value })}
                      />
                    )}
                  </Field>
                  <Field label={text.introEn} hint={text.introFieldHint} error={error('introEn')}>
                    {(control) => (
                      <Textarea
                        {...control}
                        rows={3}
                        value={form.introEn}
                        onChange={(event) => change({ introEn: event.target.value })}
                      />
                    )}
                  </Field>
                </FormGrid>
              </FormSection>
              <FormSection title={text.contactSection} description={text.contactHint}>
                <FormGrid cols={2}>
                  <Field
                    label={text.address}
                    required
                    requiredLabel={t.common.required}
                    error={error('address')}
                    full
                  >
                    {(control) => (
                      <TextInput
                        {...control}
                        autoComplete="off"
                        value={form.address}
                        onChange={(event) => change({ address: event.target.value })}
                      />
                    )}
                  </Field>
                  <Field
                    label={text.hotline}
                    hint={text.hotlineHint}
                    required
                    requiredLabel={t.common.required}
                    error={error('hotline')}
                  >
                    {(control) => (
                      <TextInput
                        {...control}
                        type="tel"
                        inputMode="tel"
                        autoComplete="off"
                        value={form.hotline}
                        onChange={(event) => change({ hotline: event.target.value })}
                      />
                    )}
                  </Field>
                  <Field label={text.mapUrl} hint={text.mapUrlHint} error={error('mapUrl')} full>
                    {(control) => (
                      <TextInput
                        {...control}
                        inputMode="url"
                        autoComplete="off"
                        value={form.mapUrl}
                        onChange={(event) => change({ mapUrl: event.target.value })}
                      />
                    )}
                  </Field>
                </FormGrid>
              </FormSection>
              <FormSection title={text.imageSection} description={text.imageHint}>
                {form.heroMediaId !== '' ? (
                  <MediaPreview
                    src={mediaVariantUrl(form.heroMediaId, 'md')}
                    alt={text.imagePreview}
                  />
                ) : (
                  <p className="ls-hint">{text.imageNone}</p>
                )}
                {error('heroMediaId') ? <Notice tone="error">{error('heroMediaId')}</Notice> : null}
                <Cluster>
                  <Button variant="secondary" onClick={() => setPicking(true)}>
                    {form.heroMediaId !== '' ? text.imageChange : text.imageChoose}
                  </Button>
                  {form.heroMediaId !== '' ? (
                    <Button variant="ghost" onClick={() => change({ heroMediaId: '' })}>
                      {text.imageRemove}
                    </Button>
                  ) : null}
                </Cluster>
              </FormSection>
              <FormSection title={text.hoursSection} description={text.hoursHint}>
                <FormGrid cols={2}>
                  <Field label={text.hoursBranch} error={error('hoursBranchId')}>
                    {(control) => (
                      <Select
                        {...control}
                        options={branchOptions}
                        placeholder={text.hoursBranchAuto}
                        value={form.hoursBranchId}
                        onChange={(event) => change({ hoursBranchId: event.target.value })}
                      />
                    )}
                  </Field>
                </FormGrid>
                {info.hoursBranch ? (
                  <Cluster>
                    <Button
                      variant="secondary"
                      onClick={() => navigate?.(`${base}/branches/${info.hoursBranch?.id ?? ''}`)}
                    >
                      {text.hoursEdit}
                    </Button>
                  </Cluster>
                ) : (
                  <p className="ls-hint">{text.hoursNone}</p>
                )}
              </FormSection>
              {message ? <Notice tone="error">{message}</Notice> : null}
            </Stack>
          </Card>
          <FormSection title={text.previewSection} description={text.previewHint}>
            <Card as="section">
              <DescriptionList
                items={[
                  { label: text.previewTagline, value: tagline },
                  { label: text.previewIntro, value: intro },
                  { label: text.previewAddress, value: form.address },
                  { label: text.previewHotline, value: form.hotline },
                  {
                    label: text.previewHours,
                    value:
                      lines.length === 0 ? (
                        text.hoursNone
                      ) : (
                        <ul className="ls-list-plain">
                          {lines.map((line) => (
                            <li key={line.label}>{`${line.label}: ${line.value}`}</li>
                          ))}
                        </ul>
                      ),
                  },
                ]}
              />
            </Card>
          </FormSection>
          <FormActions
            cancel={
              <Button
                variant="secondary"
                onClick={() => {
                  setForm(initial);
                  setProblem(null);
                  setMessage(null);
                }}
                disabled={pending || !dirty}
              >
                {text.revert}
              </Button>
            }
            primary={
              <Button type="submit" variant="primary" loading={pending}>
                {pending ? text.saving : text.save}
              </Button>
            }
          />
        </Stack>
      </form>
      {picking ? (
        <MediaPicker
          onPick={(asset) => {
            change({ heroMediaId: asset.id });
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
      ) : null}
    </>
  );
}
