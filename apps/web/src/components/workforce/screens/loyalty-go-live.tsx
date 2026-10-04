'use client';

import type { LoyaltyGoLiveStatusResponse } from '@lucy-spa/contracts';
import { Card, CardHeader, ConfirmDialog, DescriptionList, Stack } from '@lucy-spa/ui';
import { useState } from 'react';
import { loyaltyDictionary } from '../../../i18n/loyalty';
import { confirmError } from '../../../lib/workforce/form-labels';
import { formatDateTime } from '../../../lib/workforce/format';
import { loyaltyErrorMessage } from '../../../lib/workforce/loyalty';
import { withReauthentication } from '../../../lib/workforce/reauth';
import { useReauthentication } from '../reauth-dialog';
import { useWorkforce } from '../session';
import { Badge, Button, ErrorState, Loading, Notice, useResource, useSuccessToast } from '../ui';

/**
 * The Owner's go-live switch (Phase 5 P5-T2, Owner decision 2026-10-04): off until the Owner turns it on, once and
 * for good. `ACTIVATE_LOYALTY` is held only by the Owner, and switching on needs the Owner's password again
 * (fresh re-authentication). Nothing is back-filled; there is no switch-off.
 */
export function LoyaltyGoLive() {
  const { api, t, locale } = useWorkforce();
  const l = loyaltyDictionary(locale);
  const g = l.goLive;
  const notify = useSuccessToast();
  const { confirm, dialog } = useReauthentication();
  const status = useResource(
    () => api.get<LoyaltyGoLiveStatusResponse>('/api/v1/loyalty/go-live'),
    [api],
  );
  const [asking, setAsking] = useState(false);

  if (status.error && !status.data) {
    return <ErrorState error={status.error} t={t} onRetry={() => void status.reload()} />;
  }
  if (!status.data) return <Loading t={t} />;
  const { active, goLiveAt, activatedByName } = status.data;

  async function activate() {
    await withReauthentication(
      () => api.post<LoyaltyGoLiveStatusResponse>('/api/v1/loyalty/go-live', {}),
      confirm,
    );
    setAsking(false);
    notify(g.done);
    await status.reload();
  }

  return (
    <Card as="section" aria-label={g.title}>
      <CardHeader
        title={g.title}
        actions={
          active ? (
            <Badge tone="success">{g.on}</Badge>
          ) : (
            <Button variant="primary" onClick={() => setAsking(true)}>
              {g.enable}
            </Button>
          )
        }
      />
      <Stack gap="block">
        <Notice tone={active ? 'success' : 'info'}>{active ? g.onBody : g.offBody}</Notice>
        {active && goLiveAt ? (
          <DescriptionList
            items={[
              { label: g.since, value: formatDateTime(goLiveAt, 'Asia/Ho_Chi_Minh', locale) },
              { label: g.by, value: activatedByName ?? '—' },
            ]}
          />
        ) : null}
      </Stack>
      {asking ? (
        <ConfirmDialog
          title={g.confirmTitle}
          description={g.confirmBody}
          tone="warning"
          confirmLabel={g.confirm}
          busyLabel={g.confirming}
          cancelLabel={t.common.cancel}
          referenceLabel={t.errors.reference}
          describeError={(error) => ({
            ...confirmError(t)(error),
            message: loyaltyErrorMessage(error, t, locale),
          })}
          onConfirm={activate}
          onCancel={() => setAsking(false)}
        />
      ) : null}
      {/* Last, so the password confirmation sits above the confirmation dialog that asked for it. */}
      {dialog}
    </Card>
  );
}
