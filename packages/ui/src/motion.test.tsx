import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { after, test } from 'node:test';
import { installDom } from './dom-harness';
import type { MotionKit } from './motion';
import {
  STAFF_MOTION_CAP_MS,
  clampDurationMs,
  parseCssDurationMs,
  parseCssPx,
  resolveMotionState,
  type MotionSwitches,
} from './motion-core';

// GSAP wrapper (C7): the switches, the staff cap, the token parsing, the gate and the wrapper's run/revert contract.
const dom = installDom();
const { window } = dom;
after(() => window.close());
const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const ui = await import('./index');
const motion = await import('./motion');

const device: MotionSwitches['environment'] = {
  reducedMotion: false,
  saveData: false,
  deviceMemory: undefined,
  hasObserver: true,
};
const on: MotionSwitches = {
  environment: device,
  effectsEnabled: true,
  staffSetting: 'on',
  killed: false,
};

test('every switch alone turns motion off, and the device decides otherwise', () => {
  assert.equal(resolveMotionState(on), 'full');
  assert.equal(resolveMotionState({ ...on, effectsEnabled: false }), 'reduced', 'ls-fx=off');
  assert.equal(resolveMotionState({ ...on, staffSetting: 'off' }), 'reduced', 'staff setting');
  assert.equal(resolveMotionState({ ...on, killed: true }), 'reduced', 'kill flag');
  assert.equal(
    resolveMotionState({ ...on, environment: { ...device, reducedMotion: true } }),
    'reduced',
  );
  assert.equal(
    resolveMotionState({ ...on, environment: { ...device, saveData: true } }),
    'reduced',
  );
  assert.equal(
    resolveMotionState({ ...on, environment: { ...device, deviceMemory: 1 } }),
    'reduced',
  );
});

test('durations: tokens parse in ms or s, an unknown token is 0, and the compact scope is capped at 200 ms', () => {
  assert.equal(parseCssDurationMs('240ms'), 240);
  assert.equal(parseCssDurationMs(' 0.56s '), 560);
  assert.equal(parseCssDurationMs('0ms'), 0);
  assert.equal(parseCssDurationMs(''), 0);
  assert.equal(parseCssDurationMs('var(--x)'), 0);
  assert.equal(parseCssPx('16px'), 16);
  assert.equal(parseCssPx('0px'), 0);
  assert.equal(parseCssPx('1rem'), 0);
  assert.equal(STAFF_MOTION_CAP_MS, 200);
  assert.equal(clampDurationMs(560, false), 560);
  assert.equal(clampDurationMs(560, true), 200);
  assert.equal(clampDurationMs(120, true), 120);
});

function fakeModules(calls: { contexts: number; reverted: number; built: MotionKit[] }) {
  return {
    gsap: {
      context: (build: () => void) => {
        calls.contexts += 1;
        build();
        return {
          revert: () => {
            calls.reverted += 1;
          },
        };
      },
    },
    ScrollTrigger: {},
  };
}

const settle = () => act(async () => void (await Promise.resolve()));

test('run: nothing loads while motion is reduced; when full GSAP loads after first paint and the kit reads the tokens', async () => {
  const calls = { contexts: 0, reverted: 0, built: [] as MotionKit[] };
  let loads = 0;
  const paint: { run?: (() => void) | undefined } = {};
  motion.configureMotion({
    load: async () => {
      loads += 1;
      return fakeModules(calls) as never;
    },
    afterFirstPaint: (callback) => {
      paint.run = callback;
    },
  });
  const root = window.document.documentElement;
  const scope = window.document.createElement('section');
  window.document.body.appendChild(scope);
  scope.style.setProperty('--ls-dur-reveal', '560ms');
  scope.style.setProperty('--ls-stagger', '60ms');
  scope.style.setProperty('--ls-reveal-shift', '16px');

  // Reduced: the fallback runs at once, the loader is never asked.
  root.dataset['lsMotion'] = 'reduced';
  let unavailable = 0;
  const stopReduced = motion.runMotion(scope, () => assert.fail('no tween while reduced'), {
    onUnavailable: () => (unavailable += 1),
  });
  assert.equal(unavailable, 1);
  assert.equal(paint.run, undefined);
  stopReduced();

  // Full: waits for the first paint, then loads once and builds inside a context.
  root.dataset['lsMotion'] = 'full';
  let kit: MotionKit | undefined;
  const stop = motion.runMotion(scope, (made) => (kit = made));
  assert.equal(loads, 0, 'not before the first paint');
  (paint as { run?: () => void }).run?.();
  await settle();
  await settle();
  assert.equal(loads, 1);
  assert.equal(calls.contexts, 1);
  assert.ok(kit);
  assert.equal(kit.compact, false);
  assert.equal(kit.duration('reveal'), 0.56);
  assert.equal(kit.duration('hero'), 0, 'a token that is not set never animates');
  assert.equal(kit.shift(), 16);
  assert.equal(kit.stagger(3), 0.18);
  stop();
  assert.equal(calls.reverted, 1);

  // A second consumer reuses the loaded modules.
  paint.run = undefined;
  const again = motion.runMotion(scope, () => {});
  await settle();
  assert.equal(loads, 1);
  again();
  delete root.dataset['lsMotion'];
  scope.remove();
  motion.configureMotion();
});

