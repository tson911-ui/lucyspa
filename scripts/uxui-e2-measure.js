// Session 10 E2 measurements, evaluated inside a rendered page (driver: scripts/uxui-capture.py). Thresholds are fixed in
// .local/s10/e2-thresholds.md (and docs/REDESIGN_S10_REPORT.md). Returns one JSON object; the driver adds hover/pressed results
// (they need CDP) and console errors. Call as: window.__lsE2({ area: 'customer' | 'staff', mode: 'light' | 'dark', text200 })
/* eslint-disable no-undef, @typescript-eslint/no-unused-expressions -- evaluated inside the page by the driver (page.evaluate):
   browser globals, and the file is one function expression. */
(function measure(options) {
  // ---------- colour helpers ----------
  const parse = (s) => {
    if (!s || s === 'transparent') return null;
    const m = s.match(/rgba?\(([^)]+)\)/);
    if (!m) {
      const c = s.match(/color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)/);
      if (c) return [c[1] * 255, c[2] * 255, c[3] * 255, c[4] === undefined ? 1 : +c[4]];
      return null;
    }
    const p = m[1]
      .split(/[\s,/]+/)
      .filter(Boolean)
      .map(Number);
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  };
  const over = (top, bottom) => {
    const a = top[3] + bottom[3] * (1 - top[3]);
    if (a === 0) return [0, 0, 0, 0];
    return [0, 1, 2]
      .map((i) => (top[i] * top[3] + bottom[i] * bottom[3] * (1 - top[3])) / a)
      .concat(a);
  };
  const lum = (c) => {
    const v = c.slice(0, 3).map((x) => {
      x /= 255;
      return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  };
  const ratio = (a, b) => {
    const x = lum(a);
    const y = lum(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  const hex = (c) =>
    '#' +
    c
      .slice(0, 3)
      .map((x) => Math.round(x).toString(16).padStart(2, '0'))
      .join('');
  const oklch = (c) => {
    const lin = c.slice(0, 3).map((x) => {
      x /= 255;
      return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    });
    const l = Math.cbrt(0.4122214708 * lin[0] + 0.5363325363 * lin[1] + 0.0514459929 * lin[2]);
    const m = Math.cbrt(0.2119034982 * lin[0] + 0.6806995451 * lin[1] + 0.1073969566 * lin[2]);
    const s = Math.cbrt(0.0883024619 * lin[0] + 0.2817188376 * lin[1] + 0.6299787005 * lin[2]);
    const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
    const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
    const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
    const C = Math.hypot(A, B);
    let H = (Math.atan2(B, A) * 180) / Math.PI;
    if (H < 0) H += 360;
    return { L, C, H };
  };
  const inHue = (h, from, to) => (from <= to ? h >= from && h <= to : h >= from || h <= to);
  const isPink = (c) => {
    if (!c || c[3] < 0.15) return false;
    const k = oklch(c);
    return inHue(k.H, 330, 22) && k.C >= 0.03 && k.L >= 0.62;
  };
  const isBrandHue = (c) => {
    if (!c || c[3] < 0.15) return false;
    const k = oklch(c);
    return inHue(k.H, 350, 22) && k.C >= 0.04;
  };
  // DESIGN.md 6.1 scales (gray, burgundy, danger, success, warning, info; light then dark).
  const SCALES =
    'ffffff f5f5f7 ececef e2e2e5 d2d2d7 bcbcc2 86868b 6e6e73 5e5e63 515154 3a3a3d 1d1d1f ' +
    '000000 1c1c1e 2c2c2e 3a3a3c 444447 58585b 86868b 8e8e93 98989d a1a1a6 d1d1d6 f5f5f7 ' +
    'fffcfc fcf6f6 f9eced f7e1e2 f4d5d7 f1c7c9 ebb3b7 dc949a 782b37 6a242f 60212a 521b24 ' +
    '170c0d 221012 36171a 441d22 53242a 672e35 7f3942 873742 9b424e a74c58 dcadb0 f8ddde ' +
    'fffcfb fff4f2 ffe6e2 ffd9d3 fecbc3 febbb0 fea194 ff7362 d72119 c51610 b3150f 55120c ' +
    '170c0a 240f0d 391410 4c1812 5f1b14 752019 902920 b83025 fb5a4a fe7362 ff7f6f fedbd5 ' +
    'fbfefb f2faf3 e0f4e4 cdefd5 b9e9c4 a3e1b3 86d29b 5ebc7b 287b46 216e3e 1e6b3c 12361e ' +
    '0b110c 0d1910 122718 16321f 1a3e26 224d2f 2c5f3c 377249 35794b 428557 7fd39a d5f0db ' +
    'fffcfb fff6f0 ffeadc ffdfcb fed2b5 ffc29a fdac73 ed914c a35303 974c01 8f4300 4d2809 ' +
    '150e09 1f130b 301c0e 3e2411 4f2b11 623512 7a4216 925019 a3591c b0652a ffb066 ffe1ce ' +
    'fbfdff f2f7fe e2eefd d2e5fe c1dcfe afd1fc 97c1f7 72a7eb 2b5e9d 255691 22518a 132e50 ' +
    '0b1016 0e1721 142234 1a2c44 1d3656 23436c 2b5386 3464a0 346aac 4076b9 8ebcf0 dbe9fc 1a0505';
  const ALLOWED = SCALES.split(' ').map((h) =>
    [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)),
  );
  const isRadix = (c) => {
    if (!c || c[3] === 0) return true;
    if (c[3] < 1) {
      const r = Math.round(c[0]);
      const g = Math.round(c[1]);
      const b = Math.round(c[2]);
      if ((r === 0 && g === 0 && b === 0) || (r === 255 && g === 255 && b === 255)) return true;
    }
    return ALLOWED.some(
      (a) => Math.abs(a[0] - c[0]) <= 2 && Math.abs(a[1] - c[1]) <= 2 && Math.abs(a[2] - c[2]) <= 2,
    );
  };

  // ---------- element helpers ----------
  const opts = options || {};
  const area = opts.area || 'customer';
  const minTarget = area === 'staff' ? 40 : 44;
  const W = innerWidth;
  const H = innerHeight;
  const sy = scrollY;
  const all = Array.from(document.body.querySelectorAll('*'));
  const css = new Map();
  const cs = (el) => {
    let s = css.get(el);
    if (!s) {
      s = getComputedStyle(el);
      css.set(el, s);
    }
    return s;
  };
  const SEASON = '[class*="ls-season"],[data-season-layer],.ls-particles';
  const inSeason = (el) => !!el.closest(SEASON);
  const visible = (el) => {
    const s = cs(el);
    if (s.display === 'none' || s.visibility === 'hidden' || s.visibility === 'collapse')
      return false;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    let o = 1;
    for (let p = el; p && p !== document.documentElement; p = p.parentElement) {
      const ps = cs(p);
      o *= +ps.opacity;
      if (ps.display === 'none') return false;
    }
    return o > 0.05;
  };
  const effOpacity = (el) => {
    let o = 1;
    for (let p = el; p && p !== document.documentElement; p = p.parentElement) o *= +cs(p).opacity;
    return o;
  };
  const srOnly = (el) => {
    const r = el.getBoundingClientRect();
    const s = cs(el);
    return (
      (r.width <= 1 && r.height <= 1) ||
      s.clip === 'rect(0px, 0px, 0px, 0px)' ||
      s.clipPath === 'inset(50%)'
    );
  };
  const INTERACTIVE =
    'a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=link],[role=tab],[role=menuitem],[role=option],[role=switch],[role=checkbox],[role=radio],[tabindex]:not([tabindex="-1"])';
  const CLICKABLE =
    'a,button,label,summary,select,[role=button],[role=link],[role=tab],[role=menuitem],[role=option],[role=switch],[role=checkbox],[role=radio],[aria-current]:not([aria-current=false]),[aria-selected=true],[aria-pressed=true],[aria-checked=true],[role=status],[data-status]';
  const STATUSCLASS = /badge|status|chip|tag/i;
  const isCtl = (el) =>
    el.matches(
      'input,select,textarea,button,[role=button],[role=tab],[role=switch],[role=checkbox],[role=radio],[role=option],[role=menuitem],[class*="btn"],[class*="button"],[class*="chip"],[class*="segment"],[class*="pill"],[class*="badge"],[class*="tag"]',
    );
  const ownText = (el) => {
    for (const n of el.childNodes)
      if (n.nodeType === 3 && n.textContent.trim()) return n.textContent.trim();
    return '';
  };
  const label = (el) => {
    const t = (
      el.getAttribute('aria-label') ||
      el.innerText ||
      el.getAttribute('alt') ||
      el.value ||
      ''
    ).trim();
    const id = el.id ? '#' + el.id : '';
    const cls =
      typeof el.className === 'string' && el.className
        ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
        : '';
    return `${el.tagName.toLowerCase()}${id}${cls} "${t.replace(/\s+/g, ' ').slice(0, 40)}"`;
  };
  const rectOf = (el) => {
    const r = el.getBoundingClientRect();
    return {
      x: Math.round(r.left),
      y: Math.round(r.top + sy),
      w: Math.round(r.width),
      h: Math.round(r.height),
    };
  };
  const fixedChain = (el) => {
    for (let p = el; p && p !== document.body; p = p.parentElement) {
      const pos = cs(p).position;
      if (pos === 'fixed' || pos === 'sticky') return true;
    }
    return false;
  };
  const inHScroller = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const ox = cs(p).overflowX;
      if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') return p;
    }
    return null;
  };

  const out = {
    url: location.pathname + location.search,
    area,
    mode: opts.mode,
    w: W,
    metrics: {},
    report: {},
  };
  const fail = (metric, item) => {
    (out.metrics[metric] ||= []).push(item);
  };
  const vis = all.filter((el) => visible(el));
  const visSet = new Set(vis);

  // ---------- overflow-x ----------
  const sw = document.scrollingElement.scrollWidth;
  if (sw > W + 1) {
    const offenders = vis
      .filter((el) => el.getBoundingClientRect().right > W + 1 && !inHScroller(el))
      .slice(0, 8)
      .map((el) => `${label(el)} right=${Math.round(el.getBoundingClientRect().right)}`);
    fail('overflow-x', { scrollWidth: sw, width: W, offenders });
  }

  // ---------- sticky cover ----------
  let cover = 0;
  for (const el of vis) {
    const pos = cs(el).position;
    if (pos !== 'fixed' && pos !== 'sticky') continue;
    if (el.parentElement && fixedChain(el.parentElement)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < W * 0.6) continue;
    const top = r.top <= 1 && r.top >= -1;
    const bottom = Math.abs(r.bottom - H) <= 1;
    if ((pos === 'fixed' && (top || bottom)) || (pos === 'sticky' && top))
      cover += Math.min(r.height, H);
  }
  out.report.stickyCover = Math.round((cover / H) * 100);
  if (cover / H > 0.3) fail('sticky-cover', { percent: out.report.stickyCover });

  // ---------- overlap ----------
  const interactive = vis.filter((el) => el.matches(INTERACTIVE) && !srOnly(el) && !fixedChain(el));
  const leaves = vis.filter(
    (el) => ownText(el) && !srOnly(el) && !fixedChain(el) && !el.matches(INTERACTIVE),
  );
  // Scroll layer of an element (correction made at Step 4, documented in e2-thresholds.md): 'fixed' for fixed/sticky chrome, otherwise
  // the nearest ancestor that scrolls vertically (the phone shell's page scroller, the staff sidebar's menu), else the page. Two elements
  // of different layers have no fixed position against each other (it changes as one of them scrolls), so the overlap and the 8 px gap
  // checks compare only elements of one layer. Coverage (pairs compared) is reported so a fall in the counts can be told from a fall in
  // what was measured.
  const layerCache = new Map();
  // The layer is the NEAREST of: an ancestor that scrolls vertically, or a fixed/sticky container (each is its own layer). The sidebar's
  // menu scrolls inside a sticky column: its items belong to the menu's scroll area, the collapse toggle below it to the sticky column.
  const scrollLayer = (el) => {
    if (['fixed', 'sticky'].includes(cs(el).position)) return el;
    for (
      let p = el.parentElement;
      p && p !== document.body && p !== document.documentElement;
      p = p.parentElement
    ) {
      if (layerCache.has(p)) return layerCache.get(p);
      const ps = cs(p);
      if (
        ps.overflowY === 'auto' ||
        ps.overflowY === 'scroll' ||
        ps.position === 'fixed' ||
        ps.position === 'sticky'
      ) {
        layerCache.set(p, p);
        return p;
      }
    }
    return 'page';
  };
  out.report.coverage = { overlapPairs: 0, gapPairs: 0 };
  // Carousel and marquee windows (extends the carousel clip exclusion of the frozen doc): an element inside a horizontal clip window
  // narrower than the screen (a scrolling chip row, the brand band's logo window) is compared by its part inside that window, cut
  // left and right only; the page column itself is never such a window.
  const hWindowRect = (el) => {
    const r = el.getBoundingClientRect();
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const ox = cs(p).overflowX;
      if (ox !== 'hidden' && ox !== 'clip' && ox !== 'auto' && ox !== 'scroll') continue;
      const w = p.getBoundingClientRect();
      if (w.width >= innerWidth - 1) continue;
      const left = Math.max(r.left, w.left);
      const right = Math.min(r.right, w.right);
      return { left, right: Math.max(left, right), top: r.top, bottom: r.bottom };
    }
    return r;
  };
  const overlapCheck = (list, kind) => {
    const rs = list.map((el) => hWindowRect(el));
    const layers = list.map((el) => scrollLayer(el));
    let n = 0;
    for (let i = 0; i < list.length && n < 30; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (layers[i] !== layers[j]) continue;
        out.report.coverage.overlapPairs++;
        const a = rs[i];
        const b = rs[j];
        const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (ox > 4 && oy > 4 && !list[i].contains(list[j]) && !list[j].contains(list[i])) {
          const si = inHScroller(list[i]);
          const sj = inHScroller(list[j]);
          if (
            si &&
            si === sj &&
            (a.right < si.getBoundingClientRect().left || b.right < si.getBoundingClientRect().left)
          )
            continue;
          fail('overlap', { kind, a: label(list[i]), b: label(list[j]), at: rectOf(list[i]) });
          n++;
        }
      }
    }
  };
  overlapCheck(interactive, 'interactive');
  // Coverage caps (not thresholds): a page over a cap is flagged `truncated`, so a zero there is "unmeasured", never "pass".
  const TEXT_CAP = 4000;
  out.truncated = [];
  if (leaves.length > TEXT_CAP)
    out.truncated.push(`overlap text leaves ${leaves.length} > ${TEXT_CAP}`);
  overlapCheck(leaves.slice(0, TEXT_CAP), 'text');

  // ---------- boxes, double borders, card heights ----------
  const sideOn = (s, side) =>
    parseFloat(s[`border${side}Width`]) >= 1 &&
    s[`border${side}Style`] !== 'none' &&
    (parse(s[`border${side}Color`]) || [0, 0, 0, 0])[3] >= 0.1;
  const isBox = (el) => {
    const s = cs(el);
    return ['Top', 'Right', 'Bottom', 'Left'].filter((side) => sideOn(s, side)).length >= 3;
  };
  const boxes = vis.filter((el) => !isCtl(el) && !inSeason(el) && isBox(el));
  const boxSet = new Set(boxes);
  for (const el of boxes) {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      if (boxSet.has(p)) {
        fail('double-border', { inner: label(el), outer: label(p), at: rectOf(el) });
        break;
      }
    }
  }
  const bgOf = (el) => parse(cs(el).backgroundColor);
  const isCard = (el, parent) => {
    if (boxSet.has(el)) return true;
    const rad = parseFloat(cs(el).borderTopLeftRadius);
    const b = bgOf(el);
    if (rad >= 12 && b && b[3] > 0.5) {
      const pb = bgOf(parent);
      return !pb || hex(pb) !== hex(b);
    }
    return false;
  };
  for (const parent of vis) {
    const s = cs(parent);
    const grid =
      s.display.includes('grid') ||
      (s.display.includes('flex') && s.flexWrap === 'wrap' && s.flexDirection.startsWith('row'));
    if (!grid) continue;
    const kids = Array.from(parent.children).filter((k) => visSet.has(k) && isCard(k, parent));
    if (kids.length < 2) continue;
    const rows = new Map();
    for (const k of kids) {
      const r = k.getBoundingClientRect();
      const key = [...rows.keys()].find((t) => Math.abs(t - r.top) <= 2) ?? r.top;
      (rows.get(key) || rows.set(key, []).get(key)).push(k);
    }
    for (const row of rows.values()) {
      if (row.length < 2) continue;
      const hs = row.map((k) => k.getBoundingClientRect().height);
      if (Math.max(...hs) - Math.min(...hs) > 2)
        fail('card-heights', {
          parent: label(parent),
          heights: hs.map(Math.round),
          at: rectOf(row[0]),
        });
    }
  }

  // ---------- grid-misaligned: items of one grid row whose last action (button or link) sits at a different height ----------
  for (const parent of vis) {
    const s = cs(parent);
    const grid =
      s.display.includes('grid') ||
      (s.display.includes('flex') && s.flexWrap === 'wrap' && s.flexDirection.startsWith('row'));
    if (!grid || inSeason(parent)) continue;
    const kids = Array.from(parent.children).filter((k) => visSet.has(k));
    if (kids.length < 2) continue;
    const rows = new Map();
    for (const k of kids) {
      const r = k.getBoundingClientRect();
      if (r.width < 120) continue;
      const key = [...rows.keys()].find((t) => Math.abs(t - r.top) <= 2) ?? r.top;
      (rows.get(key) || rows.set(key, []).get(key)).push(k);
    }
    for (const row of rows.values()) {
      if (row.length < 2) continue;
      const actions = row.map((k) => {
        // A card carries one to three actions; a column of many links (footer, menus) is not a card.
        const list = Array.from(k.querySelectorAll('a[href],button')).filter(
          (a) => visSet.has(a) && a !== k,
        );
        return list.length && list.length <= 3
          ? list[list.length - 1].getBoundingClientRect().top
          : null;
      });
      if (actions.some((a) => a === null)) continue;
      if (Math.max(...actions) - Math.min(...actions) > 2)
        fail('grid-misaligned', {
          parent: label(parent),
          tops: actions.map(Math.round),
          at: rectOf(row[0]),
        });
    }
  }

  // ---------- clipped text ----------
  const CAROUSEL =
    '[class*="slider"],[class*="snap"],[class*="carousel"],[class*="marquee"],[class*="brand-track"],[aria-roledescription="carousel"]';
  for (const el of vis) {
    if (el.matches('input,select,textarea') || srOnly(el) || !el.innerText || !el.innerText.trim())
      continue;
    if (el.matches(CAROUSEL) || el.closest(CAROUSEL)) continue;
    const s = cs(el);
    const clipX =
      s.overflowX === 'hidden' || s.overflowX === 'clip' || s.textOverflow === 'ellipsis';
    const clipY =
      s.overflowY === 'hidden' ||
      s.overflowY === 'clip' ||
      (s.webkitLineClamp && s.webkitLineClamp !== 'none');
    if (!clipX && !clipY) continue;
    const hScroll = inHScroller(el);
    if (hScroll && cs(hScroll).overflowX !== 'hidden' && cs(hScroll).overflowX !== 'clip') continue;
    const xCut = clipX && el.scrollWidth > el.clientWidth + 1;
    const yCut = clipY && el.scrollHeight > el.clientHeight + 1 && el.clientHeight > 0;
    if ((xCut || yCut) && el.children.length < 6)
      fail('clipped-text', { el: label(el), at: rectOf(el) });
  }

  // ---------- typography ----------
  const SIZES = [12, 14, 17, 21, 24, 28, 40, 56];
  const sizes = {};
  const weights = {};
  const textEls = vis.filter((el) => ownText(el) && !srOnly(el) && !inSeason(el));
  for (const el of textEls) {
    const s = cs(el);
    const fs = Math.round(parseFloat(s.fontSize) * 100) / 100;
    const fw = parseInt(s.fontWeight, 10);
    sizes[fs] = (sizes[fs] || 0) + 1;
    weights[fw] = (weights[fw] || 0) + 1;
    if (fw < 400) fail('font-weight', { el: label(el), weight: fw });
    if (opts.text200) continue;
    const ok =
      SIZES.some((v) => Math.abs(v - fs) <= 0.25) ||
      (fs === 16 && el.matches('input,select,textarea,option')) ||
      ((el.closest('h1,h2') || /display|title/.test(el.className)) && fs >= 32 && fs <= 56);
    if (!ok) fail('font-size', { el: label(el), size: fs });
  }
  out.report.fontSizes = sizes;
  out.report.fontWeights = weights;

  // ---------- contrast ----------
  const pageBg = parse(cs(document.body).backgroundColor) ||
    parse(cs(document.documentElement).backgroundColor) || [255, 255, 255, 1];
  const media = vis.filter((el) => {
    if (inSeason(el)) return false;
    const r = el.getBoundingClientRect();
    if (r.width * r.height < 20000) return false;
    return el.matches('img,video,picture,canvas') || /url\(/.test(cs(el).backgroundImage);
  });
  const effBg = (el) => {
    const c = el.getBoundingClientRect();
    const cx = c.left + c.width / 2;
    const cy = c.top + c.height / 2;
    const photo = media.find((m) => {
      if (m === el || m.contains(el)) return false;
      const r = m.getBoundingClientRect();
      return cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom && !el.contains(m);
    });
    const layers = [];
    let stop = null;
    for (let p = el; p; p = p.parentElement) {
      const b = parse(cs(p).backgroundColor);
      if (b && b[3] > 0) {
        layers.push([b[0], b[1], b[2], b[3] * effOpacity(p)]);
        if (b[3] >= 0.999 && effOpacity(p) >= 0.999) {
          stop = p;
          break;
        }
      }
      if (p === document.documentElement) break;
    }
    if (photo && (!stop || stop.contains(photo))) {
      // Over a photo: composite the translucent layers of the photo's container that cover the text, over white (worst case).
      let host = photo.parentElement;
      for (let i = 0; i < 3 && host && host.parentElement; i++) host = host.parentElement;
      let bg = [255, 255, 255, 1];
      const scrims = Array.from(host.querySelectorAll('*')).filter((s) => {
        if (s === el || s.contains(el) || el.contains(s)) return false;
        const b = parse(cs(s).backgroundColor);
        if (!b || b[3] === 0 || b[3] >= 0.999) return false;
        const r = s.getBoundingClientRect();
        return cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom;
      });
      for (const s of scrims) bg = over(parse(cs(s).backgroundColor), bg);
      for (let i = layers.length - 1; i >= 0; i--) bg = over(layers[i], bg);
      return { bg, photo: true };
    }
    let bg = pageBg[3] >= 1 ? pageBg : over(pageBg, [255, 255, 255, 1]);
    for (let i = layers.length - 1; i >= 0; i--) bg = over(layers[i], bg);
    return { bg, photo: false };
  };
  // A failing pair is checked again against what is really painted under the text (document.elementsFromPoint): the ancestor walk
  // misses a background drawn by a positioned sibling (the sidebar's sliding pill, a card's stretched layer). The paint stack wins.
  const scroller = document.querySelector('[data-ls-scroll]');
  const scrollBack = { x: scrollX, y: scrollY, inner: scroller ? scroller.scrollTop : 0 };
  const stackBg = (el) => {
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    const r = el.getBoundingClientRect();
    const x = r.left + Math.min(r.width / 2, 12);
    const y = r.top + r.height / 2;
    if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return null;
    const layers = [];
    // A decorative layer (a sliding pill) usually has pointer-events: none, which hides it from elementsFromPoint: turn hit-testing on
    // for every element while reading the stack.
    const probe = document.createElement('style');
    probe.textContent = '*, *::before, *::after { pointer-events: auto !important; }';
    document.head.appendChild(probe);
    const stack = document.elementsFromPoint(x, y);
    probe.remove();
    for (const s of stack) {
      if (s !== el && el.contains(s)) continue;
      if (s.matches('img,video,picture,canvas')) return 'unknown';
      const style = cs(s);
      if (style.backgroundImage && style.backgroundImage !== 'none') return 'unknown';
      // A pseudo-element painting the background of this element (a pill or a highlight drawn with ::before / ::after).
      for (const pseudo of ['::after', '::before']) {
        const ps = getComputedStyle(s, pseudo);
        const pb = ps.content !== 'none' ? parse(ps.backgroundColor) : null;
        if (pb && pb[3] >= 0.999) layers.push([pb[0], pb[1], pb[2], pb[3] * effOpacity(s)]);
      }
      if (layers.length && layers[layers.length - 1][3] >= 0.999) break;
      const b = parse(style.backgroundColor);
      if (b && b[3] > 0) {
        layers.push([b[0], b[1], b[2], b[3] * effOpacity(s)]);
        if (b[3] >= 0.999 && effOpacity(s) >= 0.999) break;
      }
    }
    let bg = [255, 255, 255, 1];
    for (let i = layers.length - 1; i >= 0; i--) bg = over(layers[i], bg);
    return bg;
  };
  const pairs = {};
  let photoTexts = 0;
  for (const el of textEls) {
    if (el.closest('[disabled],[aria-disabled=true],.is-disabled') || el.matches(':disabled'))
      continue;
    const s = cs(el);
    const fg0 = parse(s.color);
    if (!fg0) continue;
    let { bg, photo } = effBg(el);
    let fg = over([fg0[0], fg0[1], fg0[2], fg0[3] * effOpacity(el)], bg);
    let r = ratio(fg, bg);
    const fs0 = parseFloat(s.fontSize) / (opts.text200 ? 2 : 1);
    const need0 = fs0 >= 24 || (fs0 >= 18.66 && parseInt(s.fontWeight, 10) >= 600) ? 3 : 4.5;
    if (r < need0 && !photo) {
      const painted = stackBg(el);
      if (painted === 'unknown') {
        // A gradient or an image under the text: not measurable from colours; reported, never counted as a pass.
        (out.report.contrastUnmeasured ||= []).push(label(el));
        continue;
      }
      if (painted) {
        bg = painted;
        fg = over([fg0[0], fg0[1], fg0[2], fg0[3] * effOpacity(el)], bg);
        r = ratio(fg, bg);
      }
    }
    const fs = parseFloat(s.fontSize) / (opts.text200 ? 2 : 1);
    const large = fs >= 24 || (fs >= 18.66 && parseInt(s.fontWeight, 10) >= 600);
    const need = large ? 3 : 4.5;
    if (photo) photoTexts++;
    const key = `${hex(fg)} on ${hex(bg)}${photo ? ' (photo)' : ''}`;
    const p = (pairs[key] ||= { ratio: Math.round(r * 100) / 100, count: 0, minSize: fs, need });
    p.count++;
    p.minSize = Math.min(p.minSize, fs);
    p.need = Math.max(p.need, need);
    if (r < need - 0.005)
      fail('contrast', {
        el: label(el),
        fg: hex(fg),
        bg: hex(bg),
        ratio: Math.round(r * 100) / 100,
        need,
        photo,
        at: rectOf(el),
      });
  }
  for (const el of vis.filter((e) =>
    e.matches('input:not([type=checkbox]):not([type=radio]):not([type=range]),select,textarea'),
  )) {
    // A disabled field is exempt, as disabled text is above (WCAG 1.4.11 does not apply to inactive components).
    if (el.matches(':disabled') || el.closest('[aria-disabled=true]')) continue;
    const s = cs(el);
    const bc = parse(s.borderTopColor);
    if (!bc || parseFloat(s.borderTopWidth) < 1) continue;
    const { bg } = effBg(el.parentElement || el);
    const r = ratio(over(bc, bg), bg);
    if (r < 3 - 0.005)
      fail('contrast', {
        el: label(el),
        kind: 'control-border',
        fg: hex(bc),
        bg: hex(bg),
        ratio: Math.round(r * 100) / 100,
        need: 3,
      });
  }
  // The paint-stack re-check scrolled: put the page back where it was for the checks that follow.
  scrollTo(scrollBack.x, scrollBack.y);
  if (scroller) scroller.scrollTop = scrollBack.inner;
  out.report.pairs = pairs;
  out.report.photoTexts = photoTexts;

  // ---------- hit targets ----------
  const targets = vis.filter((el) => el.matches(INTERACTIVE) && !srOnly(el));
  const isInlineTextLink = (el) => {
    if (el.tagName !== 'A') return false;
    if (cs(el).display !== 'inline') return false;
    const p = el.parentElement;
    if (!p) return false;
    for (const n of p.childNodes)
      if (n.nodeType === 3 && n.textContent.trim().length > 1) return true;
    return false;
  };
  const tRects = [];
  for (const el of targets) {
    if (isInlineTextLink(el)) continue;
    if (el.closest('[inert]')) continue;
    let r = el.getBoundingClientRect();
    if (el.matches('input[type=checkbox],input[type=radio]')) {
      const lab =
        el.closest('label') ||
        (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`));
      if (lab) r = lab.getBoundingClientRect();
    }
    if (el.matches('input,select,textarea') && el.closest('label') && cs(el).opacity === '0')
      continue;
    tRects.push({ el, r });
    if (r.width < minTarget - 0.5 || r.height < minTarget - 0.5)
      fail('hit-target', {
        el: label(el),
        w: Math.round(r.width),
        h: Math.round(r.height),
        min: minTarget,
        at: rectOf(el),
      });
  }
  let gapFails = 0;
  // Only targets of one scroll layer are compared (see scrollLayer): a target in the scrolling page and one in fixed chrome (the phone tab
  // bar, a floating button) or in another scroll area have no fixed distance.
  const gapRects = tRects
    .map(({ el }) => ({ el, r: hWindowRect(el), layer: scrollLayer(el) }))
    .filter(({ r }) => r.right - r.left > 1);
  for (let i = 0; i < gapRects.length && gapFails < 20; i++) {
    for (let j = i + 1; j < gapRects.length; j++) {
      const a = gapRects[i];
      const b = gapRects[j];
      if (a.layer !== b.layer) continue;
      out.report.coverage.gapPairs++;
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const dx = Math.max(b.r.left - a.r.right, a.r.left - b.r.right);
      const dy = Math.max(b.r.top - a.r.bottom, a.r.top - b.r.bottom);
      const overlapX = dx < 0;
      const overlapY = dy < 0;
      const gap =
        overlapX && overlapY
          ? -1
          : overlapX
            ? dy
            : overlapY
              ? dx
              : Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
      if (gap >= 0 && gap < 8 && (overlapX || overlapY)) {
        fail('hit-target', {
          kind: 'gap',
          a: label(a.el),
          b: label(b.el),
          gap: Math.round(gap),
          at: rectOf(a.el),
        });
        gapFails++;
      }
    }
  }

  // ---------- token probe (Step 4 additions below): a token resolved in the scope of an element ----------
  const probeCache = new Map();
  const tokenColor = (el, prop, token) => {
    const scope = el.closest('[data-density]') || document.body;
    const key = `${prop}|${token}`;
    let perScope = probeCache.get(scope);
    if (!perScope) probeCache.set(scope, (perScope = new Map()));
    if (perScope.has(key)) return perScope.get(key);
    const probe = document.createElement('span');
    probe.style.cssText = `position:absolute;width:0;height:0;overflow:hidden;${prop}:var(${token})`;
    scope.appendChild(probe);
    const value = parse(getComputedStyle(probe)[prop === 'color' ? 'color' : 'backgroundColor']);
    probe.remove();
    perScope.set(key, value);
    return value;
  };

  // ---------- focus ring (added at Step 4 for the Owner's answer 1): the ring colour against the surface it is drawn on ----------
  // The ring is drawn outside the control (outline offset), so it sits on the parent's effective background. Need 3:1 (WCAG 2.4.13 /
  // 1.4.11). Over a photo the pair is not measurable and is skipped (reported in photoRings).
  const ringPairs = {};
  let photoRings = 0;
  for (const { el } of tRects.slice(0, 400)) {
    const ring = tokenColor(el, 'color', '--ls-focus');
    if (!ring || !el.parentElement) continue;
    const { bg, photo } = effBg(el.parentElement);
    if (photo) {
      photoRings++;
      continue;
    }
    const r = ratio(ring, bg);
    const key = `${hex(ring)} on ${hex(bg)}`;
    const p = (ringPairs[key] ||= { ratio: Math.round(r * 100) / 100, count: 0 });
    p.count++;
    if (r < 3 && p.count === 1)
      fail('focus-ring', { el: label(el), ring: hex(ring), bg: hex(bg), ratio: p.ratio });
  }
  out.report.focusRing = ringPairs;
  out.report.photoRings = photoRings;

  // ---------- filled primaries per view (added at Step 4 for the Owner's answer 2) ----------
  // A filled primary is a control painted in the primary fill (a selected state, a current menu item or a pressed toggle is not a
  // button and is not counted). The page is scrolled through in steps of half a viewport (the phone shell scrolls inside
  // [data-ls-scroll]) and, at each stop, the filled controls really on screen are counted: a bar that shows only while the page's own
  // button is out of view (the phone booking bar) is counted only where it shows. More than one at a stop fails. Run at the end of
  // the measure (it scrolls), then the page is put back. Correction made at Step 4 before any final run: the first version counted a
  // fixed bar in every window, also where the page hides it.
  const isFill = (el) => {
    if (!el.matches('a,button,[role=button],input[type=submit]')) return false;
    if (el.matches('[aria-current],[aria-selected=true],[aria-pressed=true],[aria-checked=true]'))
      return false;
    if (!visible(el) || srOnly(el)) return false;
    const fill = tokenColor(el, 'background-color', '--ls-brand-fill');
    const bg = parse(cs(el).backgroundColor);
    if (!fill || !bg || bg[3] < 0.9) return false;
    return [0, 1, 2].every((i) => Math.abs(bg[i] - fill[i]) <= 2);
  };
  const scanFills = async () => {
    const scroller = document.querySelector('[data-ls-scroll]');
    const backTo = { x: scrollX, y: scrollY, inner: scroller ? scroller.scrollTop : 0 };
    const total = Math.max(
      document.scrollingElement.scrollHeight,
      scroller ? scroller.scrollHeight : 0,
    );
    const frame = () =>
      new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const settle = () => new Promise((resolve) => setTimeout(resolve, 180));
    let worst = { n: 0, at: 0, who: [] };
    for (let y = 0; y < Math.max(total - H / 2, 1); y += H / 2) {
      if (scroller) scroller.scrollTop = y;
      else scrollTo(0, y);
      await frame();
      await settle();
      const now = [
        ...document.querySelectorAll('a,button,[role=button],input[type=submit]'),
      ].filter((el) => {
        if (!isFill(el)) return false;
        const r = el.getBoundingClientRect();
        return r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
      });
      if (now.length > worst.n)
        worst = { n: now.length, at: Math.round(y), who: now.map((el) => label(el)) };
    }
    if (scroller) scroller.scrollTop = backTo.inner;
    scrollTo(backTo.x, backTo.y);
    out.report.filledPerView = worst.n;
    if (worst.n > 1) fail('filled-per-view', worst);
  };

  // ---------- colours: pink in dark, brand text, non-radix ----------
  const colorProps = (el) => {
    const s = cs(el);
    const list = [];
    if (ownText(el)) list.push(['color', parse(s.color)]);
    list.push(['background', parse(s.backgroundColor)]);
    for (const side of ['Top', 'Right', 'Bottom', 'Left'])
      if (sideOn(s, side)) list.push(['border', parse(s[`border${side}Color`])]);
    if (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0)
      list.push(['outline', parse(s.outlineColor)]);
    if (el instanceof SVGElement) {
      if (s.fill && s.fill !== 'none') list.push(['fill', parse(s.fill)]);
      if (s.stroke && s.stroke !== 'none') list.push(['stroke', parse(s.stroke)]);
    }
    return list.filter(([, c]) => c && c[3] > 0);
  };
  const seen = new Set();
  const used = {};
  for (const el of vis) {
    if (inSeason(el) || el.matches('img,video')) continue;
    const chart = el.closest('svg[class*="chart"],[class*="chart"] svg,[data-chart]');
    for (const [prop, c] of colorProps(el)) {
      const h = hex(c) + (c[3] < 1 ? `/${Math.round(c[3] * 100)}` : '');
      used[h] = (used[h] || 0) + 1;
      const key = `${prop}|${h}|${el.tagName}`;
      if (opts.mode === 'dark' && isPink(c) && !seen.has('p' + key)) {
        seen.add('p' + key);
        fail('pink-dark', { el: label(el), prop, color: h });
      }
      if (!chart && !isRadix(c) && !seen.has('r' + key)) {
        seen.add('r' + key);
        fail('non-radix', { el: label(el), prop, color: h });
      }
    }
    if (ownText(el)) {
      const c = parse(cs(el).color);
      const clickable =
        el.closest(CLICKABLE) ||
        STATUSCLASS.test(typeof el.className === 'string' ? el.className : '') ||
        (el.parentElement && STATUSCLASS.test(el.parentElement.className || ''));
      if (isBrandHue(c) && !clickable)
        fail('brand-text', { el: label(el), color: hex(c), at: rectOf(el) });
    }
  }
  out.report.colors = used;

  // ---------- shadows, gradients, transition: all ----------
  for (const el of vis) {
    if (inSeason(el)) continue;
    const s = cs(el);
    if (s.boxShadow && s.boxShadow !== 'none')
      fail('shadow-gradient', { el: label(el), boxShadow: s.boxShadow.slice(0, 80) });
    if (s.textShadow && s.textShadow !== 'none')
      fail('shadow-gradient', { el: label(el), textShadow: s.textShadow.slice(0, 60) });
    if (/gradient\(/.test(s.backgroundImage))
      fail('shadow-gradient', { el: label(el), gradient: s.backgroundImage.slice(0, 80) });
    if (/drop-shadow/.test(s.filter))
      fail('shadow-gradient', { el: label(el), filter: s.filter.slice(0, 60) });
    const props = s.transitionProperty.split(',').map((x) => x.trim());
    const durs = s.transitionDuration.split(',').map((x) => parseFloat(x));
    props.forEach((p, i) => {
      if (p === 'all' && (durs[i % durs.length] || 0) > 0)
        fail('transition-all', { el: label(el), duration: s.transitionDuration });
    });
  }

  // ---------- candidates for the CDP hover / press pass (driver) ----------
  let n = 0;
  for (const el of targets) {
    if (
      el.matches('input:not([type=checkbox]):not([type=radio]),textarea,select') ||
      isInlineTextLink(el)
    )
      continue;
    // A disabled control shows no hover or press by design (refinement made at Step 4, like the disabled exemption of the contrast
    // checks; the baseline was measured with disabled controls included, so its hover/press counts may be slightly higher).
    if (el.matches(':disabled') || el.closest('[aria-disabled=true],fieldset[disabled]')) continue;
    // A focusable scroll region (tabindex on a list or panel) is not a control: it needs focus, not hover or press.
    if (!el.matches(INTERACTIVE.replace(',[tabindex]:not([tabindex="-1"])', ''))) continue;
    el.setAttribute('data-s10-hover', String(n++));
    if (n >= 600) {
      out.truncated.push('hover candidates capped at 600');
      break;
    }
  }
  out.report.hoverCandidates = n;
  out.report.counts = {
    elements: vis.length,
    interactive: targets.length,
    text: textEls.length,
    boxes: boxes.length,
  };
  // The filled-control scan scrolls the page, so it runs last; the summary is counted after it.
  // A scan that throws never leaves the page unmeasured: the error is recorded and the rest of the measure is kept.
  return scanFills()
    .catch((error) => {
      out.report.fillScanError = String(error && error.message ? error.message : error);
    })
    .then(() => {
      const summary = {};
      for (const [k, v] of Object.entries(out.metrics)) summary[k] = v.length;
      out.summary = summary;
      return out;
    });
});
