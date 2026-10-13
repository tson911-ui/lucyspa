'use client';

import {
  AI_CAPPED_FEATURES,
  AI_EFFORT_LEVELS,
  AI_MODEL_IDS,
  type AiSettingsResponse,
} from '@lucy-spa/contracts';
import {
  Card,
  CardHeader,
  Cluster,
  DescriptionList,
  Field,
  FormActions,
  FormGrid,
  FormSection,
  MoneyInput,
  NumberInput,
  Select,
  Spinner,
  Stack,
  Switch,
  Textarea,
  focusFirstInvalid,
  useUnsavedChangesGuard,
} from '@lucy-spa/ui';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { aiSettingsDictionary } from '../../../i18n/ai-settings';
import { fill } from '../../../i18n/workforce';
import { ApiError } from '../../../lib/api/client';
import {
  draftFromSettings,
  editRequest,
  isDirty,
  serverField,
  validateDraft,
  vndText,
  type AiSettingsDraft,
  type AiSettingsField,
} from '../../../lib/workforce/ai-settings';
import { formatDateTime } from '../../../lib/workforce/format';
import { canGlobal } from '../../../lib/workforce/permissions';
import { errorMessage } from '../../../lib/workforce/workflows';
import { useAccount, useWorkforce } from '../session';
import {
  Badge,
  Button,
  Empty,
  ErrorState,
  Notice,
  PageHeader,
  useResource,
  useSuccessToast,
} from '../ui';

const BASE = '/api/v1/ai/settings';
const POLL_MS = 3000;

/**
 * "Cài đặt AI" (Claude integration Wave A): the switches, the key status (never the key), this month's cost against the caps, the model and
 * the wording rules. `MANAGE_AI_SETTINGS`, global. Saves with the row version it was read at; a conflict reloads. While a key check is
 * pending the screen asks again every few seconds until the worker has answered.
 */
export function AiSettingsScreen() {
  const { locale } = useWorkforce();
  const { account } = useAccount();
  const text = aiSettingsDictionary(locale);
  if (!canGlobal(account, 'MANAGE_AI_SETTINGS')) {
    return (
      <>
        <PageHeader title={text.title} intro={text.intro} />
        <Empty>{text.noAccess}</Empty>
      </>
    );
  }
  return <AiSettingsPage />;
}

function AiSettingsPage() {
  const { api, t, locale } = useWorkforce();
  const text = aiSettingsDictionary(locale);
  const loaded = useResource(() => api.get<AiSettingsResponse>(BASE), [api]);
  const [data, setData] = useState<AiSettingsResponse | null>(null);
  useEffect(() => {
    if (loaded.data) setData(loaded.data);
  }, [loaded.data]);
  const pending = data?.key.checkPending === true;
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => void loaded.reload(), POLL_MS);
    return () => clearInterval(timer);
  }, [pending, loaded]);
  if (loaded.error && !data) {
    return (
      <>
        <PageHeader title={text.title} intro={text.intro} />
        <ErrorState error={loaded.error} t={t} onRetry={() => void loaded.reload()} />
      </>
    );
  }
  if (!data) {
    return (
      <>
        <PageHeader title={text.title} intro={text.intro} />
        <Spinner label={t.common.loading} />
      </>
    );
  }
  return (
    <AiSettingsPanel
      // A new row version is a new form: a saved or reloaded record starts clean.
      key={data.settings.rowVersion}
      data={data}
      onChange={setData}
      reload={async () => {
        await loaded.reload();
      }}
    />
  );
}

