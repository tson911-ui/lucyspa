// UX quality gate helper (docs/UXUI_REDESIGN_DESIGN.md section 21): renders a page in a headless
// Chromium browser (Edge or Chrome) at 360, 768 and 1440 px in light plus 1440 px in dark, saves full-page
// screenshots under .local/uxui-screens/ (ignored by git) and prints an automatic audit:
// horizontal page scroll and interactive targets below the minimum size.
//
//   node scripts/uxui-screens.mjs <name> <url-or-html-file> [--widths 360,768,1440] [--wait 800] [--top 1000] [--all]
//                                   [--click <selector[@@text]> ...] [--eval <js>]
//
// `--all` also renders dark at every width. `--click` (repeatable, in order) opens a state before capturing (a menu,
// drawer, dialog or sheet): the element is the first match of the CSS selector whose text contains `text`; the
// capture is then the 900 px viewport, not the full page. `--eval` prints the value of a JS expression per render. Dark mode is the `prefers-color-scheme: dark` emulation, so pages without a `data-theme` attribute
// follow it exactly as a visitor's system would. Needs Node 22+ (global WebSocket) and no dependency.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args.splice(index, 2)[1] : fallback;
};
const widths = flag('widths', '360,768,1440').split(',').map(Number);
const clicks = [];
for (let index = args.indexOf('--click'); index >= 0; index = args.indexOf('--click')) {
  clicks.push(args.splice(index, 2)[1]);
}
const evalExpression = flag('eval', '');
const all = args.includes('--all');
if (all) args.splice(args.indexOf('--all'), 1);
const waitMs = Number(flag('wait', '800'));
const topHeight = Number(flag('top', '1000'));
const [name, target] = args;
if (!name || !target) {
  console.error(
    'usage: node scripts/uxui-screens.mjs <name> <url-or-html-file> [--widths 360,768,1440] [--wait 800] [--all]',
  );
  process.exit(2);
}
const url = /^https?:|^file:/.test(target) ? target : pathToFileURL(resolve(target)).href;

const candidates = [
  process.env.UXUI_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);
const browser = candidates.find((path) => existsSync(path));
if (!browser) {
  console.error('No Edge/Chrome found. Set UXUI_BROWSER to its path.');
  process.exit(2);
}

const outDir = resolve('.local/uxui-screens');
mkdirSync(outDir, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), 'uxui-'));
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
    '--allow-file-access-from-files',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
async function pageSocket() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((entry) => entry.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      // The browser is still starting.
    }
    await sleep(250);
  }
  throw new Error('browser did not start');
}

// Runs in the page: horizontal overflow and too-small interactive targets (inline text links exempt).
const AUDIT = `(() => {
  const min = window.innerWidth < 1024 ? 44 : 40;
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 1 && r.height > 1 && s.visibility !== 'hidden' && s.display !== 'none';
  };
  const small = [...document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=radio], [role=tab], [role=menuitem]')]
    .filter(visible)
    // Visually hidden containers (screen-reader-only table headers) are not targets for anyone's finger.
    .filter((el) => {
      for (let node = el.parentElement; node; node = node.parentElement) {
        const r = node.getBoundingClientRect();
        if (r.width <= 1 || r.height <= 1) return false;
      }
      return true;
    })
    .filter((el) => !(el.tagName === 'A' && getComputedStyle(el).display === 'inline'))
    .filter((el) => !el.closest('.skip-link'))
    .map((el) => {
      const r = el.getBoundingClientRect();
      return { tag: el.tagName.toLowerCase(), label: (el.getAttribute('aria-label') || el.textContent || el.name || '').trim().slice(0, 40), w: Math.round(r.width), h: Math.round(r.height) };
    })
    .filter((item) => item.h < min || item.w < min);
  return { overflowX: document.documentElement.scrollWidth > window.innerWidth + 1, scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth, min, small };
})()`;

