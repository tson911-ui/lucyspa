'use client';

// GSAP wrapper (DESIGN.md 11.5, 11.6). Components never import GSAP: they call `useMotion().run(scope, build)` and get a kit. GSAP and
// ScrollTrigger come in through one dynamic import after the first paint, and only while motion is `full`. Reduced motion, the `ls-fx`
// off switch, the staff setting and the build-time kill flag all give the final state with no tween; turning motion off while a page is
// open reverts every running tween to that state. Only transform and opacity may be animated through the kit.
import type { gsap } from 'gsap';
import type { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useSyncExternalStore } from 'react';
import { parseFxCookie } from './season-fx-core';
import { findScroller } from './scroller';
import {
  clampDurationMs,
  parseCssDurationMs,
  parseCssPx,
  resolveMotionState,
  type MotionState,
  type MotionToken,
} from './motion-core';
import { readMotionEnvironment } from './reveal-core';

type GsapCore = typeof gsap;
type ScrollTriggerPlugin = typeof ScrollTrigger;
interface GsapModules {
  gsap: GsapCore;
  ScrollTrigger: ScrollTriggerPlugin;
}

/** `NEXT_PUBLIC_LS_MOTION=off` at build time: the bundler drops the dynamic import, so no GSAP chunk exists. */
export const MOTION_KILLED = process.env.NEXT_PUBLIC_LS_MOTION === 'off';

/** The attribute `MotionGate` keeps on `<html>`; the stylesheet and this wrapper both read it. */
const ATTRIBUTE = 'data-ls-motion';

/** What a component gets inside `run`. */
export interface MotionKit {
  gsap: GsapCore;
  ScrollTrigger: ScrollTriggerPlugin;
  /** The element the context is scoped to. */
  scope: Element;
  /** Inside `data-density='compact'`: durations are clamped to 200 ms. */
  compact: boolean;
  /** A duration token in seconds, clamped in the compact scope. */
  duration(token: MotionToken): number;
  /** The reveal distance in px (`--ls-reveal-shift`, 0 under reduced motion). */
  shift(): number;
  /** The stagger step in seconds for a sibling position (`--ls-stagger`). */
  stagger(position: number): number;
  /** ScrollTrigger's scroller for this element: the phone shell's scroller, or the window. */
  scroller(): HTMLElement | Window;
  /** False when the element holds the focus of a text field: nothing is tweened under the caret. */
  canAnimate(element: Element): boolean;
}

export interface RunOptions {
  /** Called once when the build will never run (motion is off, GSAP did not load, or motion turned off first): show the final state. */
  onUnavailable?: (() => void) | undefined;
}

// --------------------------------------------------------------------------------------------------------------- state

function cookieEnabled(): boolean {
  return parseFxCookie(document.cookie);
}

/** The gate's mark when it has run; before that, the same rule worked out here (without the staff setting, which only the gate knows). */
export function motionState(): MotionState {
  if (typeof document === 'undefined' || MOTION_KILLED) return 'reduced';
  const mark = document.documentElement.getAttribute(ATTRIBUTE);
  if (mark === 'full' || mark === 'reduced') return mark;
  return resolveMotionState({
    environment: readMotionEnvironment(),
    effectsEnabled: cookieEnabled(),
    staffSetting: 'on',
    killed: false,
  });
}

const stateListeners = new Set<() => void>();
let attributeObserver: MutationObserver | null = null;

function subscribeState(listener: () => void): () => void {
  stateListeners.add(listener);
  if (!attributeObserver && typeof MutationObserver !== 'undefined') {
    attributeObserver = new MutationObserver(() => stateListeners.forEach((notify) => notify()));
    attributeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: [ATTRIBUTE],
    });
  }
  return () => {
    stateListeners.delete(listener);
    if (stateListeners.size === 0) {
      attributeObserver?.disconnect();
      attributeObserver = null;
    }
  };
}

// ------------------------------------------------------------------------------------------------------------ loading

interface Loader {
  load: () => Promise<GsapModules>;
  /** Waits for the first paint; replaced in tests. */
  afterFirstPaint: (callback: () => void) => void;
}

const defaultLoader: Loader = {
  // The flag is written out here, with both imports inside the branch that survives: the bundler folds the comparison, so a build
  // with the flag emits no GSAP chunk at all.
  load: () =>
    process.env.NEXT_PUBLIC_LS_MOTION === 'off'
      ? Promise.reject(new Error('motion is disabled at build time'))
      : Promise.all([import('gsap'), import('gsap/ScrollTrigger')]).then(([core, trigger]) => {
          core.gsap.registerPlugin(trigger.ScrollTrigger);
          return { gsap: core.gsap, ScrollTrigger: trigger.ScrollTrigger };
        }),
  afterFirstPaint: (callback) => {
    requestAnimationFrame(() => setTimeout(callback, 0));
  },
};

let loader: Loader = defaultLoader;
let loading: Promise<GsapModules | null> | null = null;

