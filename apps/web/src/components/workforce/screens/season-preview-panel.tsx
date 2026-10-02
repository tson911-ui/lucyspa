'use client';

import {
  FormSection,
  SeasonLivePreview,
  isSeasonArtKit,
  type SeasonPreviewDevice,
  type SeasonPreviewTheme,
} from '@lucy-spa/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PREVIEW_SOURCE, parsePreviewMessage } from '../../../lib/season-preview';
import { draftOfForm, type SeasonForm } from '../../../lib/workforce/seasons';
import { useWorkforce } from '../session';
import { Button, Notice } from '../ui';

/**
 * The full-page live preview of the season form (docs/UXUI_REDESIGN_S6_PLAN.md section 6): the real public home page
 * in a frame at its true width, desktop or phone, light or dark (one frame at a time), drawn from the form as it
 * stands, saved or not. The form sends its state to the `season-preview` page with `postMessage` on every change; that
 * page answers "ready" (so a reopened frame or a window opened at 100% gets the state at once) and its own height.
 * Messages are accepted only from the frame or the window this panel opened, on this origin.
 */
export function SeasonPreviewPanel({ form }: { form: SeasonForm }) {
  const { t, locale } = useWorkforce();
  const text = t.seasons.form;
  const [device, setDevice] = useState<SeasonPreviewDevice>('desktop');
  const [theme, setTheme] = useState<SeasonPreviewTheme>('light');
  const [height, setHeight] = useState(900);
  const frame = useRef<HTMLIFrameElement | null>(null);
  const opened = useRef<Window | null>(null);
  const src = `/${locale}/season-preview`;

  const message = useMemo(
    () => ({
      source: PREVIEW_SOURCE,
      type: 'draft' as const,
      draft: draftOfForm(form, locale),
      theme,
    }),
    [form, locale, theme],
  );
  const latest = useRef(message);
  const send = useCallback((target: Window | null) => {
    target?.postMessage(latest.current, window.location.origin);
  }, []);

  useEffect(() => {
    latest.current = message;
    send(frame.current?.contentWindow ?? null);
    if (opened.current && !opened.current.closed) send(opened.current);
  }, [message, send]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const fromFrame = event.source !== null && event.source === frame.current?.contentWindow;
      const fromOpened = event.source !== null && event.source === opened.current;
      if (!fromFrame && !fromOpened) return;
      const incoming = parsePreviewMessage(event.data);
      if (incoming?.type === 'ready') send(event.source as Window);
      else if (incoming?.type === 'height' && fromFrame) setHeight(incoming.value);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [send]);

  const openFull = () => {
    opened.current = window.open(
      src,
      'lucy-season-preview',
      device === 'phone' ? 'popup,width=390,height=844' : '',
    );
  };

  return (
    <FormSection
      title={text.previewSection}
      description={text.previewHint}
      actions={
        <Button variant="secondary" icon="eye" onClick={openFull}>
          {text.previewOpen}
        </Button>
      }
    >
      {!isSeasonArtKit(form.presetKey) ? <Notice tone="info">{text.previewKitNote}</Notice> : null}
      {!form.applyCustomer ? <Notice tone="info">{text.previewOffNote}</Notice> : null}
      <SeasonLivePreview
        src={src}
        frameTitle={text.previewFrame}
        device={device}
        theme={theme}
        onDeviceChange={setDevice}
        onThemeChange={setTheme}
        height={height}
        frameRef={frame}
        labels={{
          device: text.previewDevice,
          theme: text.previewTheme,
          desktop: text.previewDesktop,
          phone: text.previewPhone,
          light: text.previewLight,
          dark: text.previewDark,
        }}
      />
    </FormSection>
  );
}
