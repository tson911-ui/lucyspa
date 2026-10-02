'use client';

import type { SeasonParticleKind } from '@lucy-spa/contracts';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from 'react';
import { Button } from './button';
import { cx } from './cx';
import {
  parseFxCookie,
  particleCount,
  particleLayout,
  serializeFxCookie,
  type ParticleSpec,
} from './season-fx-core';
import { starPoints } from './season-ornaments';
import { PHONE_QUERY, useMediaQuery } from './use-media-query';

// Seasonal particles (docs/UXUI_REDESIGN_DESIGN.md 20.2, Q-S5): a small fixed pool of petals, snowflakes, lanterns or
// hearts that drift inside the banner they are placed in (never across the page body). CSS transform and opacity
// only. They render nothing on the server and on first paint, nothing under `prefers-reduced-motion` (checked here
// and live, not only by the global duration reset), nothing when the visitor chose `ls-fx=off`, and they pause while
// the tab is hidden. `aria-hidden`, no pointer events, nothing focusable.

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** The per-device effects switch (cookie `ls-fx`); on unless the cookie says `off`. */
export function useSeasonFx(): { enabled: boolean; setEnabled: (next: boolean) => void } {
  const enabled = useSyncExternalStore(
    subscribe,
    () => parseFxCookie(document.cookie),
    () => true,
  );
  const setEnabled = useCallback((next: boolean) => {
    document.cookie = serializeFxCookie(next);
    listeners.forEach((listener) => listener());
  }, []);
  return { enabled, setEnabled };
}

function Glyph({ kind }: { kind: Exclude<SeasonParticleKind, 'none'> }) {
  return (
    <svg className={`ls-fx-glyph ls-fx-${kind}`} viewBox="0 0 16 16" focusable="false">
      {kind === 'petal' ? <path d="M8 1C13 5 13 11 8 15C3 11 3 5 8 1Z" /> : null}
      {kind === 'snow' ? <path d="M8 1V15M2 4.5L14 11.5M14 4.5L2 11.5" /> : null}
      {kind === 'lantern' ? (
        <>
          {/* A five-point star lantern (đèn ông sao) with a tassel. */}
          <polygon points={starPoints(8, 7, 7.4, 3.1)} />
          <rect x="7.4" y="12.6" width="1.2" height="3.4" />
        </>
      ) : null}
      {kind === 'heart' ? (
        <path d="M8 14C2 10 1 6 3.5 4C5.5 2.5 7.5 3.5 8 5C8.5 3.5 10.5 2.5 12.5 4C15 6 14 10 8 14Z" />
      ) : null}
    </svg>
  );
}

const style = (spec: ParticleSpec): CSSProperties =>
  ({
    left: `${spec.left}%`,
    '--ls-fx-speed': spec.speed,
    '--ls-fx-delay': spec.delay,
    '--ls-fx-sway': spec.sway,
    '--ls-fx-scale': spec.scale,
  }) as CSSProperties;

export function SeasonParticles({
  kind,
  className,
}: {
  kind: SeasonParticleKind;
  className?: string | undefined;
}) {
  const phone = useMediaQuery(PHONE_QUERY);
  const reducedMotion = useMediaQuery(REDUCED_MOTION_QUERY);
  const { enabled } = useSeasonFx();
  const [ready, setReady] = useState(false);
  const [paused, setPaused] = useState(false);

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

  const specs = useMemo(() => particleLayout(particleCount(phone)), [phone]);
  if (kind === 'none' || reducedMotion || !enabled || !ready) return null;

  const direction = kind === 'lantern' || kind === 'heart' ? 'rise' : 'fall';
  return (
    <div
      className={cx('ls-fx', className)}
      data-direction={direction}
      data-paused={paused ? 'true' : undefined}
      aria-hidden="true"
    >
      {specs.map((spec) => (
        <span key={spec.index} className="ls-fx-particle" style={style(spec)}>
          <Glyph kind={kind} />
        </span>
      ))}
    </div>
  );
}

/**
 * "Turn off effects" / "Turn on effects": a real button. Labels come from the caller's dictionaries. Nothing is
 * shown under reduced motion, where there are no effects to switch.
 */
export function SeasonFxToggle({ labels }: { labels: { turnOff: string; turnOn: string } }) {
  const reducedMotion = useMediaQuery(REDUCED_MOTION_QUERY);
  const { enabled, setEnabled } = useSeasonFx();
  if (reducedMotion) return null;
  return (
    <Button variant="ghost" onClick={() => setEnabled(!enabled)}>
      {enabled ? labels.turnOff : labels.turnOn}
    </Button>
  );
}
