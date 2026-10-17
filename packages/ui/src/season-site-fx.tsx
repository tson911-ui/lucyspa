'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import {
  keepoutMaskImage,
  normalizeKeepouts,
  siteParticleCount,
  siteParticleLayout,
  type KeepoutRect,
  type ParticleDensity,
} from './season-fx-core';
import { usePageHidden, useSeasonFx } from './season-particles';
import type { SeasonArtKit } from './season-scene';
import { safeImageUrl } from './season-url';
import { PHONE_QUERY, useMediaQuery } from './use-media-query';

/** The one drawing a kit drifts and the way it moves. */
interface ParticleArt {
  Particle: (props: { index: number }) => ReactNode;
  motion?: 'fall' | 'rise' | undefined;
}

// The season art is loaded only once a layer is about to draw (rbp bundle-conditional): no season, reduced motion or `ls-fx=off`
// never download it, and the page's own chunk carries none of the drawings. One promise per kit.
const artLoads = new Map<SeasonArtKit, Promise<ParticleArt>>();

export function loadParticleArt(kit: SeasonArtKit): Promise<ParticleArt> {
  let load = artLoads.get(kit);
  if (!load) {
    load = (async (): Promise<ParticleArt> => {
      const { KIT_ART } = await import('./season-kits');
      const art = KIT_ART[kit];
      if (art) return { Particle: art.Particle, motion: art.motion };
      if (kit === 'tet') return { Particle: (await import('./season-art-tet')).TetPetal };
      if (kit === 'christmas') {
        const { ChristmasFlake } = await import('./season-art-christmas');
        return { Particle: () => <ChristmasFlake /> };
      }
      return { Particle: (await import('./season-art-celebration')).CelebrationConfettiPiece };
    })();
    artLoads.set(kit, load);
  }
  return load;
}

/** Runs `work` when the browser is idle (the keep-out walk reads every line of the page), or soon where there is no idle callback. */
function whenIdle(work: () => void): () => void {
  if (typeof window.requestIdleCallback === 'function') {
    const handle = window.requestIdleCallback(work, { timeout: 500 });
    return () => window.cancelIdleCallback(handle);
  }
  const handle = window.setTimeout(work, 0);
  return () => window.clearTimeout(handle);
}

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
  const paused = usePageHidden();
  const [loaded, setLoaded] = useState<{ kit: SeasonArtKit; art: ParticleArt } | null>(null);
  const [geometry, setGeometry] = useState<Geometry>(EMPTY);
  const [viewport, setViewport] = useState(0);
  const layerRef = useRef<HTMLDivElement>(null);
  const active = ready && enabled && !reducedMotion;
  const art = loaded?.kit === kit ? loaded.art : null;

  useEffect(() => {
    // After the first paint, so the effect never delays the content.
    const frame = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!active) return undefined;
    let live = true;
    void loadParticleArt(kit).then((next) => {
      if (live) setLoaded({ kit, art: next });
    });
    return () => {
      live = false;
    };
  }, [active, kit]);

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
    let cancelIdle: () => void = () => undefined;
    // The keep-out walk reads every text line and control of the page: it waits for an idle moment (rbp js-request-idle-callback).
    const later = () => {
      clearTimeout(timer);
      cancelIdle();
      timer = setTimeout(() => {
        cancelIdle = whenIdle(measure);
      }, MEASURE_DELAY_MS);
    };
    // Already after the first paint (`ready` came from a frame): the first measure at the next idle moment.
    cancelIdle = whenIdle(measure);
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
      cancelIdle();
      window.removeEventListener('resize', later);
      resize?.disconnect();
      mutations.disconnect();
    };
  }, [active, measure]);

  const count = siteParticleCount(density, phone, geometry.height, viewport);
  const specs = useMemo(() => siteParticleLayout(count), [count]);
  // The particles depend only on the pool, the drawing and the sprite: a new mask or page height re-renders the layer's
  // style, not up to 120 particles (rbp rerender-memo).
  const Particle = art?.Particle;
  const particles = useMemo(
    () =>
      Particle
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
                  // A square hint (WIG images); the particle box sets the width and the layer is out of the flow.
                  width={24}
                  height={24}
                  loading="lazy"
                  decoding="async"
                />
              ) : (
                <Particle index={spec.index} />
              )}
            </span>
          ))
        : null,
    [Particle, specs, spriteUrl],
  );
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
      data-kit={kit}
      data-motion={art?.motion}
      data-paused={paused ? 'true' : undefined}
      data-clear-top={clearHeaderRow && kit === 'christmas' ? 'true' : undefined}
      aria-hidden="true"
      style={style}
    >
      {active ? particles : null}
    </div>
  );
}