function AiSettingsPanel({
  data,
  onChange,
  reload,
}: {
  data: AiSettingsResponse;
  onChange: (data: AiSettingsResponse) => void;
  reload: () => Promise<void>;
}) {
  const { api, t, locale } = useWorkforce();
  const text = aiSettingsDictionary(locale);
  const notify = useSuccessToast();
  const { settings, key, usage, integrations } = data;
  const formRef = useRef<HTMLFormElement | null>(null);
  const [draft, setDraft] = useState<AiSettingsDraft>(() => draftFromSettings(settings));
  const [problems, setProblems] = useState<Partial<Record<AiSettingsField, true>>>({});
  const [pending, setPending] = useState(false);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const dirty = isDirty(draft, settings);
  useUnsavedChangesGuard(dirty && !pending);
  useEffect(() => {
    if (Object.keys(problems).length > 0 && formRef.current) focusFirstInvalid(formRef.current);
  }, [problems]);

  const change = (patch: Partial<AiSettingsDraft>) => {
    setDraft((old) => ({ ...old, ...patch }));
    setProblems({});
    setMessage(null);
  };
  const error = (field: AiSettingsField) => (problems[field] ? text.problems[field] : undefined);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    const found = validateDraft(draft);
    if (Object.keys(found).length > 0) {
      setProblems(found);
      return;
    }
    setPending(true);
    setMessage(null);
    try {
      onChange(await api.post<AiSettingsResponse>(BASE, editRequest(draft, settings)));
      notify(text.saved);
    } catch (failure) {
      const field = serverField(failure);
      if (field) setProblems({ [field]: true });
      else if (failure instanceof ApiError && failure.code === 'CONFLICT') {
        setMessage(text.conflict);
        await reload();
      } else setMessage(errorMessage(failure, t));
    } finally {
      setPending(false);
    }
  }

  async function check() {
    setChecking(true);
    setMessage(null);
    try {
      onChange(
        await api.post<AiSettingsResponse>(`${BASE}/check`, {
          expectedRowVersion: settings.rowVersion,
        }),
      );
    } catch (failure) {
      if (failure instanceof ApiError && failure.code === 'CONFLICT') {
        setMessage(text.conflict);
        await reload();
      } else setMessage(errorMessage(failure, t));
    } finally {
      setChecking(false);
    }
  }

  const when =
    key.lastCheckAt === null ? null : formatDateTime(key.lastCheckAt, 'Asia/Ho_Chi_Minh', locale);
  const money = (value: string | null) =>
    value === null ? text.usage.unknown : `${vndText(value, locale)} ${text.cost.unit}`;
  const keyTone = !key.configured
    ? 'warning'
    : key.lastCheckStatus === 'OK'
      ? 'success'
      : key.lastCheckStatus
        ? 'error'
        : 'neutral';

  return (
    <>
      <PageHeader title={text.title} intro={text.intro} />
      <Stack gap="block">
        <Card as="section" aria-label={text.key.title}>
          <CardHeader
            title={text.key.title}
            actions={
              <Cluster>
                <Badge tone={keyTone}>
                  {key.configured ? text.key.configured : text.key.missing}
                </Badge>
                <Button
                  variant="secondary"
                  onClick={() => void check()}
                  loading={checking || key.checkPending}
                  disabled={dirty || checking || key.checkPending}
                >
                  {text.key.check}
                </Button>
              </Cluster>
            }
          />
          <Stack gap="block">
            {!key.configured ? <Notice tone="warning">{text.key.missingBody}</Notice> : null}
            {key.checkPending ? (
              <p className="ls-hint">{text.key.checking}</p>
            ) : key.lastCheckStatus &&
              !(key.lastCheckStatus === 'KEY_MISSING' && !key.configured) ? (
              <Notice tone={key.lastCheckStatus === 'OK' ? 'success' : 'error'}>
                {text.key.statuses[key.lastCheckStatus]}
                {when ? ` · ${fill(text.key.lastCheck, { when })}` : ''}
              </Notice>
            ) : (
              <p className="ls-hint">
                {when ? fill(text.key.lastCheck, { when }) : text.key.never}
              </p>
            )}
          </Stack>
        </Card>
        <Card as="section" aria-label={text.usage.title}>
          <CardHeader title={text.usage.title} />
          <Stack gap="block">
            {settings.vndPerUsd === null ? (
              <Notice tone="info">{text.usage.needRate}</Notice>
            ) : null}
            <DescriptionList
              columns={2}
              items={[
                { label: text.usage.spent, value: money(usage.spentVnd) },
                { label: text.usage.reserved, value: money(usage.reservedVnd) },
                { label: text.usage.cap, value: money(usage.capVnd) },
                ...usage.byFeature.map((line) => ({
                  label: text.usage.features[line.feature],
                  value: `${money(line.spentVnd)} / ${money(line.capVnd)}`,
                })),
              ]}
            />
            <p className="ls-hint">{text.usage.note}</p>
          </Stack>
        </Card>
        <form
          ref={formRef}
          noValidate
          onSubmit={(event) => void submit(event)}
          aria-label={text.title}
        >
          <Stack gap="block">
            <Card as="section" aria-label={text.title}>
              <Stack gap="page">
                <FormSection title={text.switches.title} description={text.switches.hint}>
                  <Stack gap="field">
                    <Switch
                      checked={draft.enabled}
                      onCheckedChange={(checked) => change({ enabled: checked })}
                      label={text.switches.enabled}
                      disabled={pending}
                    />
                    <Switch
                      checked={draft.rewriteEnabled}
                      onCheckedChange={(checked) => change({ rewriteEnabled: checked })}
                      label={text.switches.rewrite}
                      disabled={pending}
                    />
                    <Switch
                      checked={draft.seoEnabled}
                      onCheckedChange={(checked) => change({ seoEnabled: checked })}
                      label={text.switches.seo}
                      disabled={pending}
                    />
                    <Switch
                      checked={draft.chatEnabled}
                      onCheckedChange={(checked) => change({ chatEnabled: checked })}
                      label={text.switches.chat}
                      disabled={pending}
                    />
                    <Switch
                      checked={draft.assistantEnabled}
                      onCheckedChange={(checked) => change({ assistantEnabled: checked })}
                      label={text.switches.assistant}
                      disabled={pending}
                    />
                    <Switch
                      checked={draft.briefEnabled}
                      onCheckedChange={(checked) => change({ briefEnabled: checked })}
                      label={text.switches.brief}
                      disabled={pending}
                    />
                  </Stack>
                </FormSection>
                <FormSection title={text.chat.title} description={text.chat.hint}>
                  {draft.chatEnabled && !integrations.chatWebhookConfigured ? (
                    <Notice tone="warning">{text.chat.webhookMissing}</Notice>
                  ) : null}
                  <FormGrid cols={2}>
                    <Field
                      label={text.chat.dailyCap}
                      hint={text.chat.dailyCapHint}
                      error={error('chatDailyCap')}
                    >
                      {(control) => (
                        <NumberInput
                          {...control}
                          min={0}
                          max={5000}
                          step={1}
                          value={draft.chatDailyCap}
                          disabled={pending}
                          onChange={(event) => change({ chatDailyCap: event.target.value })}
                        />
                      )}
                    </Field>
                  </FormGrid>
                  <p className="ls-hint">
                    {integrations.botDataConfigured ? text.chat.botDataOn : text.chat.botDataOff}
                  </p>
                </FormSection>
                <FormSection title={text.cost.title} description={text.cost.hint}>
                  <FormGrid cols={2}>
                    <Field
                      label={text.cost.rate}
                      hint={text.cost.rateHint}
                      error={error('vndPerUsd')}
                    >
                      {(control) => (
                        <NumberInput
                          {...control}
                          min={1000}
                          max={1000000}
                          step={1}
                          value={draft.vndPerUsd}
                          disabled={pending}
                          onChange={(event) => change({ vndPerUsd: event.target.value })}
                        />
                      )}
                    </Field>
                    <Field label={text.cost.monthly} error={error('monthlyCapVnd')}>
                      {(control) => (
                        <MoneyInput
                          {...control}
                          unit={text.cost.unit}
                          separator={locale === 'vi' ? '.' : ','}
                          value={draft.monthlyCapVnd === '' ? null : Number(draft.monthlyCapVnd)}
                          disabled={pending}
                          onValueChange={(value) =>
                            change({ monthlyCapVnd: value === null ? '' : String(value) })
                          }
                        />
                      )}
                    </Field>
                  </FormGrid>
                  <p className="ls-hint">{text.cost.features}</p>
                  <FormGrid cols={2}>
                    {AI_CAPPED_FEATURES.map((feature) => (
                      <Field
                        key={feature}
                        label={text.usage.features[feature]}
                        error={
                          feature === AI_CAPPED_FEATURES[0] ? error('featureCapsVnd') : undefined
                        }
                      >
                        {(control) => (
                          <MoneyInput
                            {...control}
                            unit={text.cost.unit}
                            separator={locale === 'vi' ? '.' : ','}
                            value={
                              draft.featureCapsVnd[feature] === ''
                                ? null
                                : Number(draft.featureCapsVnd[feature])
                            }
                            disabled={pending}
                            onValueChange={(value) =>
                              change({
                                featureCapsVnd: {
                                  ...draft.featureCapsVnd,
                                  [feature]: value === null ? '' : String(value),
                                },
                              })
                            }
                          />
                        )}
                      </Field>
                    ))}
                  </FormGrid>
                </FormSection>
                <FormSection title={text.model.title} description={text.model.hint}>
                  <FormGrid cols={2}>
                    <Field label={text.model.model}>
                      {(control) => (
                        <Select
                          {...control}
                          options={AI_MODEL_IDS.map((id) => ({
                            value: id,
                            label: text.model.models[id],
                          }))}
                          value={draft.rewriteModel}
                          disabled={pending}
                          onChange={(event) =>
                            change({
                              rewriteModel: event.target.value as AiSettingsDraft['rewriteModel'],
                            })
                          }
                        />
                      )}
                    </Field>
                    <Field label={text.model.effort}>
                      {(control) => (
                        <Select
                          {...control}
                          options={AI_EFFORT_LEVELS.map((level) => ({
                            value: level,
                            label: text.model.efforts[level],
                          }))}
                          value={draft.rewriteEffort}
                          disabled={pending}
                          onChange={(event) =>
                            change({
                              rewriteEffort: event.target.value as AiSettingsDraft['rewriteEffort'],
                            })
                          }
                        />
                      )}
                    </Field>
                    <Field
                      label={text.model.concurrency}
                      hint={text.model.concurrencyHint}
                      error={error('concurrency')}
                    >
                      {(control) => (
                        <NumberInput
                          {...control}
                          min={1}
                          max={4}
                          step={1}
                          value={draft.concurrency}
                          disabled={pending}
                          onChange={(event) => change({ concurrency: event.target.value })}
                        />
                      )}
                    </Field>
                  </FormGrid>
                  <Switch
                    checked={draft.refusalFallback}
                    onCheckedChange={(checked) => change({ refusalFallback: checked })}
                    label={text.model.fallback}
                    disabled={pending}
                  />
                  <p className="ls-hint">{text.model.fallbackHint}</p>
                </FormSection>
                <FormSection title={text.models.title} description={text.models.hint}>
                  <FormGrid cols={2}>
                    {(
                      [
                        ['seoModel', text.models.seo],
                        ['assistantModel', text.models.assistant],
                        ['briefModel', text.models.brief],
                      ] as const
                    ).map(([name, label]) => (
                      <Field key={name} label={label}>
                        {(control) => (
                          <Select
                            {...control}
                            options={AI_MODEL_IDS.map((id) => ({
                              value: id,
                              label: text.model.models[id],
                            }))}
                            value={draft[name]}
                            disabled={pending}
                            onChange={(event) =>
                              change({ [name]: event.target.value as AiSettingsDraft[typeof name] })
                            }
                          />
                        )}
                      </Field>
                    ))}
                  </FormGrid>
                </FormSection>
                <FormSection title={text.words.title} description={text.words.hint}>
                  <Switch
                    checked={draft.allowAuthenticityClaims}
                    onCheckedChange={(checked) => change({ allowAuthenticityClaims: checked })}
                    label={text.words.authenticity}
                    disabled={pending}
                  />
                  <p className="ls-hint">{text.words.authenticityHint}</p>
                  <Field
                    label={text.words.banned}
                    hint={text.words.bannedHint}
                    error={error('bannedPhrases')}
                    full
                  >
                    {(control) => (
                      <Textarea
                        {...control}
                        rows={5}
                        value={draft.bannedPhrases}
                        disabled={pending}
                        onChange={(event) => change({ bannedPhrases: event.target.value })}
                      />
                    )}
                  </Field>
                </FormSection>
                {message ? <Notice tone="error">{message}</Notice> : null}
              </Stack>
            </Card>
            <FormActions
              cancel={
                <Button
                  variant="secondary"
                  onClick={() => {
                    setDraft(draftFromSettings(settings));
                    setProblems({});
                    setMessage(null);
                  }}
                  disabled={pending || !dirty}
                >
                  {text.revert}
                </Button>
              }
              primary={
                <Button type="submit" variant="primary" loading={pending} disabled={!dirty}>
                  {pending ? text.saving : text.save}
                </Button>
              }
            />
          </Stack>
        </form>
      </Stack>
    </>
  );
}
