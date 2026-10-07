'use client';

import type {
  MediaAssetSummary,
  ProductDetailResponse,
  ProductImageResponse,
} from '@lucy-spa/contracts';
import {
  ConfirmDialog,
  Dialog,
  ListSection,
  MediaGrid,
  MediaPreview,
  MediaTile,
  RowActions,
  type MenuItem,
} from '@lucy-spa/ui';
import { useState } from 'react';
import { productDictionary } from '../../../i18n/products';
import { fill } from '../../../i18n/workforce';
import { ApiError } from '../../../lib/workforce/api';
import { mediaVariantUrl } from '../../../lib/workforce/media';
import { movedImageIds, productErrorText } from '../../../lib/workforce/products';
import { errorMessage } from '../../../lib/workforce/workflows';
import { useWorkforce } from '../session';
import { Button, Empty, Notice, useSuccessToast } from '../ui';
import { MediaPicker } from './media-picker';

/**
 * "Hình ảnh": the product's pictures from the media library, in display order (the first is the cover). Adding opens the shared
 * media picker (which asks for a Vietnamese description when an image has none); removing only detaches the picture from this
 * product. Needs the catalog permission; everyone else sees the pictures only.
 */
export function ImagesSection({
  product,
  reload,
}: {
  product: ProductDetailResponse;
  reload: () => Promise<void>;
}) {
  const { api, t, locale } = useWorkforce();
  const p = productDictionary(locale);
  const m = p.images;
  const notify = useSuccessToast();
  const manage = product.access.manage;
  const [picking, setPicking] = useState(false);
  const [removing, setRemoving] = useState<ProductImageResponse | null>(null);
  const [viewing, setViewing] = useState<ProductImageResponse | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const images = [...product.images].sort((a, b) => a.sortOrder - b.sortOrder);
  const ids = images.map((image) => image.id);

  async function post(path: string, body: object, success: string): Promise<boolean> {
    setNotice(null);
    try {
      await api.post(`/api/v1/products/${product.id}/${path}`, body);
      await reload();
      notify(success);
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.code === 'CONFLICT')
        await reload().catch(() => undefined);
      setNotice(productErrorText(error, locale, (cause) => errorMessage(cause, t)));
      return false;
    }
  }

  async function add(asset: MediaAssetSummary) {
    setPicking(false);
    await post('images', { mediaAssetId: asset.id }, m.added);
  }

  const title = (image: ProductImageResponse, index: number) =>
    image.altVi ?? fill(m.position, { n: index + 1 });

  return (
    <ListSection
      title={m.title}
      actions={
        manage ? (
          <Button variant="secondary" icon="plus" onClick={() => setPicking(true)}>
            {m.add}
          </Button>
        ) : undefined
      }
    >
      {notice ? <Notice tone="error">{notice}</Notice> : null}
      {images.length === 0 ? (
        <Empty>{m.empty}</Empty>
      ) : (
        <MediaGrid label={m.list}>
          {images.map((image, index) => {
            const items: MenuItem[] = manage
              ? [
                  ...(index > 0
                    ? [
                        {
                          id: 'up',
                          label: m.moveUp,
                          onSelect: () => {
                            const next = movedImageIds(ids, index, -1);
                            if (next) void post('images/order', { imageIds: next }, m.moved);
                          },
                        },
                      ]
                    : []),
                  ...(index < images.length - 1
                    ? [
                        {
                          id: 'down',
                          label: m.moveDown,
                          onSelect: () => {
                            const next = movedImageIds(ids, index, 1);
                            if (next) void post('images/order', { imageIds: next }, m.moved);
                          },
                        },
                      ]
                    : []),
                  {
                    id: 'remove',
                    label: m.remove,
                    icon: 'trash' as const,
                    tone: 'danger' as const,
                    onSelect: () => setRemoving(image),
                  },
                ]
              : [];
            return (
              <MediaTile
                key={image.id}
                src={mediaVariantUrl(image.mediaAssetId, 'thumb')}
                title={title(image, index)}
                meta={fill(m.position, { n: index + 1 })}
                actionLabel={fill(m.open, { name: title(image, index) })}
                onSelect={() => setViewing(image)}
                actions={
                  items.length > 0 ? (
                    <RowActions
                      menuLabel={fill(t.common.list.actionsFor, { name: title(image, index) })}
                      items={items}
                    />
                  ) : undefined
                }
              />
            );
          })}
        </MediaGrid>
      )}
      {picking ? (
        <MediaPicker onPick={(asset) => void add(asset)} onClose={() => setPicking(false)} />
      ) : null}
      {viewing ? (
        <Dialog
          open
          size="lg"
          title={m.preview}
          closeLabel={t.common.close}
          onClose={() => setViewing(null)}
        >
          <MediaPreview
            src={mediaVariantUrl(viewing.mediaAssetId, 'lg')}
            alt={viewing.altVi ?? ''}
          />
        </Dialog>
      ) : null}
      {removing ? (
        <ConfirmDialog
          title={m.removeTitle}
          description={m.removeBody}
          tone="danger"
          confirmLabel={m.removeConfirm}
          busyLabel={p.variants.working}
          cancelLabel={p.variants.confirmCancel}
          referenceLabel={t.errors.reference}
          describeError={(error) => ({
            message: productErrorText(error, locale, (cause) => errorMessage(cause, t)),
            reference: error instanceof ApiError ? error.requestId : null,
          })}
          onCancel={() => setRemoving(null)}
          onConfirm={async () => {
            try {
              await api.post(`/api/v1/products/${product.id}/images/${removing.id}/remove`, {});
            } catch (error) {
              if (error instanceof ApiError && error.code === 'CONFLICT') await reload();
              throw error;
            }
            await reload();
            setRemoving(null);
            notify(m.removed);
          }}
        />
      ) : null}
    </ListSection>
  );
}
