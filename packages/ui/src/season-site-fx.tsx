'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  keepoutMaskImage,
  normalizeKeepouts,
  siteParticleCount,
  siteParticleLayout,
  type KeepoutRect,
  type ParticleDensity,
} from './season-fx-core';
import { useSeasonFx } from './season-particles';
import { CelebrationConfettiPiece } from './season-art-celebration';
import { ChristmasFlake } from './season-art-christmas';
import { TetPetal } from './season-art-tet';
import { safeImageUrl, type SeasonArtKit } from './season-scene';
import { PHONE_QUERY, useMediaQuery } from './use-media-query';

// Site-wide particles (docs/UXUI_REDESIGN_S6_PLAN.md section 3, rules 1 and 7). One layer behind the page content
// (the page wrapper is `position: relative`, the content sits above the layer). The layer is as tall as the page and
// carries a mask with a soft hole over every line of text, button, input and image, measured from the DOM after first
// paint and again on resize, font load and content change, so a petal never crosses or sits behind a word. Particles
// render nothing on the server and on first paint, nothing under `prefers-reduced-motion` (checked here and live),
// nothing when the visitor chose `ls-fx=off`, and they pause while the tab is hidden. `transform` and `opacity` only.

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
const MEASURE_DELAY_MS = 150;
/** `NodeFilter.SHOW_TEXT`, spelled out so the function also runs where `NodeFilter` is not a global. */
const SHOW_TEXT = 4;

interface Geometry {
  width: number;
  height: number;
  mask: string;
}

const EMPTY: Geometry = { width: 0, height: 0, mask: 'none' };

/** Text lines and controls inside `page` (not the decoration itself), in the layer's coordinate system. */
export function collectKeepouts(page: HTMLElement, layer: HTMLElement): KeepoutRect[] {
  const box = layer.getBoundingClientRect();
  const rects: KeepoutRect[] = [];
  const add = (rect: DOMRect) => {
    if (rect.width > 0 && rect.height > 0) {
      rects.push({
        x: rect.left - box.left,
        y: rect.top - box.top,
        width: rect.width,
        height: rect.height,
      });
    }
  };
  const decoration = (node: Node | null): boolean => {
    for (let element = node instanceof Element ? node : (node?.parentElement ?? null); element;) {
      if (
        element === layer ||
        element.getAttribute('aria-hidden') === 'true' ||
        /^(SCRIPT|STYLE|SVG|NOSCRIPT)$/i.test(element.tagName)
      ) {
        return true;
      }
      if (element === page) return false;
      element = element.parentElement;
    }
    return false;
  };
  const walker = document.createTreeWalker(page, SHOW_TEXT);
  const range = document.createRange();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.nodeValue?.trim() || decoration(node)) continue;
    if (typeof range.selectNodeContents !== 'function') break;
    range.selectNodeContents(node);
    if (typeof range.getClientRects !== 'function') break;
    for (const rect of Array.from(range.getClientRects())) add(rect);
  }
  for (const element of Array.from(
    page.querySelectorAll(
      'button, a[href], input, select, textarea, img, video, [data-ls-keepout]',
    ),
  )) {
    if (!decoration(element)) add(element.getBoundingClientRect());
  }
  return rects;
}

/** The per-device effects switch, as a plain button for the greeting strip. Nothing under reduced motion. */
export function SeasonFxSwitch({ labels }: { labels: { turnOff: string; turnOn: string } }) {
  const reducedMotion = useMediaQuery(REDUCED_MOTION_QUERY);
  const { enabled, setEnabled } = useSeasonFx();
  if (reducedMotion) return null;
  return (
    <button type="button" className="ls-art-fx-switch" onClick={() => setEnabled(!enabled)}>
      {enabled ? labels.turnOff : labels.turnOn}
    </button>
  );
}