let exitCode = 0;
try {
  const socket = new WebSocket(await pageSocket());
  await new Promise((done, fail) => {
    socket.onopen = done;
    socket.onerror = fail;
  });
  let counter = 0;
  const pending = new Map();
  const waiters = [];
  socket.onmessage = (message) => {
    const data = JSON.parse(message.data);
    if (data.id && pending.has(data.id)) {
      const { resolve: done, reject } = pending.get(data.id);
      pending.delete(data.id);
      if (data.error) reject(new Error(data.error.message));
      else done(data.result);
    } else if (data.method) {
      for (const waiter of [...waiters]) if (waiter.method === data.method) waiter.done();
    }
  };
  const send = (method, params = {}) =>
    new Promise((done, reject) => {
      const id = ++counter;
      pending.set(id, { resolve: done, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  const once = (method) =>
    new Promise((done) => {
      const waiter = {
        method,
        done: () => {
          waiters.splice(waiters.indexOf(waiter), 1);
          done();
        },
      };
      waiters.push(waiter);
    });

  await send('Page.enable');
  for (const scheme of ['light', 'dark']) {
    for (const width of widths) {
      // Gate matrix: light at every width, dark at the widest only (`--all` renders every combination).
      if (!all && scheme === 'dark' && width !== Math.max(...widths)) continue;
      await send('Emulation.setDeviceMetricsOverride', {
        width,
        height: 900,
        deviceScaleFactor: 1,
        mobile: width < 640,
      });
      await send('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-color-scheme', value: scheme }],
      });
      const loaded = once('Page.loadEventFired');
      await send('Page.navigate', { url });
      await loaded;
      await sleep(waitMs);
      for (const spec of clicks) {
        const [selector, text = ''] = spec.split('@@');
        // A real pointer press at the element's center (so focus and hover behave as for a visitor).
        const box = (
          await send('Runtime.evaluate', {
            expression: `(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((node) => (node.textContent || node.getAttribute('aria-label') || '').includes(${JSON.stringify(text)})); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`,
            returnByValue: true,
          })
        ).result.value;
        const clicked = box !== null;
        if (box) {
          for (const type of ['mousePressed', 'mouseReleased']) {
            await send('Input.dispatchMouseEvent', {
              type,
              x: box.x,
              y: box.y,
              button: 'left',
              clickCount: 1,
            });
          }
          await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 });
        }
        if (!clicked)
          console.log(`CHECK ${name} ${width} ${scheme}: nothing matches --click ${spec}`);
        await sleep(400);
      }
      const height =
        clicks.length > 0
          ? 900
          : (
              await send('Runtime.evaluate', {
                expression: 'document.documentElement.scrollHeight',
                returnByValue: true,
              })
            ).result.value;
      await send('Emulation.setDeviceMetricsOverride', {
        width,
        height: Math.min(Math.max(height, 600), 5000),
        deviceScaleFactor: 1,
        mobile: width < 640,
      });
      await sleep(150);
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      const file = join(outDir, `${name}-${width}-${scheme}.png`);
      writeFileSync(file, Buffer.from(shot.data, 'base64'));
      if (height > topHeight) {
        // A readable crop of the first screen-and-a-bit: full-page shots are downscaled in viewers.
        const crop = await send('Page.captureScreenshot', {
          format: 'png',
          clip: { x: 0, y: 0, width, height: topHeight, scale: 1 },
        });
        writeFileSync(
          join(outDir, `${name}-${width}-${scheme}-top.png`),
          Buffer.from(crop.data, 'base64'),
        );
      }
      const audit = (await send('Runtime.evaluate', { expression: AUDIT, returnByValue: true }))
        .result.value;
      const problems = [];
      if (audit.overflowX)
        problems.push(`horizontal scroll (${audit.scrollWidth} > ${audit.innerWidth})`);
      if (audit.small.length > 0)
        problems.push(
          `${audit.small.length} target(s) under ${audit.min}px: ${audit.small
            .slice(0, 6)
            .map((item) => `${item.tag} "${item.label}" ${item.w}x${item.h}`)
            .join('; ')}`,
        );
      if (evalExpression) {
        const value = (
          await send('Runtime.evaluate', { expression: evalExpression, returnByValue: true })
        ).result.value;
        console.log(`eval ${name} ${width} ${scheme}: ${JSON.stringify(value)}`);
      }
      console.log(
        `${problems.length ? 'CHECK' : 'ok   '} ${name} ${width} ${scheme}: ${file}${problems.length ? '\n        ' + problems.join('\n        ') : ''}`,
      );
      if (problems.length) exitCode = 1;
    }
  }
  socket.close();
} finally {
  child.kill();
  await sleep(300);
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {
    // The browser may still hold the profile; it is in the temp folder.
  }
}
process.exit(exitCode);