/** Test seam: replaces the dynamic import and the first-paint wait. Pass nothing to restore. */
export function configureMotion(next?: Partial<Loader>): void {
  loader = { ...defaultLoader, ...next };
  loading = null;
}

function loadGsap(): Promise<GsapModules | null> {
  if (MOTION_KILLED) return Promise.resolve(null);
  loading ??= new Promise<GsapModules | null>((resolve) => {
    loader.afterFirstPaint(() => {
      loader.load().then(resolve, () => {
        // The network lost the chunk: the page keeps its final state, and a later visit tries again.
        loading = null;
        resolve(null);
      });
    });
  });
  return loading;
}

// ------------------------------------------------------------------------------------------------------------- kit

const COMPACT_SELECTOR = "[data-density='compact']";

/** The longest tween the compact (staff) scope allows, in seconds (Owner G5, 2026-10-16). */
const COMPACT_MAX_S = 0.2;

interface ProbeEntry {
  target: string;
  duration: number;
  ease: string;
  compact: boolean;
}
declare global {
  interface Window {
    /** Set by the test driver only (scripts/uxui-capture.py): every tween created through the kit is recorded in __lsMotionLog. */
    __lsMotionProbe?: boolean;
    __lsMotionLog?: ProbeEntry[];
  }
}

function describe(target: unknown): string {
  const first = Array.isArray(target) ? target[0] : target;
  if (first instanceof Element) {
    const cls =
      typeof first.className === 'string'
        ? first.className.trim().split(/\s+/).slice(0, 2).join('.')
        : '';
    return first.tagName.toLowerCase() + (cls ? '.' + cls : '');
  }
  return typeof first;
}

/**
 * What a tween may change (G5, DESIGN.md 17.3: transform and opacity only) and the tween's own settings. Anything else (a width, a
 * colour, a `stagger`: no stagger, G2) is dropped from the vars, with a warning outside production, so no caller can animate layout.
 */
const ANIMATABLE = new Set([
  'x',
  'y',
  'z',
  'xPercent',
  'yPercent',
  'scale',
  'scaleX',
  'scaleY',
  'rotate',
  'rotation',
  'rotateX',
  'rotateY',
  'rotationX',
  'rotationY',
  'skewX',
  'skewY',
  'opacity',
  'autoAlpha',
  'transformOrigin',
  'transformPerspective',
  'force3D',
  'clearProps',
]);
const SETTINGS = new Set([
  'duration',
  'delay',
  'ease',
  'repeat',
  'repeatDelay',
  'yoyo',
  'paused',
  'reversed',
  'overwrite',
  'immediateRender',
  'lazy',
  'id',
  'data',
  'callbackScope',
  'inherit',
  'defaults',
  'scrollTrigger',
  'onStart',
  'onStartParams',
  'onUpdate',
  'onUpdateParams',
  'onComplete',
  'onCompleteParams',
  'onRepeat',
  'onRepeatParams',
  'onReverseComplete',
  'onReverseCompleteParams',
  'onInterrupt',
]);

/** The rejected keys of a vars object (it is cleaned in place), for the probe and the warning. */
export function cleanTweenVars(vars: unknown, compact: boolean): string[] {
  if (!vars || typeof vars !== 'object') return [];
  const v = vars as Record<string, unknown>;
  const rejected: string[] = [];
  for (const key of Object.keys(v)) {
    if (ANIMATABLE.has(key) || SETTINGS.has(key)) continue;
    rejected.push(key);
    delete v[key];
  }
  if (compact) {
    if (typeof v['duration'] === 'number') v['duration'] = Math.min(v['duration'], COMPACT_MAX_S);
    if (typeof v['delay'] === 'number') v['delay'] = Math.min(v['delay'], COMPACT_MAX_S);
  }
  if (v['defaults']) cleanTweenVars(v['defaults'], compact);
  return rejected;
}

/**
 * The GSAP handed to a component: every tween, `set`, timeline (its defaults and every child tween) and `quickTo` goes through the
 * same guard: transform and opacity only, and in the compact scope every duration and delay is clamped to 200 ms, so the staff cap is
 * enforced here, not left to each component. With the test probe on, every tween is recorded (target, duration, ease).
 */