export function SeasonSiteParticles({
  kit,
  density = 'medium',
  clearHeaderRow = false,
  sprite,
}: {
  kit: SeasonArtKit;
  density?: ParticleDensity;
  /** The page has a decor row above its header: Christmas keeps its snow out of that band. */
  clearHeaderRow?: boolean;
  /** A media-library image that replaces the kit's drawn particle (a path the API serves). */
  sprite?: string | undefined;
}) {
  const spriteUrl = safeImageUrl(sprite);
  const phone = useMediaQuery(PHONE_QUERY);
  const reducedMotion = useMediaQuery(REDUCED_MOTION_QUERY);
  const { enabled } = useSeasonFx();
  const [ready, setReady] = useState(false);
  const [paused, setPaused] = useState(false);
  const [geometry, setGeometry] = useState<Geometry>(EMPTY);
  const [viewport, setViewport] = useState(0);
  const layerRef = useRef<HTMLDivElement>(null);
  const active = ready && enabled && !reducedMotion;

  useEffect(() => {
    // After the first paint, so the effect never delays the content.
    const frame = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const sync = () => setPaused(document.visibilityState === 'hidden');
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, []);

  const measure = useCallback(() => {
    const layer = layerRef.current;
    const page = layer?.parentElement;
    if (!layer || !page) return;
    const { width, height } = layer.getBoundingClientRect();
    const mask = keepoutMaskImage(
      width,
      height,
      normalizeKeepouts(collectKeepouts(page, layer), width, height),
    );
    setViewport(window.innerHeight);
    setGeometry((previous) =>
      previous.width === width && previous.height === height && previous.mask === mask
        ? previous
        : { width, height, mask },
    );
  }, []);

  useEffect(() => {
    if (!active) return;
    const layer = layerRef.current;
    const page = layer?.parentElement;
    if (!layer || !page) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const later = () => {
      clearTimeout(timer);
      timer = setTimeout(measure, MEASURE_DELAY_MS);
    };
    // Already after the first paint (`ready` came from a frame), so measure at once.
    measure();
    window.addEventListener('resize', later);
    void document.fonts?.ready.then(later);
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(later);
    resize?.observe(page);
    // Content that changes after paint (a member page that loads its data): ignore the layer's own particles.
    const mutations = new MutationObserver((records) => {
      if (records.some((record) => !layer.contains(record.target))) later();
    });
    mutations.observe(page, { childList: true, subtree: true, characterData: true });
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', later);
      resize?.disconnect();
      mutations.disconnect();
    };
  }, [active, measure]);

  const count = siteParticleCount(density, phone, geometry.height, viewport);
  const specs = useMemo(() => siteParticleLayout(count), [count]);
  if (reducedMotion || !enabled) return null;

  const span = viewport > 0 && geometry.height > 0 ? Math.max(geometry.height / viewport, 1) : 1;
  const style = {
    '--ls-fx-span': span,
    '--ls-fx-dist': `${Math.round(geometry.height + 48)}px`,
    ...(geometry.mask === 'none'
      ? {}
      : { maskImage: geometry.mask, WebkitMaskImage: geometry.mask }),
  } as CSSProperties;
  return (
    <div
      ref={layerRef}
      className="ls-fx-site"
      data-paused={paused ? 'true' : undefined}
      data-clear-top={clearHeaderRow && kit === 'christmas' ? 'true' : undefined}
      aria-hidden="true"
      style={style}
    >
      {active
        ? specs.map((spec) => (
            <span
              key={spec.index}
              className="ls-fx-site-p"
              style={
                {
                  left: `${spec.left}%`,
                  '--ls-fx-speed': spec.speed,
                  '--ls-fx-delay': spec.delay,
                  '--ls-fx-sway': spec.sway,
                  '--ls-fx-scale': spec.scale,
                } as CSSProperties
              }
            >
              {spriteUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- decoration from the API, sized by CSS
                <img
                  className="ls-fx-site-glyph"
                  src={spriteUrl}
                  alt=""
                  loading="lazy"
                  decoding="async"
                />
              ) : kit === 'tet' ? (
                <TetPetal index={spec.index} />
              ) : kit === 'christmas' ? (
                <ChristmasFlake />
              ) : (
                <CelebrationConfettiPiece index={spec.index} />
              )}
            </span>
          ))
        : null}
    </div>
  );
}