test('the compact scope clamps every duration to 200 ms and a focused text field is never tweened', async () => {
  const calls = { contexts: 0, reverted: 0, built: [] as MotionKit[] };
  motion.configureMotion({
    load: async () => fakeModules(calls) as never,
    afterFirstPaint: (callback) => callback(),
  });
  const root = window.document.documentElement;
  root.dataset['lsMotion'] = 'full';
  const shell = window.document.createElement('div');
  shell.setAttribute('data-density', 'compact');
  shell.innerHTML = '<section><input aria-label="x" /></section>';
  window.document.body.appendChild(shell);
  const scope = shell.querySelector('section') as HTMLElement;
  scope.style.setProperty('--ls-dur-slow', '320ms');
  scope.style.setProperty('--ls-dur-fast', '120ms');
  let kit: MotionKit | undefined;
  const stop = motion.runMotion(scope, (made) => (kit = made));
  await settle();
  await settle();
  assert.ok(kit);
  assert.equal(kit.compact, true);
  assert.equal(kit.duration('slow'), 0.2);
  assert.equal(kit.duration('fast'), 0.12);
  const input = scope.querySelector('input') as HTMLInputElement;
  assert.equal(kit.canAnimate(scope), true);
  input.focus();
  assert.equal(kit.canAnimate(scope), false, 'the caret is inside');
  input.blur();
  stop();
  shell.remove();
  delete root.dataset['lsMotion'];
  motion.configureMotion();
});

test('MotionGate: the ls-fx switch and the staff setting turn the gate to reduced, live, and the document is cleaned up', async () => {
  class Observer {
    observe() {}
    disconnect() {}
  }
  (window as unknown as Record<string, unknown>).IntersectionObserver = Observer;
  (globalThis as Record<string, unknown>).IntersectionObserver = Observer;
  const mark = () => window.document.documentElement.dataset['lsMotion'];
  const container = window.document.createElement('div');
  window.document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<ui.MotionGate />));
  assert.equal(mark(), 'full');
  // The visitor's switch, flipped while the page is open (the same cookie and listeners as the particles' toggle).
  const fx = { current: undefined as ReturnType<typeof ui.useSeasonFx> | undefined };
  function Probe() {
    fx.current = ui.useSeasonFx();
    return null;
  }
  const probeContainer = window.document.createElement('div');
  const probeRoot = createRoot(probeContainer);
  act(() => probeRoot.render(<Probe />));
  act(() => fx.current?.setEnabled(false));
  assert.equal(mark(), 'reduced');
  act(() => fx.current?.setEnabled(true));
  assert.equal(mark(), 'full');
  act(() => root.render(<ui.MotionGate staffSetting="off" />));
  assert.equal(mark(), 'reduced');
  act(() => root.unmount());
  act(() => probeRoot.unmount());
  assert.equal(mark(), undefined);
});

test('the build-time kill flag: the wrapper never reports full and never asks the loader', () => {
  const script =
    "const m = await import('./src/motion.ts'); let asked = 0;" +
    "m.configureMotion({ load: async () => { asked += 1; throw new Error('x'); }, afterFirstPaint: (c) => c() });" +
    "const { JSDOM } = await import('jsdom'); const w = new JSDOM('').window; globalThis.document = w.document;" +
    "w.document.documentElement.dataset.lsMotion = 'full';" +
    'let fallback = 0; m.runMotion(w.document.body, () => {}, { onUnavailable: () => (fallback += 1) });' +
    'await new Promise((r) => setTimeout(r, 20)); console.log(JSON.stringify({ killed: m.MOTION_KILLED, state: m.motionState(), asked, fallback }));';
  const run = (flag: string | undefined) =>
    JSON.parse(
      execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
        cwd: new URL('..', import.meta.url),
        env: {
          ...process.env,
          ...(flag ? { NEXT_PUBLIC_LS_MOTION: flag } : { NEXT_PUBLIC_LS_MOTION: '' }),
        },
        encoding: 'utf8',
      }),
    );
  assert.deepEqual(run('off'), { killed: true, state: 'reduced', asked: 0, fallback: 1 });
  assert.equal(run(undefined).killed, false);
});

test('the wrapper imports GSAP only through dynamic import, and no other file imports it', () => {
  const source = readFileSync(new URL('motion.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(
    source,
    /^import (?!type )[^;]*from 'gsap/m,
    'a static GSAP import would put it in the first bundle',
  );
  assert.match(source, /import\('gsap'\)/);
  assert.match(source, /import\('gsap\/ScrollTrigger'\)/);
  assert.match(source, /NEXT_PUBLIC_LS_MOTION/);
});
