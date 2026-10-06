// Touch gate (Owner bug 2026-10-06): after a tap on a touch screen no control may stay in its hover look (the round header
// button that stayed red). The browser keeps :hover on the tapped element until the next tap elsewhere, so a hover style that
// is not behind `@media (hover: hover) and (pointer: fine)` sticks.
//
//   node scripts/uxui-touch-check.mjs <base-url> [--page /vi] [--width 390] [--inject-sticky]
//
// It emulates a phone with touch (no mouse), taps each header tool, the contact button and a menu or tab link without
// following it, waits for the transitions, and compares the computed background, border colour, text colour, transform and
// scale with the values before the tap. Any difference after 600 ms is a failure (exit code 3). `--inject-sticky` adds the old
// unguarded `.ls-site-tool:hover` rule first, to prove the check catches it. Needs Node 22+ and Edge or Chrome.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createProfile, disposeProfile } from './uxui-browser-profile.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args.splice(index, 2)[1] : fallback;
};
const inject = args.includes('--inject-sticky');
if (inject) args.splice(args.indexOf('--inject-sticky'), 1);
const page = flag('page', '/vi');
const width = Number(flag('width', '390'));
const [base] = args;
if (!base) {
  console.error('usage: node scripts/uxui-touch-check.mjs <base-url> [--page /vi] [--width 390]');
  process.exit(2);
}

const browser = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find((candidate) => existsSync(candidate));
if (!browser) {
  console.error('no Edge or Chrome found');
  process.exit(2);
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const profile = createProfile('uxflow-');
const port = 9800 + Math.floor(Math.random() * 150);
const child = spawn(
  browser,
  [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

let failures = 0;
try {
  let wsUrl;
  for (let attempt = 0; attempt < 60 && !wsUrl; attempt++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      wsUrl = list.find((entry) => entry.type === 'page')?.webSocketDebuggerUrl;
    } catch {
      /* starting */
    }
    if (!wsUrl) await sleep(250);
  }
  const socket = new WebSocket(wsUrl);
  await new Promise((done, fail) => ((socket.onopen = done), (socket.onerror = fail)));
  let counter = 0;
  const pending = new Map();
  const waiters = [];
  socket.onmessage = (message) => {
    const data = JSON.parse(message.data);
    if (data.id && pending.has(data.id)) {
      const { resolve, reject } = pending.get(data.id);
      pending.delete(data.id);
      if (data.error) reject(new Error(data.error.message));
      else resolve(data.result);
    } else if (data.method) for (const w of [...waiters]) if (w.method === data.method) w.done();
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++counter;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  const once = (method) =>
    new Promise((done) => {
      const w = { method, done: () => (waiters.splice(waiters.indexOf(w), 1), done()) };
      waiters.push(w);
    });
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };

  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width,
    height: 780,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  const loaded = once('Page.loadEventFired');
  await send('Page.navigate', { url: new URL(page, base).href });
  await loaded;
  await sleep(1800);
  if (inject) {
    await evaluate(`(() => {
      const style = document.createElement('style');
      style.textContent = '.ls-site-tool:hover { background: var(--ls-hover-bg); color: var(--ls-hover-text); }';
      document.head.append(style);
    })()`);
  }

  const media = await evaluate(
    `({ hover: matchMedia('(hover: hover)').matches, fine: matchMedia('(pointer: fine)').matches, coarse: matchMedia('(pointer: coarse)').matches })`,
  );
  console.log(`media: hover ${media.hover}, fine ${media.fine}, coarse ${media.coarse}`);
  if (media.hover && media.fine) {
    console.log('FAIL the emulation is not a touch screen, nothing to prove');
    process.exit(3);
  }

  // Controls to tap: header tools, the contact button, the first tab bar tab and the first menu entry (never followed).
  const targets = await evaluate(`(() => {
    const picks = [];
    const add = (name, selector) => {
      const el = document.querySelector(selector);
      if (el && el.getBoundingClientRect().width > 0) picks.push({ name, selector });
    };
    add('theme button', '.ls-theme-cycle');
    add('language button', '.ls-site-tool');
    add('bell', '.ls-site-bell .ls-btn-icon');
    add('account button', '.ls-site-tools .ls-btn-icon:not(.ls-site-bell .ls-btn-icon)');
    add('contact button', '.ls-contact-toggle');
    add('tab bar tab', '.ls-tab-bar a:not([aria-current="page"]):not([data-emphasis="true"])');
    add('menu link', '.ls-site-nav a:not([aria-current="page"])');
    return picks;
  })()`);

  if (!targets.length) {
    const where = await evaluate(
      `({ href: location.href, title: document.title, tools: document.querySelectorAll('.ls-site-tool, .ls-theme-cycle').length, width: document.querySelector('.ls-theme-cycle')?.getBoundingClientRect().width })`,
    );
    console.log(`FAIL nothing to tap: ${JSON.stringify(where)}`);
    process.exit(3);
  }
  const look = (selector) =>
    evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      const s = getComputedStyle(el);
      return [s.backgroundColor, s.borderTopColor, s.color, s.transform, s.scale, s.textDecorationLine].join(' | ');
    })()`);

  for (const target of targets) {
    const box = await evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(target.selector)});
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      if (el.tagName === 'A') el.addEventListener('click', (e) => e.preventDefault(), { once: true });
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    await sleep(200);
    const before = await look(target.selector);
    const point = [{ x: box.x, y: box.y, id: 1 }];
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point });
    await sleep(80);
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(700);
    const stuck = await evaluate(
      `document.querySelector(${JSON.stringify(target.selector)}).matches(':hover')`,
    );
    // A control that opened a panel keeps its own "open" look while the panel is open: close it (Escape) and compare then.
    const open = await evaluate(
      `document.querySelector(${JSON.stringify(target.selector)}).getAttribute('aria-expanded') === 'true'`,
    );
    if (open) {
      for (const type of ['keyDown', 'keyUp']) {
        await send('Input.dispatchKeyEvent', {
          type,
          key: 'Escape',
          code: 'Escape',
          windowsVirtualKeyCode: 27,
        });
      }
      await sleep(700);
    }
    const after = await look(target.selector);
    if (before !== after) {
      failures += 1;
      console.log(`FAIL ${target.name}: hover ${stuck}; before [${before}] after [${after}]`);
    } else {
      console.log(`ok   ${target.name}: back to rest after the tap (:hover is ${stuck})`);
    }
  }
  console.log(
    failures ? `${failures} control(s) kept a hover look` : 'no control kept a hover look',
  );
  socket.close();
} finally {
  await disposeProfile(profile, child);
}
process.exit(failures > 0 ? 3 : 0);
