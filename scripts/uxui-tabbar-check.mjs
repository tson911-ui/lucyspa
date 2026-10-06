// Phone shell gate (Owner decision 2026-10-06): below 1024 px the customer pages are an app shell. The document never
// scrolls; the page scrolls inside `.ls-site-scroll` (the only scroll container); the tab bar is the last item of the column,
// in normal flow, opaque, with the safe area as padding inside it. This script proves, in a real browser, that content can
// never be behind or below the bar.
//
//   node scripts/uxui-tabbar-check.mjs <base-url> [--pages /vi,...] [--sizes 360,390,402x910,408x908,440x956]
//                                      [--dprs 1,2,2.625,3] [--schemes light,dark] [--shots <dir>] [--inject <css>]
//
// For every page, size, scheme and device pixel ratio it scrolls THE SCROLLER (never the window) to the top, the middle, the
// very bottom and after fast scrolling, and checks at each stop:
//   1. the bar (the booking flow's action bar when it is there) is in the flow (not fixed or sticky for the tab bar) and its
//      top edge is the scroller's bottom edge: the scroller ends where the bar begins;
//   2. EVERY pixel row of a real screenshot from the bar's top to the bottom of the screen is the bar's colour (read back
//      through a canvas), except under a tab's own icon and label;
//   3. the document itself does not scroll (scrollHeight <= clientHeight) and nothing is wider than the screen;
//   4. at the very bottom the last element (the footer) ends above the bar, fully visible;
//   5. after scrolling 100 px the header is in its scrolled (glass) state, and back at the top it is not;
//   6. every icon and label of the bar is inside the visual viewport and keeps 4 px of air in its tab.
// Also: a focused text field on the login page hides the bar and the scroller then reaches the bottom of the screen.
// A bar edge on half a device pixel (ratio 2.625 on an odd-height screen) is a real case here: the bar is in the same layer as
// the page, so it paints the last row. Exit code 3 on any failure; needs Node 22+ and Edge or Chrome like the other gates.
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
// A size is a width (the height is 780) or WxH, e.g. 402x910, 408x908 and 440x956 (the phones of the Owner's reports).
const sizes = flag('sizes', '360,390,402x910,408x908,440x956').split(',');
const dprs = flag('dprs', '1,2,2.625,3').split(',').map(Number);
const schemes = flag('schemes', 'light,dark').split(',');
const safes = flag('safes', '0,34').split(',').map(Number);
const injected = flag('inject', '');
const shotsDir = flag('shots', '');
const [base] = args;
if (!base) {
  console.error(
    'usage: node scripts/uxui-tabbar-check.mjs <base-url> [--pages ...] [--sizes ...] [--dprs ...]',
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
let fractionalProbes = 0;
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
      const timer = setTimeout(() => reject(new Error(`no answer to ${method} in 60 s`)), 60000);
      pending.set(id, {
        resolve: (value) => (clearTimeout(timer), resolve(value)),
        reject: (error) => (clearTimeout(timer), reject(error)),
      });
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
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
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
  const metrics = (width, height, dpr) =>
    send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: dpr,
      mobile: true,
    });

  let lastShot = '';
  // One probe: geometry of the shell plus a real screenshot read back through a canvas.
  const probe = async (label) => {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    lastShot = shot.data;
    const result = await evaluate(`(async () => {
      const scroller = document.querySelector('[data-ls-scroll]');
      const tabBar = document.querySelector('.ls-tab-bar');
      const action = document.querySelector('.ls-action-bar');
      const tabShown = tabBar && getComputedStyle(tabBar).display !== 'none';
      const bar = tabShown ? tabBar : action;
      if (!scroller || !bar) return { none: true };
      const style = getComputedStyle(bar);
      const rect = bar.getBoundingClientRect();
      const sRect = scroller.getBoundingClientRect();
      const visibleBottom = Math.min(innerHeight, visualViewport.offsetTop + visualViewport.height);
      const image = new Image();
      image.src = 'data:image/png;base64,${shot.data}';
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(image, 0, 0);
      const scale = image.width / innerWidth;
      // Every pixel row from the bar's top to the bottom of the screenshot.
      const startRow = Math.max(0, Math.round(rect.top * scale) + 1);
      // A screen height that is not a whole number of device pixels (ratio 2.625 on 908 px) gives the screenshot one extra, half
      // row at the bottom, OUTSIDE the page's layout box: no element of the page paints it (a red bar, a green html and a green
      // shell all left it unchanged), so it is not counted and the run says so. A real screen has whole physical pixels.
      const device = innerHeight * devicePixelRatio;
      const fractional = Math.abs(device - Math.round(device)) > 0.01;
      const rows = Math.max(1, image.height - startRow - (fractional ? 1 : 0));
      const data = context.getImageData(0, startRow, image.width, rows).data;
      const colourAt = context.getImageData(2, Math.round((rect.top + 4) * scale), 1, 1).data;
      const contentBoxes = [];
      const outside = [];
      if (tabShown) {
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
            if (part === 'label' && box.bottom > linkRect.bottom - 3) outside.push(name + ' has less than 4px of air in its tab');
          }
        }
      } else {
        // The action bar: its buttons and text are content too.
        for (const el of bar.querySelectorAll('button, a, strong, span')) {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) contentBoxes.push(r);
        }
      }
      let bad = 0;
      let badFirst = null;
      let badColour = null;
      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < image.width; column += 3) {
          const x = column / scale;
          const y = (startRow + row) / scale;
          if (contentBoxes.some((b) => x >= b.left - 8 && x <= b.right + 8 && y >= b.top - 8 && y <= b.bottom + 8)) continue;
          const i = (row * image.width + column) * 4;
          if (Math.abs(data[i] - colourAt[0]) > 6 || Math.abs(data[i + 1] - colourAt[1]) > 6 || Math.abs(data[i + 2] - colourAt[2]) > 6) {
            bad += 1;
            if (badFirst === null) {
              badFirst = startRow + row;
              badColour = [data[i], data[i + 1], data[i + 2]];
            }
          }
        }
      }
      const root = document.scrollingElement;
      const footer = document.querySelector('.ls-site-footer');
      const atEnd = Math.ceil(scroller.scrollTop + scroller.clientHeight) >= scroller.scrollHeight - 1;
      const header = document.querySelector('.ls-site-header');
      const wide = [];
      if (scroller.scrollWidth > scroller.clientWidth + 1) wide.push('scroller ' + scroller.scrollWidth + ' wide, screen ' + scroller.clientWidth);
      return {
        tabShown,
        position: style.position,
        barTop: Math.round(rect.top * 10) / 10,
        scrollerBottom: Math.round(sRect.bottom * 10) / 10,
        screenBottom: Math.round(visibleBottom * 10) / 10,
        barBottom: Math.round(rect.bottom * 10) / 10,
        opaque: !/rgba\\(.*,\\s*0(\\.\\d+)?\\)$/.test(style.backgroundColor) && style.backgroundColor !== 'transparent',
        badPixels: bad,
        sampled: rows * Math.ceil(image.width / 3),
        fractional,
        badRows: badFirst === null ? '' : 'device rows from ' + badFirst + ' of ' + image.height + ' (bar top row ' + startRow + '), found rgb(' + badColour + '), the bar is rgb(' + [colourAt[0], colourAt[1], colourAt[2]] + ')',
        paddingBottom: style.paddingBottom,
        documentScroll: root.scrollHeight - root.clientHeight,
        scrollTop: Math.round(scroller.scrollTop),
        scrollMax: scroller.scrollHeight - scroller.clientHeight,
        atEnd,
        footerBottom: footer ? Math.round(footer.getBoundingClientRect().bottom * 10) / 10 : null,
        headerScrolled: header ? header.dataset.scrolled === 'true' : null,
        outside,
        wide,
      };
    })()`);
    return { label, ...result };
  };

  const report = (where, r, expectScrolled) => {
    if (r.none) return;
    checks += 1;
    if (r.fractional) fractionalProbes += 1;
    const problems = [];
    if (r.tabShown && !['relative', 'static'].includes(r.position))
      problems.push(`the tab bar is position ${r.position}, it must be in the flow`);
    if (Math.abs(r.barTop - r.scrollerBottom) > 0.5)
      problems.push(`the scroller ends at ${r.scrollerBottom} but the bar starts at ${r.barTop}`);
    if (Math.abs(r.barBottom - r.screenBottom) > 0.5)
      problems.push(`the bar ends at ${r.barBottom}, the screen at ${r.screenBottom}`);
    if (!r.opaque) problems.push('the bar background is not opaque');
    if (r.tabShown && safeInsets && r.paddingBottom !== `${safeNow}px`)
      problems.push(
        `the safe area is not padding inside the bar (${r.paddingBottom}, expected ${safeNow}px)`,
      );
    if (r.badPixels > 0)
      problems.push(
        `${r.badPixels} of ${r.sampled} pixels from the bar's top to the bottom of the screen are not the bar colour (${r.badRows})`,
      );
    if (r.documentScroll > 1)
      problems.push(`the document scrolls (${r.documentScroll} px): only the scroller may`);
    if (r.wide.length) problems.push(`wider than the screen: ${r.wide.join('; ')}`);
    if (r.outside.length) problems.push(`outside the screen: ${r.outside.join(', ')}`);
    if (r.atEnd && r.footerBottom !== null && r.footerBottom > r.barTop + 0.5)
      problems.push(`the footer ends at ${r.footerBottom}, under the bar (top ${r.barTop})`);
    if (
      expectScrolled !== undefined &&
      r.headerScrolled !== null &&
      r.headerScrolled !== expectScrolled
    )
      problems.push(
        `the header is ${r.headerScrolled ? 'scrolled' : 'not scrolled'} at scrollTop ${r.scrollTop}`,
      );
    if (problems.length) {
      failures += 1;
      console.log(`FAIL ${where} ${r.label}: ${problems.join('; ')}`);
    }
  };

  const slug = (path) => path.replace(/^\/vi\/?/, '').replace(/\//g, '-') || 'home';
  const scrollTo = (y) =>
    evaluate(
      `(() => { const s = document.querySelector('[data-ls-scroll]'); s.scrollTop = ${y}; return s.scrollTop; })()`,
    );

  for (const safe of safes) {
    await setSafe(safe);
    for (const scheme of schemes) {
      await send('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-color-scheme', value: scheme }],
      });
      await send('Network.setCookie', { name: 'ls-theme', value: scheme, url: base });
      for (const size of sizes) {
        const [widthText, heightText] = size.split('x');
        const width = Number(widthText);
        const height = heightText ? Number(heightText) : 780;
        for (const path of pages) {
          try {
            await metrics(width, height, 1);
            const loaded = once('Page.loadEventFired');
            await send('Page.navigate', { url: new URL(path, base).href });
            await Promise.race([loaded, sleep(30000)]);
            await sleep(1500);
            if (injected) {
              await evaluate(
                `document.head.append(Object.assign(document.createElement('style'), { textContent: ${JSON.stringify(injected)} }))`,
              );
              await sleep(200);
            }
            // The iPhone inset does not depend on the ratio: one ratio is enough for it.
            for (const dpr of safe === 0 ? dprs : [3]) {
              await metrics(width, height, dpr);
              await sleep(700);
              const where = `${path} ${width}x${height} ${scheme} safe ${safe} dpr ${dpr}`;
              const max = await evaluate(
                "document.querySelector('[data-ls-scroll]').scrollHeight - document.querySelector('[data-ls-scroll]').clientHeight",
              );
              const stops = [
                ['top', 0],
                ['scrolled 100', Math.min(100, max)],
                ['middle', Math.round(max / 2)],
                ['bottom', max],
              ];
              for (const [name, y] of stops) {
                // Go away and come back, so the stop is reached by scrolling like a visitor does.
                await scrollTo(Math.min(max, y + 40));
                await scrollTo(y);
                await sleep(450);
                const r = await probe(name);
                report(where, r, y >= 60 ? true : name === 'top' ? false : undefined);
                if (shotsDir && safe === 0 && dpr === 3) {
                  mkdirSync(shotsDir, { recursive: true });
                  writeFileSync(
                    `${shotsDir}/${slug(path)}-${width}x${height}-${scheme}-${name.replace(' ', '')}.png`,
                    Buffer.from(lastShot, 'base64'),
                  );
                }
              }
              // Fast scrolling: ten jumps, then a check at once.
              for (let step = 0; step < 10; step++)
                await scrollTo(Math.round((max * ((step * 7) % 10)) / 10));
              report(where, await probe('after fast scrolling'), undefined);
            }
          } catch (error) {
            failures += 1;
            console.log(`FAIL ${path} ${width}x${height} ${scheme} safe ${safe}: ${error.message}`);
          }
        }
        // The keyboard (a proxy: headless has none): a focused field hides the bar, the scroller then reaches the screen
        // bottom, and the field can be scrolled into view inside it.
        if (safe === 0 && scheme === schemes[0]) {
          await metrics(width, height, 3);
          const loaded = once('Page.loadEventFired');
          await send('Page.navigate', { url: new URL('/vi/account/login', base).href });
          await loaded;
          await sleep(1500);
          const found = await evaluate(`(() => {
            const field = document.querySelector('input:not([type=hidden]):not([type=checkbox])');
            if (!field) return null;
            field.focus();
            return true;
          })()`);
          if (found) {
            await metrics(width, height - 300, 3);
            await sleep(500);
            const k = await evaluate(`(() => {
              const s = document.querySelector('[data-ls-scroll]');
              const f = document.activeElement;
              f.scrollIntoView({ block: 'nearest' });
              const bar = document.querySelector('.ls-tab-bar');
              const sr = s.getBoundingClientRect();
              const fr = f.getBoundingClientRect();
              return {
                barHidden: !bar || getComputedStyle(bar).display === 'none',
                scrollerBottom: Math.round(sr.bottom),
                screen: Math.round(visualViewport.height),
                fieldInside: fr.top >= sr.top - 0.5 && fr.bottom <= sr.bottom + 0.5,
                documentScroll: document.scrollingElement.scrollHeight - document.scrollingElement.clientHeight,
              };
            })()`);
            checks += 1;
            const problems = [];
            if (!k.barHidden) problems.push('the bar stays while a field has focus');
            if (Math.abs(k.scrollerBottom - k.screen) > 1)
              problems.push(`the scroller ends at ${k.scrollerBottom}, the screen at ${k.screen}`);
            if (!k.fieldInside)
              problems.push('the focused field cannot be scrolled into the visible scroller');
            if (k.documentScroll > 1) problems.push('the document scrolls with the keyboard open');
            if (problems.length) {
              failures += 1;
              console.log(`FAIL keyboard ${width}x${height} ${scheme}: ${problems.join('; ')}`);
            }
          }
        }
      }
    }
  }
  if (fractionalProbes)
    console.log(
      `note: in ${fractionalProbes} probes the screen height was not a whole number of device pixels; the half row below the page's layout box was not counted (nothing in the page paints it)`,
    );
  console.log(
    `${checks} checks, ${failures} failed${safeInsets ? '' : ' (safe-area override unavailable in this browser)'}`,
  );
  socket.close();
} finally {
  await disposeProfile(profile, child);
}
process.exit(failures > 0 ? 3 : 0);
