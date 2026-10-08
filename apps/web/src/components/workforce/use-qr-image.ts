'use client';

import { useEffect, useState } from 'react';

/**
 * A QR image generated in the browser from some text (no third-party image service). `null` until it is ready, and when the text is
 * absent or the image cannot be made.
 */
export function useQrImage(content: string | null, width = 240): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!content) {
      setUrl(null);
      return;
    }
    void import('qrcode')
      .then((module) => module.toDataURL(content, { margin: 1, width, errorCorrectionLevel: 'M' }))
      .then((dataUrl) => {
        if (!cancelled) setUrl(dataUrl);
      })
      .catch(() => {
        if (!cancelled) setUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [content, width]);
  return url;
}