function guarded(core: GsapCore, compact: boolean): GsapCore {
  const fix = (vars: unknown): void => {
    const rejected = cleanTweenVars(vars, compact);
    if (rejected.length > 0 && process.env.NODE_ENV !== 'production') {
      console.warn(`useMotion: only transform and opacity animate; dropped ${rejected.join(', ')}`);
    }
  };
  const record = (target: unknown, vars: unknown): void => {
    if (typeof window === 'undefined' || !window.__lsMotionProbe) return;
    const v = (vars ?? {}) as { duration?: number; ease?: unknown };
    (window.__lsMotionLog ??= []).push({
      target: describe(target),
      duration: typeof v.duration === 'number' ? v.duration : 0.5,
      ease: typeof v.ease === 'string' ? v.ease : 'default',
      compact,
    });
  };
  type Call = (...args: unknown[]) => unknown;
  // `to`, `from` and `set` take (target, vars, position?); `fromTo` takes (target, from, vars, position?): the `from` side is
  // checked for its properties too, and the timing lives in `vars`.
  const tweens = <T extends object>(object: T): T =>
    new Proxy(object, {
      get(host, key, receiver) {
        const value = Reflect.get(host, key, receiver) as unknown;
        if (typeof value !== 'function') return value;
        const call = value as Call;
        // A timeline's methods return the timeline for chaining (`tl.to(...).to(...)`): hand back the guarded one.
        const chain = (result: unknown) => (result === host ? receiver : result);
        if (key === 'to' || key === 'from' || key === 'set') {
          return (target: unknown, vars: unknown, ...rest: unknown[]) => {
            fix(vars);
            if (key !== 'set') record(target, vars);
            return chain(call.call(host, target, vars, ...rest));
          };
        }
        if (key === 'fromTo') {
          return (target: unknown, from: unknown, vars: unknown, ...rest: unknown[]) => {
            fix(from);
            fix(vars);
            record(target, vars);
            return chain(call.call(host, target, from, vars, ...rest));
          };
        }
        if (key === 'timeline') {
          // A timeline's defaults are clamped and every child tween added to it goes through the same guard.
          return (vars?: unknown) => tweens(call.call(host, (fix(vars), vars)) as object);
        }
        if (key === 'quickTo') {
          return (target: unknown, property: unknown, vars?: unknown) => {
            if (typeof property === 'string' && !ANIMATABLE.has(property)) {
              throw new Error(
                `useMotion: quickTo may only drive transform or opacity, not ${property}`,
              );
            }
            fix(vars);
            return call.call(host, target, property, vars);
          };
        }
        return value;
      },
    });
  return tweens(core);
}

/** Every live context, so a route change can stop all of them at once (G4). */
const liveContexts = new Set<{ revert: () => void }>();
let routeListening = false;
/** Called by the layouts' route tracker on every pathname change: every running tween is killed and its inline styles put back. */
export function killMotionOnRouteChange(): void {
  for (const context of liveContexts) context.revert();
  liveContexts.clear();
}

function makeKit(modules: GsapModules, scope: Element): MotionKit {
  const compact = scope.closest(COMPACT_SELECTOR) !== null;
  const read = (name: string): string => getComputedStyle(scope).getPropertyValue(name);
  return {
    ...modules,
    gsap: guarded(modules.gsap, compact),
    scope,
    compact,
    duration: (token) =>
      clampDurationMs(parseCssDurationMs(read(`--ls-dur-${token}`)), compact) / 1000,
    shift: () => parseCssPx(read('--ls-reveal-shift')),
    stagger: (position) =>
      (parseCssDurationMs(read('--ls-stagger')) * Math.max(0, position)) / 1000,
    scroller: () => findScroller(scope) ?? window,
    canAnimate: (element) => {
      const active = document.activeElement;
      if (!active || !element.contains(active)) return true;
      return !(
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        (active as HTMLElement).isContentEditable
      );
    },
  };
}

/**
 * Runs `build` inside a GSAP context scoped to `scope`, once GSAP has loaded and only while motion is `full`. Returns the cleanup:
 * it kills the tweens and triggers of this scope and puts back the inline styles they set. Motion turning off reverts the same way.
 */
export function runMotion(
  scope: Element,
  build: (kit: MotionKit) => void,
  options: RunOptions = {},
): () => void {
  let stopped = false;
  let context: ReturnType<GsapCore['context']> | null = null;
  let unavailable = options.onUnavailable;
  const giveUp = () => {
    const callback = unavailable;
    unavailable = undefined;
    callback?.();
  };
  if (motionState() !== 'full') {
    giveUp();
    return () => {};
  }
  const unsubscribe = subscribeState(() => {
    if (motionState() === 'full' || stopped) return;
    context?.revert();
    context = null;
    giveUp();
  });
  void loadGsap().then((modules) => {
    if (stopped) return;
    if (!modules || motionState() !== 'full') {
      giveUp();
      return;
    }
    context = modules.gsap.context(() => build(makeKit(modules, scope)), scope);
    liveContexts.add(context);
    if (!routeListening && typeof window !== 'undefined') {
      routeListening = true;
      window.addEventListener('ls:route', killMotionOnRouteChange);
    }
  });
  return () => {
    stopped = true;
    unsubscribe();
    if (context) liveContexts.delete(context);
    context?.revert();
    context = null;
  };
}

export interface MotionControls {
  /** True while tweens may run (reactive; false on the server and before the gate has run). */
  enabled: boolean;
  run: typeof runMotion;
}

/** What components use: `const motion = useMotion(); useEffect(() => motion.run(element, build), [...])`. */
export function useMotion(): MotionControls {
  const enabled = useSyncExternalStore(
    subscribeState,
    () => motionState() === 'full',
    () => false,
  );
  return { enabled, run: runMotion };
}
