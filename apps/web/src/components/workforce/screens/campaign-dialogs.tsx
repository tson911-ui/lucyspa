'use client';

import type { CampaignDetailResponse } from '@lucy-spa/contracts';
import { ConfirmDialog, type ConfirmError } from '@lucy-spa/ui';
import { useRef, useState } from 'react';
import { campaignDictionary } from '../../../i18n/campaigns';
import { ApiError } from '../../../lib/workforce/api';
import {
  campaignErrorField,
  campaignErrorText,
  campaignName,
  campaignWindow,
  type CampaignFormField,
} from '../../../lib/workforce/campaigns';
import { errorMessage } from '../../../lib/workforce/workflows';
import { useWorkforce } from '../session';

/** Sends one campaign command with the page's current version and reloads the campaign; a stale version is reported to the page. */
export type SendCampaign = (path: string, body: object) => Promise<void>;

/**
 * One command of a form: it posts through `send`, blocks duplicate submits while a request runs, and keeps the failure so the
 * form can show its text and the field the API named (a taken address, a bad end time).
 */
export function useCampaignAction(send: SendCampaign) {
  const { t, locale } = useWorkforce();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const busy = useRef(false);

  async function run(path: string, body: object): Promise<boolean> {
    if (busy.current) return false;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      await send(path, body);
      return true;
    } catch (failure) {
      setError(failure);
      return false;
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return {
    pending,
    run,
    clear: () => setError(null),
    field: (error ? campaignErrorField(error) : null) as CampaignFormField | null,
    message: error ? campaignErrorText(error, locale, (cause) => errorMessage(cause, t)) : null,
  };
}

/** The text and request reference a `ConfirmDialog` shows for a refused command. */
export function useConfirmError(): (error: unknown) => ConfirmError {
  const { t, locale } = useWorkforce();
  return (error) => ({
    message: campaignErrorText(error, locale, (cause) => errorMessage(cause, t)),
    reference: error instanceof ApiError ? error.requestId : null,
  });
}

/** Publishing freezes the window, the rules and the products: the person confirms with the numbers in front of them. */
export function PublishDialog({
  campaign,
  send,
  onClose,
  onDone,
}: {
  campaign: CampaignDetailResponse;
  send: SendCampaign;
  onClose: () => void;
  onDone: () => void;
}) {
  const { locale } = useWorkforce();
  const c = campaignDictionary(locale);
  const d = c.publishDialog;
  const describeError = useConfirmError();
  const { review } = campaign;
  const facts = [
    { label: d.name, value: campaignName(campaign, locale) },
    { label: d.window, value: campaignWindow(campaign, locale) },
    { label: d.items, value: String(review.itemCount - review.noDiscountCount) },
    ...(review.noDiscountCount > 0
      ? [{ label: c.review.noDiscount, value: String(review.noDiscountCount) }]
      : []),
    ...(review.overlapCount > 0
      ? [{ label: c.review.overlap, value: String(review.overlapCount) }]
      : []),
    ...(review.ownPromotionCount > 0
      ? [{ label: c.review.own, value: String(review.ownPromotionCount) }]
      : []),
  ];
  return (
    <ConfirmDialog
      title={d.title}
      description={d.body}
      facts={facts}
      tone="neutral"
      confirmLabel={d.confirm}
      busyLabel={d.working}
      cancelLabel={c.cancel}
      describeError={describeError}
      onCancel={onClose}
      onConfirm={async () => {
        await send(`/api/v1/product-campaigns/${campaign.id}/publish`, {
          expectedVersion: campaign.rowVersion,
        });
        onDone();
      }}
    />
  );
}

/** Ending a running or scheduled campaign needs a written reason and cannot be undone. */
export function EndDialog({
  campaign,
  send,
  onClose,
  onDone,
}: {
  campaign: CampaignDetailResponse;
  send: SendCampaign;
  onClose: () => void;
  onDone: () => void;
}) {
  const { locale, t } = useWorkforce();
  const c = campaignDictionary(locale);
  const d = c.endDialog;
  const describeError = useConfirmError();
  return (
    <ConfirmDialog
      title={d.title}
      description={d.body}
      facts={[
        { label: c.publishDialog.name, value: campaignName(campaign, locale) },
        { label: c.publishDialog.window, value: campaignWindow(campaign, locale) },
      ]}
      tone="danger"
      confirmLabel={d.confirm}
      busyLabel={d.working}
      cancelLabel={c.cancel}
      referenceLabel={t.errors.reference}
      reasonField={{
        label: d.reason,
        required: true,
        requiredMessage: d.reasonRequired,
      }}
      describeError={describeError}
      onCancel={onClose}
      onConfirm={async (reason) => {
        await send(`/api/v1/product-campaigns/${campaign.id}/end`, {
          expectedVersion: campaign.rowVersion,
          reason: reason ?? '',
        });
        onDone();
      }}
    />
  );
}

/** Deleting a draft that never priced anything. */
export function DeleteDialog({
  campaign,
  onClose,
  onDeleted,
}: {
  campaign: CampaignDetailResponse;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { api, locale } = useWorkforce();
  const c = campaignDictionary(locale);
  const d = c.deleteDialog;
  const describeError = useConfirmError();
  return (
    <ConfirmDialog
      title={d.title}
      description={d.body}
      facts={[{ label: c.publishDialog.name, value: campaignName(campaign, locale) }]}
      tone="danger"
      confirmLabel={d.confirm}
      busyLabel={d.working}
      cancelLabel={c.cancel}
      describeError={describeError}
      onCancel={onClose}
      onConfirm={async () => {
        await api.post(`/api/v1/product-campaigns/${campaign.id}/delete`, {
          expectedVersion: campaign.rowVersion,
        });
        onDeleted();
      }}
    />
  );
}
