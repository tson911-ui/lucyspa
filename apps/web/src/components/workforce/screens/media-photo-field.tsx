'use client';

import { Cluster, MediaPreview } from '@lucy-spa/ui';
import { useState } from 'react';
import { mediaVariantUrl } from '../../../lib/workforce/media';
import { useWorkforce } from '../session';
import { Button, Notice } from '../ui';
import { MediaPicker } from './media-picker';

/**
 * Choose, change or remove one library photo inside an existing admin form (redesign group 1, C11b): the preview or "no photo", the
 * Choose / Change button and Remove. The picker is the one the popup, slider and shop-hero forms use, so a photo without Vietnamese
 * alt text is described there first. `mediaId` is `''` when there is none.
 */
export function MediaPhotoField({
  mediaId,
  onChange,
  error,
}: {
  mediaId: string;
  onChange: (mediaId: string) => void;
  /** A server problem with the photo (for example "describe it first"). */
  error?: string | undefined;
}) {
  const { t } = useWorkforce();
  const text = t.services;
  const [picking, setPicking] = useState(false);
  return (
    <>
      {mediaId !== '' ? (
        <MediaPreview src={mediaVariantUrl(mediaId, 'md')} alt={text.photoPreview} />
      ) : (
        <p className="ls-hint">{text.photoNone}</p>
      )}
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Cluster>
        <Button variant="secondary" onClick={() => setPicking(true)}>
          {mediaId !== '' ? text.photoChange : text.photoChoose}
        </Button>
        {mediaId !== '' ? (
          <Button variant="ghost" onClick={() => onChange('')}>
            {text.photoRemove}
          </Button>
        ) : null}
      </Cluster>
      {picking ? (
        <MediaPicker
          onPick={(asset) => {
            onChange(asset.id);
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
      ) : null}
    </>
  );
}
