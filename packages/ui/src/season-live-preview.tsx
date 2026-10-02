'use client';

import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { SegmentedControl } from './segmented';

// The full-page live preview of a season (docs/UXUI_REDESIGN_S6_PLAN.md section 6): the real public home page in an
// iframe at its true width (desktop 1440 or phone 390), light or dark, one frame at a time, scaled down to fit the
// column. The page inside is the app's own `season-preview` route, which draws the draft the form sends it; this
// component is only the frame, the two selectors and the scaling. The frame's size is set from CSS variables so the
// stylesheet holds no length literal.

export type SeasonPreviewDevice = 'desktop' | 'phone';
export type SeasonPreviewTheme = 'light' | 'dark';

/** The width the page is laid out at inside each frame (CSS pixels). */
export const SEASON_PREVIEW_WIDTH: Record<SeasonPreviewDevice, number> = {
  desktop: 1440,
  phone: 390,
};

/** The scale that fits a frame of `width` into `available` (never above 1, never zero). */
export function previewScale(available: number, width: number): number {
  if (!(available > 0) || !(width > 0)) return 1;
  return Math.min(1, available / width);
}

export interface SeasonLivePreviewLabels {
  /** Accessible names of the two selectors (not drawn). */
  device: string;
  theme: string;
  desktop: string;
  phone: string;
  light: string;
  dark: string;
}

export function SeasonLivePreview({
  src,
  frameTitle,
  device,
  theme,
  onDeviceChange,
  onThemeChange,
  height,
  frameRef,
  labels,
  actions,
}: {
  src: string;
  frameTitle: string;
  device: SeasonPreviewDevice;
  theme: SeasonPreviewTheme;
  onDeviceChange: (device: SeasonPreviewDevice) => void;
  onThemeChange: (theme: SeasonPreviewTheme) => void;
  /** The page's own height inside the frame, reported by the page; the frame shows all of it. */
  height: number;
  frameRef: RefObject<HTMLIFrameElement | null>;
  labels: SeasonLivePreviewLabels;
  /** Trailing action of the selector row (Open at 100%). */
  actions?: ReactNode;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState(0);

  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const measure = () => setAvailable(element.getBoundingClientRect().width);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const width = SEASON_PREVIEW_WIDTH[device];
  const scale = previewScale(available, width);
  // Lengths are set here as real values (the stylesheet holds no length literal): the frame at its true size, and the
  // stage at the size the frame has once scaled.
  const style = {
    '--ls-live-w': `${width}px`,
    '--ls-live-h': `${height}px`,
    '--ls-live-sw': `${Math.round(width * scale)}px`,
    '--ls-live-sh': `${Math.round(height * scale)}px`,
    '--ls-live-scale': scale,
  } as React.CSSProperties;
  return (
    <div className="ls-season-live" data-device={device} style={style}>
      <div className="ls-season-live-bar">
        <SegmentedControl
          label={labels.device}
          options={[
            { value: 'desktop', label: labels.desktop },
            { value: 'phone', label: labels.phone },
          ]}
          value={device}
          onChange={onDeviceChange}
        />
        <SegmentedControl
          label={labels.theme}
          options={[
            { value: 'light', label: labels.light },
            { value: 'dark', label: labels.dark },
          ]}
          value={theme}
          onChange={onThemeChange}
        />
        {actions ? <div className="ls-season-live-actions">{actions}</div> : null}
      </div>
      <div ref={stage} className="ls-season-live-stage">
        <iframe ref={frameRef} className="ls-season-live-frame" title={frameTitle} src={src} />
      </div>
    </div>
  );
}
