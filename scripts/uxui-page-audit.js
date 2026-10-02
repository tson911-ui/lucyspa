// UX quality gate DOM audit (docs/UXUI_REDESIGN_DESIGN.md section 21.4/21.5). Evaluated inside a rendered page, returns
// { title, h1, url, findings: [{ type, rule, where, detail }] }. Driven by the machine-local capture script
// (.local/uxui-audit/capture.mjs: real API + web on the scratch database lucy_spa_uxaudit_20261001) and summarized with
// scripts/uxui-audit-summary.mjs. No credentials or data live here. `rule` is the frontend rule number (FR1-FR15) of section 21.4.
/* global document, window, getComputedStyle, SVGElement, location */
(() => {
  const RULES = {
    'off-grid-spacing': 'FR1',
    'off-scale-font': 'T',
    'border-collision': 'FR3',
    'nested-border-box': 'FR3',
    'border-width-mix': 'FR3',
    'surface-style-mix': 'FR3',
    'control-height-mismatch': 'FR6',
    'control-misaligned': 'FR6',
    'toolbar-label-above': 'FR6',
    'icon-text-misaligned': 'FR6',
    'edge-left': 'FR6',
    'row-top-misaligned': 'FR2',
    'row-height-unequal': 'FR2',
    'inner-offset-mismatch': 'FR2',
    'sibling-gap-uneven': 'FR2',
    'row-height-uneven': 'FR8',
    'list-height-uneven': 'FR8',
    'unpaged-list': 'FR8',
    'orphan-action': 'FR5',
    'wrapped-label': 'FR8',
    'heading-equals-control': 'FR10',
    'edge-overflow-right': 'FR11',
    'text-clipped': 'FR11',
    'content-overflow': 'FR11',
    'page-horizontal-scroll': 'FR11',
    'small-target': 'TGT',
  };
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return (
      r.width > 1 &&
      r.height > 1 &&
      s.visibility !== 'hidden' &&
      s.display !== 'none' &&
      s.opacity !== '0'
    );
  };
  const cls = (el) =>
    typeof el.className === 'string'
      ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.')
      : '';
  const desc = (el) => el.tagName.toLowerCase() + (cls(el) ? '.' + cls(el) : '');
  const region = (el) =>
    el.closest('header, aside, nav, .ls-shell-topbar, .ls-sidebar') && !el.closest('main')
      ? 'shell'
      : 'content';
  const all = [...document.body.querySelectorAll('*')].filter(
    (el) =>
      !['SCRIPT', 'STYLE', 'PATH', 'LINE', 'CIRCLE', 'RECT', 'DEFS', 'PATTERN', 'G'].includes(
        el.tagName.toUpperCase(),
      ) &&
      !(el instanceof SVGElement && el.tagName.toLowerCase() !== 'svg') &&
      // The seasonal particle layer is decoration (aria-hidden, no pointer events) clipped by its band on purpose.
      !el.closest('.ls-fx, .ls-fx-site') &&
      vis(el),
  );
  const findings = [];
  const add = (type, where, detail) =>
    findings.push({ type, rule: RULES[type] ?? '-', where, detail });
  const px = (v) => parseFloat(v);

  // 1. Spacing off the 4 px token grid (padding, vertical margin, gap) on block-level boxes.
  const spacing = new Map();
  for (const el of all) {
    const s = getComputedStyle(el);
    if (s.display === 'inline' || el instanceof SVGElement) continue;
    const props = {
      'padding-top': s.paddingTop,
      'padding-right': s.paddingRight,
      'padding-bottom': s.paddingBottom,
      'padding-left': s.paddingLeft,
      'margin-top': s.marginTop,
      'margin-bottom': s.marginBottom,
      'row-gap': s.rowGap,
      'column-gap': s.columnGap,
    };
    for (const [name, value] of Object.entries(props)) {
      if (value === 'normal') continue;
      const n = px(value);
      if (!Number.isFinite(n) || n === 0) continue;
      if (Math.abs(n / 4 - Math.round(n / 4)) > 0.02) {
        const key = `${region(el)}|${desc(el)}|${name}|${Math.round(n * 100) / 100}px`;
        spacing.set(key, (spacing.get(key) ?? 0) + 1);
      }
    }
  }
  for (const [key, count] of spacing) {
    const [reg, d, prop, value] = key.split('|');
    add('off-grid-spacing', `${reg}:${d}`, `${prop} ${value} (x${count})`);
  }

  // 2. Font sizes off the type scale (12, 14, 16, 18, 24, 32, 40 px).
  const scale = new Set([12, 14, 16, 18, 20, 24, 28, 32, 40]);
  const fonts = new Map();
  for (const el of all) {
    if (el instanceof SVGElement) continue;
    const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!hasText) continue;
    const size = Math.round(px(getComputedStyle(el).fontSize) * 100) / 100;
    if (!scale.has(size)) {
      const key = `${region(el)}|${desc(el)}|${size}px`;
      fonts.set(key, (fonts.get(key) ?? 0) + 1);
    }
  }
  for (const [key, count] of fonts) {
    const [reg, d, size] = key.split('|');
    add('off-scale-font', `${reg}:${d}`, `font-size ${size} (x${count})`);
  }

  // 3. Bordered boxes: adjacent or overlapping borders (double lines) and differing border widths.
  const SURFACE =
    'section, article, fieldset, details, table, .wf-section, .ls-card, .ls-notice, .ls-empty, .ls-kpi, .ls-chart-frame, .wf-table-wrap, .ls-table, .ls-table-wrap, header.ls-topbar, aside.ls-sidebar, .ls-auth-card';
  const bw = (s, side) =>
    s['border' + side + 'Style'] !== 'none' ? px(s['border' + side + 'Width']) : 0;
  const bordered = all.filter((el) => {
    if (el instanceof SVGElement) return false;
    const s = getComputedStyle(el);
    return (
      ['Top', 'Right', 'Bottom', 'Left'].some((side) => bw(s, side) > 0) &&
      s.display !== 'inline' &&
      !['TD', 'TH', 'TR', 'OPTION'].includes(el.tagName)
    );
  });
  const rects = bordered.map((el) => ({
    el,
    r: el.getBoundingClientRect(),
    s: getComputedStyle(el),
  }));
  const pairs = new Set();
  const surfaces = rects.filter(
    ({ el, r }) => el.matches(SURFACE) && r.width >= 120 && r.height >= 40,
  );
  for (let i = 0; i < surfaces.length; i += 1) {
    for (let j = i + 1; j < surfaces.length; j += 1) {
      const a = surfaces[i];
      const b = surfaces[j];
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const overlapX = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
      const overlapY = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
      let kind = null;
      if (overlapX > 1.5 && overlapY > 1.5) kind = 'overlapping';
      else if (
        overlapY > 8 &&
        ((Math.abs(a.r.right - b.r.left) <= 2 && bw(a.s, 'Right') > 0 && bw(b.s, 'Left') > 0) ||
          (Math.abs(b.r.right - a.r.left) <= 2 && bw(b.s, 'Right') > 0 && bw(a.s, 'Left') > 0))
      )
        kind = 'touching side by side';
      else if (
        overlapX > 8 &&
        ((Math.abs(a.r.bottom - b.r.top) <= 2 && bw(a.s, 'Bottom') > 0 && bw(b.s, 'Top') > 0) ||
          (Math.abs(b.r.bottom - a.r.top) <= 2 && bw(b.s, 'Bottom') > 0 && bw(a.s, 'Top') > 0))
      )
        kind = 'touching stacked';
      if (kind) {
        const key = desc(a.el) + ' | ' + desc(b.el) + ' | ' + kind;
        if (!pairs.has(key)) {
          pairs.add(key);
          add(
            'border-collision',
            region(a.el) + ':' + desc(a.el) + ' vs ' + desc(b.el),
            kind + ' borders (double or uneven line)',
          );
        }
      }
    }
  }
  // Nested surfaces: a bordered box inside a bordered card (box in a box) with both borders visible.
  const nested = new Map();
  for (const { el, r } of surfaces) {
    const parent = el.parentElement && el.parentElement.closest(SURFACE);
    if (!parent || !bordered.includes(parent)) continue;
    const pr = parent.getBoundingClientRect();
    if (r.width < 120 || pr.width - r.width > 80) continue;
    const key = desc(parent) + ' > ' + desc(el);
    nested.set(key, (nested.get(key) ?? 0) + 1);
  }
  for (const [key, count] of nested)
    add('nested-border-box', key.split(' > ')[0], key + ' (x' + count + '): box inside a box');
  const widths = new Map();
  for (const { el } of rects) {
    const s = getComputedStyle(el);
    for (const side of ['Top', 'Left']) {
      const w = px(s[`border${side}Width`]);
      if (w > 0) widths.set(w, (widths.get(w) ?? 0) + 1);
    }
  }
  if ([...widths.keys()].filter((w) => w >= 0.5).length > 1)
    add(
      'border-width-mix',
      'page',
      `border widths in use: ${[...widths].map(([w, n]) => `${w}px x${n}`).join(', ')}`,
    );
  const styles = new Map();
  for (const { el } of rects) {
    const s = getComputedStyle(el);
    if (px(s.borderTopLeftRadius) === 0 && !s.boxShadow) continue;
    // Docked shell chrome runs edge to edge with one border toward the content; it is not a content surface.
    if (el.matches('aside.ls-sidebar, header.ls-topbar')) continue;
    if (s.backgroundColor === 'rgba(0, 0, 0, 0)') continue;
    const r = el.getBoundingClientRect();
    if (r.width < 160 || r.height < 60) continue;
    const key = `r${px(s.borderTopLeftRadius)} b${px(s.borderTopWidth)} ${s.boxShadow === 'none' ? 'no-shadow' : 'shadow'}`;
    styles.set(key, (styles.get(key) ?? []).concat(desc(el)));
  }
  if (styles.size > 1)
    add(
      'surface-style-mix',
      'page',
      [...styles]
        .map(([k, list]) => `${k}: ${[...new Set(list)].slice(0, 4).join(', ')} (x${list.length})`)
        .join(' || '),
    );

  // 4. Controls in the same row: equal heights and centered on one line.
  const isControl = (el) =>
    el.matches(
      'button, input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, a.ls-btn, a.wf-button, .ls-segmented, [role=combobox]',
    );
  for (const parent of all) {
    const s = getComputedStyle(parent);
    if (!/flex|grid/.test(s.display)) continue;
    const kids = [...parent.children].filter((el) => vis(el) && isControl(el));
    if (kids.length < 2) continue;
    const boxes = kids.map((el) => el.getBoundingClientRect());
    const rows = [];
    boxes.forEach((r, i) => {
      const row = rows.find(
        (g) => Math.abs(g.center - (r.top + r.bottom) / 2) < Math.max(r.height, g.h) * 0.75,
      );
      if (row) row.items.push(i);
      else rows.push({ center: (r.top + r.bottom) / 2, h: r.height, items: [i] });
    });
    for (const row of rows) {
      if (row.items.length < 2) continue;
      const hs = row.items.map((i) => Math.round(boxes[i].height * 10) / 10);
      const cs = row.items.map((i) => (boxes[i].top + boxes[i].bottom) / 2);
      if (Math.max(...hs) - Math.min(...hs) > 1.5)
        add(
          'control-height-mismatch',
          `${region(parent)}:${desc(parent)}`,
          `heights ${hs.join('/')} px (${row.items.map((i) => (kids[i].textContent || kids[i].name || kids[i].tagName).trim().slice(0, 14)).join(' | ')})`,
        );
      else if (Math.max(...cs) - Math.min(...cs) > 2)
        add(
          'control-misaligned',
          `${region(parent)}:${desc(parent)}`,
          `centers differ by ${(Math.max(...cs) - Math.min(...cs)).toFixed(1)} px`,
        );
    }
  }

  // 4b. Sibling cards in one row: same top, same height, headings and big numbers at the same offset.
  const CARD = 'section, article, .wf-section, .ls-card, .ls-kpi, .ls-chart-frame';
  for (const parent of all) {
    const kids = [...parent.children]
      .filter(vis)
      .map((el) => (el.matches(CARD) ? el : el.tagName === 'LI' ? el.querySelector(CARD) : null))
      .filter((el) => el && vis(el));
    if (kids.length < 2) continue;
    const boxes = kids.map((el) => el.getBoundingClientRect());
    const used = new Set();
    boxes.forEach((r, i) => {
      if (used.has(i)) return;
      const row = boxes
        .map((q, k) => [q, k])
        .filter(
          ([q]) =>
            Math.min(q.bottom, r.bottom) - Math.max(q.top, r.top) >
              Math.min(q.height, r.height) * 0.5 && Math.abs(q.left - r.left) > 4,
        );
      if (row.length === 0) return;
      const idx = [i, ...row.map(([, k]) => k)];
      idx.forEach((k) => used.add(k));
      const tops = idx.map((k) => boxes[k].top);
      const hs = idx.map((k) => Math.round(boxes[k].height));
      if (Math.max(...tops) - Math.min(...tops) > 1.5)
        add(
          'row-top-misaligned',
          region(parent) + ':' + desc(parent),
          'card tops differ by ' + (Math.max(...tops) - Math.min(...tops)).toFixed(1) + ' px',
        );
      if (Math.max(...hs) - Math.min(...hs) > 1.5)
        add(
          'row-height-unequal',
          region(parent) + ':' + desc(parent),
          'card heights ' + hs.join('/') + ' px in one row',
        );
      for (const sel of ['h1, h2, h3', '.ls-stat-value', '.ls-kpi-value']) {
        const offs = idx
          .map((k) => {
            const t = kids[k].querySelector(sel);
            return t ? t.getBoundingClientRect().top - boxes[k].top : null;
          })
          .filter((v) => v !== null);
        if (offs.length > 1 && Math.max(...offs) - Math.min(...offs) > 2)
          add(
            'inner-offset-mismatch',
            region(parent) + ':' + desc(parent),
            sel + ' sits at ' + offs.map((v) => Math.round(v)).join('/') + ' px from the card top',
          );
      }
    });
  }

  // 5. Table rows and repeated blocks: uniform heights.
  for (const table of document.querySelectorAll('table')) {
    if (!vis(table)) continue;
    const hs = [...table.querySelectorAll('tbody tr')]
      .filter(vis)
      .map((tr) => Math.round(tr.getBoundingClientRect().height));
    if (hs.length > 1) {
      const distinct = [...new Set(hs)];
      if (Math.max(...hs) - Math.min(...hs) > 2)
        add(
          'row-height-uneven',
          `table ${cls(table)}`,
          `row heights ${Math.min(...hs)}-${Math.max(...hs)} px over ${hs.length} rows (${distinct.length} distinct)`,
        );
    }
  }
  for (const list of document.querySelectorAll('ul, ol')) {
    const items = [...list.children].filter(vis);
    if (items.length < 3) continue;
    const hs = items.map((li) => Math.round(li.getBoundingClientRect().height));
    if (Math.max(...hs) - Math.min(...hs) > 6 && items.every((li) => li.tagName === 'LI'))
      add(
        'list-height-uneven',
        `${region(list)}:${desc(list)}`,
        `item heights ${Math.min(...hs)}-${Math.max(...hs)} px over ${items.length} items`,
      );
  }

  // 6. Icon and text on one line in buttons, links, menu items.
  for (const el of all) {
    if (!el.matches('button, a, [role=tab], [role=menuitem], label')) continue;
    const svg = el.querySelector(':scope > svg');
    if (!svg) continue;
    const textNode = [...el.querySelectorAll('*')]
      .concat(el)
      .flatMap((n) => [...n.childNodes])
      .find((n) => n.nodeType === 3 && n.textContent.trim());
    if (!textNode) continue;
    // Visually hidden text (the phone Filter button keeps its word for screen readers only) is not on the line.
    const holder = textNode.parentElement?.getBoundingClientRect();
    if (holder && holder.width <= 2 && holder.height <= 2) continue;
    const range = document.createRange();
    range.selectNodeContents(textNode);
    const tr = range.getBoundingClientRect();
    const sr = svg.getBoundingClientRect();
    if (tr.height === 0 || tr.width < 4 || (region(el) === 'shell' && window.innerWidth < 1024))
      continue;
    const dy = Math.abs((tr.top + tr.bottom) / 2 - (sr.top + sr.bottom) / 2);
    if (dy > 2.5 && tr.height < 40)
      add(
        'icon-text-misaligned',
        `${region(el)}:${desc(el)}`,
        `icon center ${dy.toFixed(1)} px off the text center ("${textNode.textContent.trim().slice(0, 24)}")`,
      );
  }

  // 7. Edges: children of the page column should share one left and one right edge.
  const main = document.querySelector('main');
  if (main) {
    const cr = main.getBoundingClientRect();
    const pad = getComputedStyle(main);
    const left = cr.left + px(pad.paddingLeft);
    const right = cr.right - px(pad.paddingRight);
    const top = [...main.children]
      .filter(vis)
      .flatMap((el) =>
        el.children.length === 1 && getComputedStyle(el).display === 'block'
          ? [...el.children]
          : [el],
      );
    for (const el of top) {
      const r = el.getBoundingClientRect();
      if (el.matches('.ls-visually-hidden, [aria-live]')) continue;
      if (Math.abs(r.left - left) > 1.5)
        add(
          'edge-left',
          `content:${desc(el)}`,
          `left ${r.left.toFixed(1)} vs column ${left.toFixed(1)}`,
        );
      if (r.right - right > 1.5)
        add(
          'edge-overflow-right',
          `content:${desc(el)}`,
          `right ${r.right.toFixed(1)} beyond column ${right.toFixed(1)}`,
        );
    }
  }

  // 8. Clipped or overflowing text and horizontal page scroll.
  for (const el of all) {
    if (el instanceof SVGElement || ['HTML', 'BODY'].includes(el.tagName)) continue;
    const s = getComputedStyle(el);
    if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) {
      // Rule 7: a value clamped on purpose (ellipsis or line clamp) whose title repeats its whole text is the pattern, not a defect.
      const clamped =
        s.textOverflow === 'ellipsis' || (s.webkitLineClamp && s.webkitLineClamp !== 'none');
      const squash = (text) => (text || '').replace(/[\s\xa0]+/g, ' ').trim();
      const full = squash(el.textContent);
      if (
        clamped &&
        full &&
        [el.closest('[title]'), ...el.querySelectorAll('[title]')].some(
          (holder) => holder && squash(holder.getAttribute('title')) === full,
        )
      )
        continue;
      if (s.overflowX === 'hidden' || s.textOverflow === 'ellipsis')
        add(
          'text-clipped',
          `${region(el)}:${desc(el)}`,
          `"${(el.textContent || '').trim().slice(0, 40)}" (${el.scrollWidth} > ${el.clientWidth})`,
        );
      // The sticky phone form bar bleeds into the page gutter on purpose (one gutter, still inside the viewport).
      else if (el.querySelector('.ls-form-actions') && el.scrollWidth - el.clientWidth <= 17)
        continue;
      // Season art hangs outside its anchor on purpose (aria-hidden, no pointer events): a lantern's blossom, the logo accent.
      else if (el.querySelector(':scope > .ls-art, .ls-art-logo-art')) continue;
      else if (s.overflowX === 'visible' && !el.closest('[style*="overflow"], .ls-table-scroll'))
        add(
          'content-overflow',
          `${region(el)}:${desc(el)}`,
          `content ${el.scrollWidth} wider than box ${el.clientWidth}`,
        );
    }
  }
  if (document.documentElement.scrollWidth > window.innerWidth + 1)
    add(
      'page-horizontal-scroll',
      'page',
      `${document.documentElement.scrollWidth} > ${window.innerWidth}`,
    );

  // 9. Touch targets.
  const min = window.innerWidth < 1024 ? 44 : 40;
  const small = all
    .filter((el) =>
      el.matches(
        'a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=radio], [role=tab], [role=menuitem]',
      ),
    )
    .filter((el) => !(el.tagName === 'A' && getComputedStyle(el).display === 'inline'))
    .filter((el) => !el.closest('.skip-link'))
    .filter((el) => {
      // A kit CheckField is a row-wide target: the whole label toggles, so the row is measured, not the 20 px box (design contract 21.4 FR9).
      const row = el.closest('.ls-check-field');
      if (row) {
        const b = row.getBoundingClientRect();
        return b.height < min - 0.5 || b.width < min - 0.5;
      }
      const r = el.getBoundingClientRect();
      return r.height < min - 0.5 || r.width < min - 0.5;
    });
  const smallGroups = new Map();
  for (const el of small) {
    const r = el.getBoundingClientRect();
    const key = `${region(el)}:${desc(el)} ${Math.round(r.width)}x${Math.round(r.height)}`;
    smallGroups.set(key, (smallGroups.get(key) ?? 0) + 1);
  }
  for (const [key, count] of smallGroups) add('small-target', key, `under ${min}px (x${count})`);

  // 10. Checks added by Step 7.5a (rules FR2, FR5, FR6, FR8, FR10 of section 21.4). Content region only.
  const scope = document.querySelector('main') ?? document.body;
  const norm = (text) =>
    (text || '')
      .toLowerCase()
      .replace(/[\s\u00a0]+/g, ' ')
      .replace(/[….]+$/, '')
      .trim();
  const inDialog = (el) => el.closest('[role=dialog], dialog, .ls-dialog, .ls-drawer');

  // 10a. FR8: a list with more than 20 visible rows/items needs a pagination control nearby.
  const hasPager = (el) => {
    let node = el;
    for (let level = 0; level < 4 && node.parentElement; level += 1) {
      node = node.parentElement;
      if (
        node.querySelector(
          '.ls-pagination, .ls-pagination-nav, nav[aria-label*="phân trang" i], nav[aria-label*="pagination" i]',
        )
      )
        return true;
      if (node === scope) break;
    }
    return false;
  };
  for (const table of scope.querySelectorAll('table')) {
    if (!vis(table)) continue;
    const rows = [...table.querySelectorAll('tbody tr')].filter(vis).length;
    if (rows > 20 && !hasPager(table))
      add('unpaged-list', `table ${cls(table)}`, `${rows} rows, no pagination`);
  }
  for (const list of scope.querySelectorAll('ul, ol')) {
    if (!vis(list) || list.closest('nav, [role=menu], [role=listbox], [role=tablist]')) continue;
    const items = [...list.children].filter((li) => li.tagName === 'LI' && vis(li)).length;
    if (items > 20 && !hasPager(list))
      add('unpaged-list', `${desc(list)}`, `${items} items, no pagination`);
  }

  // 10b. FR2: consecutive siblings of one vertical stack keep the same gap.
  for (const parent of scope.querySelectorAll('*')) {
    if (
      parent instanceof SVGElement ||
      ['TABLE', 'THEAD', 'TBODY', 'TR', 'SELECT', 'UL', 'OL', 'DL'].includes(parent.tagName) ||
      !vis(parent)
    )
      continue;
    const ps = getComputedStyle(parent);
    if (!/block|flex|grid|flow-root/.test(ps.display) || ps.display.includes('inline')) continue;
    const kids = [...parent.children].filter(
      (el) =>
        vis(el) &&
        !(el instanceof SVGElement) &&
        !['absolute', 'fixed'].includes(getComputedStyle(el).position),
    );
    if (kids.length < 3) continue;
    const boxes = kids.map((el) => el.getBoundingClientRect());
    if (!boxes.every((r, i) => i === 0 || r.top >= boxes[i - 1].bottom - 0.5)) continue;
    const gaps = boxes.slice(1).map((r, i) => Math.round((r.top - boxes[i].bottom) * 2) / 2);
    if (Math.max(...gaps) - Math.min(...gaps) > 1.5)
      add(
        'sibling-gap-uneven',
        `${region(parent)}:${desc(parent)}`,
        `gaps ${gaps.join('/')} px between ${kids.length} children`,
      );
  }

  // 10c. FR10: a heading repeated by a control in the same container (for example a card titled like its only link).
  for (const heading of scope.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
    if (!vis(heading) || inDialog(heading)) continue;
    const box =
      heading.parentElement &&
      heading.parentElement.closest('section, article, form, details, .ls-card, .wf-section');
    if (!box) continue;
    const text = norm(heading.textContent);
    if (!text) continue;
    const controls = [...box.querySelectorAll('button, a[href], summary, [role=button]')].filter(
      (el) => vis(el) && !heading.contains(el),
    );
    const same = controls.find((el) => norm(el.textContent) === text);
    if (same && controls.length <= 3)
      add(
        'heading-equals-control',
        `${region(heading)}:${desc(box)}`,
        `heading "${text.slice(0, 40)}" repeated by ${desc(same)} (${controls.length} control(s) in the container)`,
      );
  }

  // 10d. FR5: a button alone in its row (or a row of only buttons) outside the places actions belong. Heuristic: review each hit.
  const ACTION_PLACES =
    'form, [role=dialog], dialog, header, nav, aside, li, td, th, tr, [role=toolbar], [role=menu], [role=tablist], .ls-toolbar, .ls-toolbar-row, .ls-toolbar-actions, .ls-card-header, .ls-list-section-head, .wf-section-header, .wf-page-header, .wf-page-actions, .ls-page-header, .ls-row-actions, .wf-row-actions, .wf-form-actions, .ls-action-bar, .ls-dialog, .ls-drawer, .ls-notice, .ls-empty, .wf-empty, .ls-pagination, .ls-stat, .ls-kpi, .ls-widget, .ls-auth-card, .ls-segmented, .ls-table-state';
  const seenRows = new Set();
  for (const button of scope.querySelectorAll('button, a.ls-btn, a.wf-button')) {
    if (!vis(button) || button.closest(ACTION_PLACES) || button.closest('summary')) continue;
    const row = button.parentElement;
    if (!row || seenRows.has(row)) continue;
    const kids = [...row.children].filter(vis);
    const rowText = norm(
      [...row.childNodes]
        .filter((n) => n.nodeType === 3)
        .map((n) => n.textContent)
        .join(' '),
    );
    const onlyButtons =
      kids.length > 0 && kids.every((el) => el.matches('button, a.ls-btn, a.wf-button'));
    if (onlyButtons && !rowText) {
      seenRows.add(row);
      add(
        'orphan-action',
        `${region(button)}:${desc(row)}`,
        `${kids.length} action(s) alone in a row outside header/toolbar/card header/footer ("${norm(button.textContent).slice(0, 24)}")`,
      );
    }
  }

  // 10d2. FR5: page-header actions belong on the right of the title block on desktop; below it they read as a stray button.
  if (window.innerWidth >= 1024) {
    for (const header of scope.querySelectorAll('.wf-page-header, .ls-page-header')) {
      const actions = header.querySelector(':scope > .wf-page-actions, :scope > .ls-page-actions');
      const titleBlock = header.firstElementChild;
      if (!actions || !titleBlock || actions === titleBlock || !vis(actions) || !vis(titleBlock))
        continue;
      if (actions.getBoundingClientRect().top >= titleBlock.getBoundingClientRect().bottom - 1) {
        add(
          'orphan-action',
          `${region(header)}:${desc(header)}`,
          `header actions sit under the title block, not on its right ("${norm(actions.textContent).slice(0, 24)}")`,
        );
      }
    }
  }

  // 10e. FR6: toolbar and filter-bar controls carry no label above them (placeholder + aria-label instead).
  const seenLabels = new Set();
  for (const bar of scope.querySelectorAll(
    '.ls-toolbar, .ls-toolbar-row, .ls-toolbar-filters, .wf-filters',
  )) {
    if (!vis(bar)) continue;
    const labelled = [...bar.querySelectorAll('label')].filter((label) => {
      if (seenLabels.has(label)) return false;
      seenLabels.add(label);
      if (!vis(label) || label.closest('.ls-visually-hidden')) return false;
      const control =
        label.control ?? label.parentElement?.querySelector('input, select, textarea');
      return (
        control && label.getBoundingClientRect().bottom <= control.getBoundingClientRect().top + 1
      );
    });
    if (labelled.length)
      add(
        'toolbar-label-above',
        `${region(bar)}:${desc(bar)}`,
        `${labelled.length} control(s) with a label above ("${norm(labelled[0].textContent).slice(0, 24)}")`,
      );
  }

  // 10f. FR8: badge, button, tab and column header labels stay on one line.
  const wrapped = new Map();
  for (const el of scope.querySelectorAll(
    '.ls-badge, button, a.ls-btn, a.wf-button, [role=tab], th',
  )) {
    if (!vis(el) || inDialog(el)) continue;
    // The phone card list hides the header row visually (clip-path) but keeps it for assistive technology.
    const header = el.closest('thead');
    if (header && getComputedStyle(header).clipPath !== 'none') continue;
    // Two lines differ by a line height (at least 16 px); a bordered pill inside a button differs by only a few px.
    // Visually hidden text (a phone icon button keeps its word for screen readers) is not on a line.
    const tops = [];
    const walker = document.createTreeWalker(el, 4);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const holder = node.parentElement?.getBoundingClientRect();
      if (!node.textContent.trim() || (holder && holder.width <= 2 && holder.height <= 2)) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const r of range.getClientRects()) if (r.width > 2) tops.push(r.top);
    }
    if (tops.length > 1 && Math.max(...tops) - Math.min(...tops) >= 10) {
      const key = `${desc(el)}|${norm(el.textContent).slice(0, 28)}`;
      wrapped.set(key, (wrapped.get(key) ?? 0) + 1);
    }
  }
  for (const [key, count] of wrapped)
    add(
      'wrapped-label',
      key.split('|')[0],
      `"${key.split('|')[1]}" wraps onto 2+ lines (x${count})`,
    );

  return {
    title: document.title,
    h1: document.querySelector('h1')?.textContent?.trim() ?? '',
    url: location.pathname,
    findings,
  };
})();
