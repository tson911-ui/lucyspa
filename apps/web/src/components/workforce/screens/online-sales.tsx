'use client';

import type { OnlineSalesSettingsResponse } from '@lucy-spa/contracts';
import {
  Card,
  CardHeader,
  Cluster,
  ConfirmDialog,
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
import { onlineSalesDictionary } from '../../../i18n/online-sales';
import { ApiError } from '../../../lib/api/client';
import { fill } from '../../../lib/fill';
import { confirmError } from '../../../lib/workforce/form-labels';
import {
  NUMBER_RULES,
  POLICY_MAX,
  cannotEnable,
  defaultPolicy,
  draftFromSettings,
  editRequest,
  isDirty,
  onlineSalesErrorMessage,
  serverProblem,
  switchRequest,
  validateForSave,
  type OnlineSalesDraft,
  type OnlineSalesField,
} from '../../../lib/workforce/online-sales';
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

/**
 * "Bán online": the master switch of online ordering and its settings (Phase 6 P6-19). `MANAGE_PRODUCTS`, global. The switch is OFF
 * until the Owner turns it on, and turning it on or off asks first. The form saves with the row version it was read at; a conflict
 * reloads the settings. Delivery is free for every order: the fee block says so and stays off unless it is needed.
 */
export function OnlineSalesScreen() {
  const { locale } = useWorkforce();
  const { account } = useAccount();
  const text = onlineSalesDictionary(locale);
  if (!canGlobal(account, 'MANAGE_PRODUCTS')) {
    return (
      <>
        <PageHeader title={text.title} intro={text.intro} />
        <Empty>{text.noAccess}</Empty>
      </>
    );
  }
  return <OnlineSalesPage />;
}

function OnlineSalesPage() {
  const { api, t, locale } = useWorkforce();
  const text = onlineSalesDictionary(locale);
  const loaded = useResource(
    () => api.get<OnlineSalesSettingsResponse>('/api/v1/online-sales-settings'),
    [api],
  );
  const [settings, setSettings] = useState<OnlineSalesSettingsResponse | null>(null);
  useEffect(() => {
    if (loaded.data) setSettings(loaded.data);
  }, [loaded.data]);

  if (loaded.error && !settings) {
    return (
      <>
        <PageHeader title={text.title} intro={text.intro} />
        <ErrorState error={loaded.error} t={t} onRetry={() => void loaded.reload()} />
      </>
    );
  }
  if (!settings) {
    return (
      <>
        <PageHeader title={text.title} intro={text.intro} />
        <Spinner label={t.common.loading} />
      </>
    );
  }
  return (
    <SettingsPanel
      // A new row version is a new form: a saved or reloaded record starts clean.
      key={settings.rowVersion}
      settings={settings}
      onSaved={setSettings}
      reload={async () => {
        await loaded.reload();
      }}
    />
  );
}

function SettingsPanel({
  settings,
  onSaved,
  reload,
}: {
  settings: OnlineSalesSettingsResponse;
  onSaved: (settings: OnlineSalesSettingsResponse) => void;
  reload: () => Promise<void>;
}) {
  const { api, t, locale } = useWorkforce();
  const text = onlineSalesDictionary(locale);
  const notify = useSuccessToast();
  const formRef = useRef<HTMLFormElement | null>(null);
  const [draft, setDraft] = useState<OnlineSalesDraft>(() => draftFromSettings(settings));
  const [problems, setProblems] = useState<Partial<Record<OnlineSalesField, true>>>({});
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

  const dirty = isDirty(draft, settings);
  useUnsavedChangesGuard(dirty && !pending);
  useEffect(() => {
    if (Object.keys(problems).length > 0 && formRef.current) focusFirstInvalid(formRef.current);
  }, [problems]);

  const change = (patch: Partial<OnlineSalesDraft>) => {
    setDraft((old) => ({ ...old, ...patch }));
    setProblems((old) => {
      const left = { ...old };
      for (const key of Object.keys(patch) as OnlineSalesField[]) delete left[key];
      return left;
    });
    setMessage(null);
  };
  const error = (field: OnlineSalesField) => (problems[field] ? text.problems[field] : undefined);
  const general = (failure: unknown) => errorMessage(failure, t);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    const found = validateForSave(draft, settings);
    if (Object.keys(found).length > 0) {
      setProblems(found);
      return;
    }
    setPending(true);
    setMessage(null);
    try {
      const saved = await api.post<OnlineSalesSettingsResponse>(
        '/api/v1/online-sales-settings/edit',
        editRequest(draft, settings),
      );
      onSaved(saved);
      notify(text.saved);
    } catch (failure) {
      const field = serverProblem(failure);
      if (field) setProblems({ [field]: true });
      else {
        setMessage(onlineSalesErrorMessage(failure, text, general));
        if (failure instanceof ApiError && failure.code === 'CONFLICT') await reload();
      }
    } finally {
      setPending(false);
    }
  }

  async function turn(enabled: boolean) {
    try {
      const saved = await api.post<OnlineSalesSettingsResponse>(
        '/api/v1/online-sales-settings/edit',
        switchRequest(settings, enabled),
      );
      setAsking(false);
      onSaved(saved);
      notify(enabled ? text.master.done : text.master.doneOff);
    } catch (failure) {
      if (failure instanceof ApiError && failure.code === 'CONFLICT') {
        setAsking(false);
        await reload();
      }
      throw failure;
    }
  }

  const blocked = settings.enabled ? null : cannotEnable(settings, dirty);
  const branchName =
    settings.branches.find((branch) => branch.id === settings.fulfilmentBranchId)?.name ??
    settings.fulfilmentBranchName ??
    '';
  const number = (field: keyof typeof NUMBER_RULES, label: string, hint?: string) => (
    <Field label={label} {...(hint ? { hint } : {})} error={error(field)}>
      {(control) => (
        <NumberInput
          {...control}
          min={NUMBER_RULES[field].min}
          max={NUMBER_RULES[field].max}
          step={1}
          value={draft[field]}
          disabled={pending}
          onChange={(event) => change({ [field]: event.target.value })}
        />
      )}
    </Field>
  );

  return (
    <>
      <PageHeader title={text.title} intro={text.intro} />
      <Stack gap="block">
        <Card as="section" aria-label={text.master.title}>
          <CardHeader
            title={text.master.title}
            actions={
              <Cluster>
                <Badge tone={settings.enabled ? 'success' : 'neutral'}>
                  {settings.enabled ? text.master.on : text.master.off}
                </Badge>
                <Button
                  variant={settings.enabled ? 'secondary' : 'primary'}
                  disabled={blocked !== null || (settings.enabled && dirty)}
                  onClick={() => setAsking(true)}
                >
                  {settings.enabled ? text.master.turnOff : text.master.turnOn}
                </Button>
              </Cluster>
            }
          />
          <Stack gap="block">
            <Notice tone={settings.enabled ? 'success' : 'info'}>
              {settings.enabled ? text.master.onBody : text.master.offBody}
            </Notice>
            {blocked === 'PAYMENT' ? (
              <Notice tone="warning">{text.master.paymentMissing}</Notice>
            ) : null}
            {blocked === 'BRANCH' ? (
              <Notice tone="warning">{text.master.needsBranch}</Notice>
            ) : null}
            {blocked === 'DIRTY' ? <Notice tone="warning">{text.master.dirty}</Notice> : null}
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
                <FormSection title={text.fulfilment.title} description={text.fulfilment.hint}>
                  <FormGrid cols={2}>
                    <Field
                      label={text.fulfilment.branch}
                      required
                      requiredLabel={t.common.required}
                      error={error('fulfilmentBranchId')}
                    >
                      {(control) => (
                        <Select
                          {...control}
                          options={settings.branches.map((branch) => ({
                            value: branch.id,
                            label: branch.name,
                          }))}
                          placeholder={text.fulfilment.branchPlaceholder}
                          value={draft.fulfilmentBranchId}
                          disabled={pending}
                          onChange={(event) => change({ fulfilmentBranchId: event.target.value })}
                        />
                      )}
                    </Field>
                  </FormGrid>
                </FormSection>
                <FormSection title={text.payment.title} description={text.payment.hint}>
                  <FormGrid cols={2}>
                    {number('unpaidTimeoutMinutes', text.payment.timeout, text.payment.timeoutHint)}
                    {number('maxUnpaidOrders', text.payment.maxUnpaid, text.payment.maxUnpaidHint)}
                  </FormGrid>
                </FormSection>
                <FormSection title={text.cart.title} description={text.cart.hint}>
                  <FormGrid cols={2}>
                    {number('maxCartLines', text.cart.maxLines, text.cart.maxLinesHint)}
                    {number('maxLineQuantity', text.cart.maxQuantity, text.cart.maxQuantityHint)}
                  </FormGrid>
                </FormSection>
                <FormSection title={text.promise.title} description={text.promise.hint}>
                  <FormGrid cols={2}>
                    {number(
                      'shipWithinWorkingDays',
                      text.promise.shipWithin,
                      text.promise.shipWithinHint,
                    )}
                  </FormGrid>
                  <FormGrid cols={2}>
                    {number('transitDaysMin', text.promise.transitMin)}
                    {number('transitDaysMax', text.promise.transitMax, text.promise.transitHint)}
                  </FormGrid>
                  <p className="ls-hint">
                    {fill(text.promise.preview, {
                      days: draft.shipWithinWorkingDays,
                      min: draft.transitDaysMin,
                      max: draft.transitDaysMax,
                    })}
                  </p>
                </FormSection>
                <FormSection title={text.fee.title} description={text.fee.hint}>
                  <Switch
                    checked={draft.shippingFeeEnabled}
                    onCheckedChange={(checked) => change({ shippingFeeEnabled: checked })}
                    label={text.fee.switch}
                    disabled={pending}
                  />
                  <p className="ls-hint">
                    {draft.shippingFeeEnabled ? text.fee.onHelp : text.fee.offHelp}
                  </p>
                  {draft.shippingFeeEnabled ? (
                    <FormGrid cols={2}>
                      <Field
                        label={text.fee.amount}
                        hint={text.fee.amountHint}
                        required
                        requiredLabel={t.common.required}
                        error={error('shippingFeeVnd')}
                      >
                        {(control) => (
                          <MoneyInput
                            {...control}
                            unit={text.fee.unit}
                            separator={locale === 'vi' ? '.' : ','}
                            value={draft.shippingFeeVnd}
                            disabled={pending}
                            onValueChange={(value) => change({ shippingFeeVnd: value })}
                          />
                        )}
                      </Field>
                      <Field
                        label={text.fee.threshold}
                        hint={text.fee.thresholdHint}
                        error={error('freeShippingThresholdVnd')}
                      >
                        {(control) => (
                          <MoneyInput
                            {...control}
                            unit={text.fee.unit}
                            separator={locale === 'vi' ? '.' : ','}
                            value={draft.freeShippingThresholdVnd}
                            disabled={pending}
                            onValueChange={(value) => change({ freeShippingThresholdVnd: value })}
                          />
                        )}
                      </Field>
                    </FormGrid>
                  ) : null}
                </FormSection>
                <FormSection
                  title={text.policy.title}
                  description={`${text.policy.hint} ${fill(text.policy.version, { version: settings.policyVersion })}`}
                >
                  <FormGrid cols={2}>
                    <Field
                      label={text.policy.vi}
                      hint={`${text.policy.emptyHint} ${fill(text.policy.count, { count: [...draft.policyVi].length, max: POLICY_MAX })}`}
                      error={error('policyVi')}
                      full
                    >
                      {(control) => (
                        <Textarea
                          {...control}
                          rows={8}
                          value={draft.policyVi}
                          disabled={pending}
                          onChange={(event) => change({ policyVi: event.target.value })}
                        />
                      )}
                    </Field>
                    <Field
                      label={text.policy.en}
                      hint={`${text.policy.emptyHint} ${fill(text.policy.count, { count: [...draft.policyEn].length, max: POLICY_MAX })}`}
                      error={error('policyEn')}
                      full
                    >
                      {(control) => (
                        <Textarea
                          {...control}
                          rows={8}
                          value={draft.policyEn}
                          disabled={pending}
                          onChange={(event) => change({ policyEn: event.target.value })}
                        />
                      )}
                    </Field>
                  </FormGrid>
                  <PolicyDefaults draft={draft} settings={settings} />
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
      {asking ? (
        <ConfirmDialog
          title={settings.enabled ? text.master.confirmOffTitle : text.master.confirmOnTitle}
          description={
            settings.enabled
              ? text.master.confirmOffBody
              : fill(text.master.confirmOnBody, { branch: branchName })
          }
          tone={settings.enabled ? 'danger' : 'warning'}
          confirmLabel={settings.enabled ? text.master.turnOff : text.master.turnOn}
          busyLabel={text.master.busy}
          cancelLabel={t.common.cancel}
          referenceLabel={t.errors.reference}
          describeError={(failure) => ({
            ...confirmError(t)(failure),
            message: onlineSalesErrorMessage(failure, text, general),
          })}
          onConfirm={() => turn(!settings.enabled)}
          onCancel={() => setAsking(false)}
        />
      ) : null}
    </>
  );
}

/** The two default drafts, as customers read them while a policy box is empty. */
function PolicyDefaults({
  draft,
  settings,
}: {
  draft: OnlineSalesDraft;
  settings: OnlineSalesSettingsResponse;
}) {
  const { locale } = useWorkforce();
  const text = onlineSalesDictionary(locale);
  return (
    <Stack gap="block">
      <p className="ls-hint">{text.policy.defaultNote}</p>
      <FormGrid cols={2}>
        {(['vi', 'en'] as const).map((language) => (
          <div key={language} className="ls-policy-default">
            <p className="ls-policy-default-title">
              {language === 'vi' ? text.policy.defaultVi : text.policy.defaultEn}
            </p>
            <div className="ls-policy-default-text">
              {defaultPolicy(language, draft, settings)
                .split('\n')
                .map((line, index) => (
                  <p key={index}>{line}</p>
                ))}
            </div>
          </div>
        ))}
      </FormGrid>
    </Stack>
  );
}
