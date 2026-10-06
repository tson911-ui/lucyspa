// Phone tab bar gate (Owner bug 2026-10-06): the bar is flush with the bottom of the screen and nothing of the page shows
// below or behind it, at every scroll position, while the mobile browser's toolbar shows and hides, and with a bottom safe
// area (iPhone home indicator).
//
//   node scripts/uxui-tabbar-check.mjs <base-url> [--pages /vi,/vi/services,...] [--widths 360,390,768] [--schemes light,dark]
//
// For every page, width and scheme it scrolls to the top, the middle and the very bottom, and at each stop checks, with a
// real screenshot read back through a canvas (no dependency):
//   1. the bar is `position: fixed` and its bottom edge is the bottom edge of the viewport (to half a pixel);
//   2. the last rows of the screenshot (the bottom safe area included) are the bar's own opaque colour on every column;
//   3. at the very bottom the last content ends above the bar (the footer is never under it).
// The toolbar is simulated by growing the viewport 80 px after the page is scrolled (then shrinking it back), and the safe
// area by `Emulation.setSafeAreaInsetsOverride` (34 px, an iPhone's). Exit code 3 on any failure; needs Node 22+ and Edge or
// Chrome, like the other gate scripts.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createProfile, disposeProfile } from './uxui-browser-profile.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args.splice(index, 2)[1] : fallback;
};
const pages = flag(
  'pages',
  '/vi,/vi/services,/vi/account/bookings,/vi/account/invoices,/vi/account/book',
).split(',');
const widths = flag('widths', '360,390,414,768').split(',').map(Number);
const schemes = flag('schemes', 'light,dark').split(',');
// `--inject <css>` adds a stylesheet to every page: a self-test that the check fails on a broken bar (for example
// `--inject ".ls-tab-bar{bottom:-40px}"`).
const injected = flag('inject', '');
const shotsDir = flag('shots', '');
let lastShot = '';
const [base] = args;
if (!base) {
  console.error(
    'usage: node scripts/uxui-tabbar-check.mjs <base-url> [--pages ...] [--widths ...] [--schemes ...]',
  );
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

const SAFE_BOTTOM = 34;
const HEIGHT = Number(flag('height', '780'));
const SCALE = Number(flag('scale', '1'));
const DPR = Number(flag('dpr', '1'));
const COVER = args.includes('--cover');
if (COVER) args.splice(args.indexOf('--cover'), 1);
const TOOLBAR = 80;
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const profile = createProfile('uxflow-');
const port = 9300 + Math.floor(Math.random() * 500);
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
let checks = 0;
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
    if (result.exceptionDetails)
      throw new Error(
        result.exceptionDetails.text + ' ' + (result.exceptionDetails.exception?.description ?? ''),
      );
    return result.result.value;
  };
  await send('Page.enable');
  await send('Network.enable');
  let safeInsets = true;
  let safeNow = 0;
  const setSafe = async (bottom) => {
    safeNow = bottom;
    try {
      await send('Emulation.setSafeAreaInsetsOverride', {
        insets: { top: 0, left: 0, right: 0, bottom },
      });
    } catch {
      safeInsets = false;
    }
  };

  // Reads the bar's geometry and the last rows of a real screenshot (decoded in the page through a canvas).
  const probe = async (label) => {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    lastShot = shot.data;
    const result = await evaluate(`(async () => {
      const bar = document.querySelector('.ls-tab-bar');
      if (!bar || getComputedStyle(bar).display === 'none') return { none: true };
      const rect = bar.getBoundingClientRect();
      const style = getComputedStyle(bar);
      const image = new Image();
      image.src = 'data:image/png;base64,${shot.data}';
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(image, 0, 0);
      const scale = image.width / innerWidth;
      const rows = Math.max(2, Math.round(scale * 6));
      const data = context.getImageData(0, image.height - rows, image.width, rows).data;
      // The bar's own colour: its background, read from a pixel of the bar's top-left corner area inside the border.
      const probeAt = context.getImageData(2, Math.round((rect.top + 4) * scale), 1, 1).data;
      const contentBoxes = [];
      // Everything the bar shows (each tab's link, icon and label, the raised button) must be inside the part of the page the
      // person sees: the layout viewport (innerHeight) AND the visual viewport (what is left after a browser toolbar), and
      // a label must stay inside its own tab. The bar itself being flush says nothing if the viewport is bigger than the screen.
      const visibleBottom = Math.min(innerHeight, visualViewport.offsetTop + visualViewport.height);
      const outside = [];
      for (const link of bar.querySelectorAll('a')) {
        const linkRect = link.getBoundingClientRect();
        const parts = [['link', linkRect], ['icon', link.querySelector('svg')?.getBoundingClientRect()]];
        const walker = document.createTreeWalker(link, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (!node.textContent.trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          parts.push(['label', range.getBoundingClientRect()]);
        }
        for (const [part, box] of parts) {
          if (!box || (box.width === 0 && box.height === 0)) continue;
          if (part !== 'link') contentBoxes.push(box);
          const name = link.textContent.trim().replace(/\\s+/g, ' ') + ' ' + part;
          if (box.bottom > visibleBottom + 0.5) outside.push(name + ' bottom ' + Math.round(box.bottom) + ' > visible ' + Math.round(visibleBottom));
          if (box.top < -0.5) outside.push(name + ' top ' + Math.round(box.top) + ' < 0');
          if (part === 'label' && box.bottom > linkRect.bottom + 0.5) outside.push(name + ' is cut below its tab');
          if (part === 'label' && box.bottom > linkRect.bottom - 3) outside.push(name + ' touches the bottom edge of its tab (needs 4px of air)');
        }
      }
      // The last rows of the screenshot are the bar's own colour everywhere except under a tab's own icon or label.
      const rowWidth = image.width;
      let bad = 0;
      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < rowWidth; column += 3) {
          const x = column / scale;
          const y = (image.height - rows + row) / scale;
          if (contentBoxes.some((b) => x >= b.left - 1 && x <= b.right + 1 && y >= b.top - 1 && y <= b.bottom + 1)) continue;
          const i = (row * rowWidth + column) * 4;
          if (Math.abs(data[i] - probeAt[0]) > 6 || Math.abs(data[i + 1] - probeAt[1]) > 6 || Math.abs(data[i + 2] - probeAt[2]) > 6) bad += 1;
        }
      }
      const last = document.querySelector('footer, .ls-footer, .ls-site-footer');
      const lastBottom = last ? last.getBoundingClientRect().bottom : null;
      const atEnd = Math.ceil(scrollY + innerHeight) >= document.documentElement.scrollHeight - 1;
      return {
        position: style.position,
        gap: Math.round((innerHeight - rect.bottom) * 10) / 10,
        opaque: !/rgba\\(.*,\\s*0(\\.\\d+)?\\)$/.test(style.backgroundColor) && style.backgroundColor !== 'transparent',
        badPixels: bad,
        sampled: rows * Math.ceil(rowWidth / 3),
        barTop: Math.round(rect.top),
        lastBottom: lastBottom === null ? null : Math.round(lastBottom),
        atEnd,
        paddingBottom: style.paddingBottom,
        visualGap: Math.round((visibleBottom - rect.bottom) * 10) / 10,
        wide: (() => {
          const root = document.documentElement;
          if (root.scrollWidth <= root.clientWidth + 1) return [];
          const names = [];
          for (const el of document.body.querySelectorAll('*')) {
            if (names.length >= 4) break;
            const r = el.getBoundingClientRect();
            if (r.width > 0 && r.right > root.clientWidth + 1 && getComputedStyle(el).position !== 'fixed') names.push(el.tagName.toLowerCase() + '.' + String(el.className).split(' ')[0] + ' right ' + Math.round(r.right));
          }
          return ['page is ' + root.scrollWidth + ' wide, screen ' + root.clientWidth, ...names];
        })(),
        outside,
      };
    })()`);
    return { label, ...result };
  };

  const report = (where, r) => {
    if (r.none) return;
    checks += 1;
    const problems = [];
    if (r.position !== 'fixed') problems.push(`position is ${r.position}, not fixed`);
    if (Math.abs(r.gap) > 0.5)
      problems.push(`bar bottom is ${r.gap}px from the bottom of the screen`);
    if (!r.opaque) problems.push('bar background is not opaque');
    if (Math.abs(r.visualGap) > 0.5)
      problems.push(`bar bottom is ${r.visualGap}px from the bottom of the visual viewport`);
    if (r.outside.length) problems.push(`outside the visible screen: ${r.outside.join(', ')}`);
    if (r.wide.length)
      problems.push(
        `wider than the screen (the browser zooms out and the fixed bar leaves the visible screen): ${r.wide.join('; ')}`,
      );
    if (safeInsets && r.paddingBottom !== `${safeNow}px`) {
      problems.push(
        `safe area is not padding inside the bar (padding-bottom ${r.paddingBottom}, expected ${safeNow}px)`,
      );
    }
    if (r.badPixels > 0)
      problems.push(
        `${r.badPixels} of ${r.sampled} pixels in the last rows are not the bar colour`,
      );
    if (r.atEnd && r.lastBottom !== null && r.lastBottom > r.barTop + 1)
      problems.push(`footer ends at ${r.lastBottom}, under the bar (top ${r.barTop})`);
    if (problems.length) {
      failures += 1;
      console.log(`FAIL ${where} ${r.label}: ${problems.join('; ')}`);
    }
  };

  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  // Safe area 0 (Android, desktop browsers) and 34 px (iPhone home indicator); and an enlarged text size (a phone's
  // "font size" setting scales rem), where a label that wraps to a third line must still stay inside its tab.
  const variants = [
    { safe: 0, text: 100 },
    { safe: SAFE_BOTTOM, text: 100 },
    { safe: SAFE_BOTTOM, text: 130 },
  ];
  for (const variant of variants) {
    await setSafe(variant.safe);
    for (const scheme of schemes) {
      for (const width of widths) {
        if (width >= 1024) continue;
        await send('Emulation.setEmulatedMedia', {
          features: [{ name: 'prefers-color-scheme', value: scheme }],
        });
        await send('Network.setCookie', { name: 'ls-theme', value: scheme, url: base });
        await send('Emulation.setDeviceMetricsOverride', {
          width,
          height: HEIGHT,
          deviceScaleFactor: DPR,
          mobile: true,
          scale: SCALE,
        });
        for (const path of pages) {
          const where = `${path} ${width}px ${scheme} safe ${variant.safe} text ${variant.text}%`;
          const loaded = once('Page.loadEventFired');
          await send('Page.navigate', { url: new URL(path, base).href });
          await loaded;
          await sleep(1500);
          if (variant.text !== 100) {
            await evaluate(`document.documentElement.style.fontSize = '${variant.text}%'`);
            await sleep(300);
          }
          if (COVER) {
            await evaluate(
              `document.querySelector('meta[name=viewport]').content = 'width=device-width, initial-scale=1, viewport-fit=cover'`,
            );
            await sleep(300);
          }
          if (injected) {
            await evaluate(
              `document.head.append(Object.assign(document.createElement('style'), { textContent: ${JSON.stringify(injected)} }))`,
            );
            await sleep(200);
          }
          const max = await evaluate('document.documentElement.scrollHeight - innerHeight');
          const stops = [
            ['top', 0],
            ['middle', Math.round(max / 2)],
            ['bottom', max],
          ];
          for (const [name, y] of stops) {
            await evaluate(`window.scrollTo(0, ${y})`);
            await sleep(350);
            report(where, await probe(`${name}`));
            // Pictures for the review (the first variant only: safe area 0, normal text size, toolbar shown).
            if (shotsDir && variant === variants[0]) {
              mkdirSync(shotsDir, { recursive: true });
              const slug = path.replace(/^\/vi\/?/, '').replace(/\//g, '-') || 'home';
              writeFileSync(
                `${shotsDir}/${slug}-${width}-${scheme}-${name}.png`,
                Buffer.from(lastShot, 'base64'),
              );
            }
            // The toolbar hides (the viewport grows), then shows again.
            await send('Emulation.setDeviceMetricsOverride', {
              width,
              height: HEIGHT + TOOLBAR,
              deviceScaleFactor: DPR,
              mobile: true,
              scale: SCALE,
            });
            await sleep(300);
            report(where, await probe(`${name}, toolbar hidden`));
            await send('Emulation.setDeviceMetricsOverride', {
              width,
              height: HEIGHT,
              deviceScaleFactor: DPR,
              mobile: true,
              scale: SCALE,
            });
            await sleep(300);
          }
          // Fast scrolling: ten jumps, then a check at once.
          for (let step = 0; step < 10; step++)
            await evaluate(`window.scrollTo(0, ${Math.round((max * ((step * 7) % 10)) / 10)})`);
          report(where, await probe('after fast scrolling'));
        }
      }
    }
  }
  console.log(
    `${checks} checks, ${failures} failed${safeInsets ? '' : ' (safe-area override unavailable in this browser)'}`,
  );
  socket.close();
} finally {
  await disposeProfile(profile, child);
}
process.exit(failures > 0 ? 3 : 0);
