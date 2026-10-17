"""Session 10 capture + measurement driver (webapp-testing skill: Python Playwright, Edge channel).

E1 screenshots and E2 measurements for every customer page (scripts/uxui-customer-pages.json + the extra pages below) or every
staff route (scripts/uxui-staff-pages.json), against the running production build (web 3100, scratch API 3101).

  python scripts/uxui-capture.py --area customer --phase s10base [--pages home,cart] [--no-shots] [--modes light-1440,dark-1440]
  python scripts/uxui-capture.py --area staff --phase s10base --theme-cookie      (baseline: also set the ls-theme cookie)

Images: .local/uxui-screens/<phase>/<area>/<page>__<mode>.png   Results: .local/s10/e2/<phase>/<area>/<page>.json
Sessions come from `node .local/s10/cookies.mjs <key>` (scratch-stack seed members and the audit Owner; never in the repository).
Thresholds: docs/REDESIGN_S10_REPORT.md (E2), fixed before the baseline.
"""

import argparse
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
MEASURE = (ROOT / "scripts" / "uxui-e2-measure.js").read_text(encoding="utf-8")

CUSTOMER_EXTRA = [
    {"name": "contact", "path": "contact"},
    {"name": "policy-returns", "path": "chinh-sach-doi-tra-hoan-tien"},
    {"name": "policy-member", "path": "chinh-sach-thanh-vien-diem-thuong"},
    {"name": "policy-terms", "path": "dieu-khoan-su-dung"},
    {"name": "policy-privacy", "path": "chinh-sach-bao-mat"},
    {"name": "profile", "path": "account/profile", "as": "orders"},
    {"name": "home-en", "path": "", "lang": "en"},
]

MODES = {
    "customer": [
        ("light-390", 390, 1, "light", False),
        ("light-768", 768, 1, "light", False),
        ("light-1440", 1440, 1, "light", False),
        ("dark-390", 390, 1, "dark", False),
        ("dark-768", 768, 1, "dark", False),
        ("dark-1440", 1440, 1, "dark", False),
        ("zoom200-1440", 720, 2, "light", False),
        ("text200-1440", 1440, 1, "light", True),
    ],
    "staff": [
        ("light-1024", 1024, 1, "light", False),
        ("light-1280", 1280, 1, "light", False),
        ("light-1440", 1440, 1, "light", False),
        ("dark-1024", 1024, 1, "dark", False),
        ("dark-1280", 1280, 1, "dark", False),
        ("dark-1440", 1440, 1, "dark", False),
        ("zoom200-1280", 640, 2, "light", False),
        ("text200-1280", 1280, 1, "light", True),
    ],
}
HOVER_MODES = {"customer": {"light-1440", "dark-1440"}, "staff": {"light-1280", "dark-1280"}}

SETTLE_JS = """async () => {
  const box = document.querySelector('[data-ls-scroll]');
  const inner = box && box.scrollHeight > box.clientHeight + 1 ? box : null;
  const step = Math.max(300, innerHeight - 100);
  const total = () => (inner ? inner.scrollHeight : document.documentElement.scrollHeight);
  const to = (y) => (inner ? inner.scrollTo(0, y) : scrollTo(0, y));
  for (let y = 0; y < total(); y += step) { to(y); await new Promise((r) => setTimeout(r, 110)); }
  to(0);
  await new Promise((r) => setTimeout(r, 1200));
}"""

HEIGHT_JS = """() => { const box = document.querySelector('[data-ls-scroll]');
  const hidden = box ? Math.max(0, box.scrollHeight - box.clientHeight) : 0;
  return document.documentElement.scrollHeight + hidden; }"""

SNAP_JS = """(i) => {
  const el = document.querySelector(`[data-s10-hover="${i}"]`);
  if (!el) return null;
  const pick = (e) => { const s = getComputedStyle(e); return [s.backgroundColor, s.color, s.borderTopColor, s.borderBottomColor,
    s.textDecorationLine, s.textDecorationThickness, s.textDecorationColor, s.transform, s.opacity, s.outlineStyle + s.outlineColor, s.boxShadow, s.scale, s.translate].join('|'); };
  const kids = Array.from(el.querySelectorAll('*')).slice(0, 20);
  const s = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  return { self: pick(el), kids: kids.map(pick).join('#'), bg: s.backgroundColor, border: s.borderTopWidth + ' ' + s.borderTopStyle,
    borderColor: s.borderTopColor,
    radius: parseFloat(s.borderTopLeftRadius), h: r.height, label: (el.getAttribute('aria-label') || el.innerText || '').trim().slice(0, 40),
    tag: el.tagName.toLowerCase(), cls: (typeof el.className === 'string' ? el.className : '').slice(0, 60) };
}"""


def alpha(color):
    m = re.search(r"rgba?\(([^)]+)\)", color or "")
    if not m:
        return 0.0
    parts = [p for p in re.split(r"[\s,/]+", m.group(1)) if p]
    return float(parts[3]) if len(parts) > 3 else 1.0


_cookie_cache = {}


def session_cookies(key):
    if key in (None, "", "public"):
        return {}
    k = "staff" if key == "owner" else key
    if k not in _cookie_cache:
        out = subprocess.run(
            ["node", ".local/s10/cookies.mjs", k], cwd=ROOT, capture_output=True, text=True, check=True
        ).stdout
        _cookie_cache[k] = json.loads(out.strip().splitlines()[-1])
    return _cookie_cache[k]


def load_pages(area):
    if area == "customer":
        data = json.loads((ROOT / "scripts" / "uxui-customer-pages.json").read_text(encoding="utf-8"))
        return [dict(p, extra=False) for p in data["pages"]] + [dict(p, extra=True) for p in CUSTOMER_EXTRA]
    data = json.loads((ROOT / "scripts" / "uxui-staff-pages.json").read_text(encoding="utf-8"))
    return data["pages"]


def resolve_customer(path):
    ids = json.loads((ROOT / ".local" / "polish1" / "ids.json").read_text(encoding="utf-8"))
    path = re.sub(r"\{id:([^}]+)\}", lambda m: ids[m.group(1)], path)
    return re.sub(r"\{prod:([^}]+)\}", lambda m: ids["products"][m.group(1)]["code"], path)


def hover_pass(page, cdp, count):
    """Forces :hover and :active on each tagged target (transitions off) and records what changes."""
    page.add_style_tag(content="*,*::before,*::after{transition:none!important;animation-duration:0s!important}")
    cdp.send("DOM.enable")
    cdp.send("CSS.enable")
    root = cdp.send("DOM.getDocument", {"depth": 0})["root"]["nodeId"]
    missing_hover, missing_press, secondary_filled = [], [], []
    for i in range(count):
        found = cdp.send("DOM.querySelector", {"nodeId": root, "selector": f'[data-s10-hover="{i}"]'})
        node = found.get("nodeId")
        if not node:
            continue
        rest = page.evaluate(SNAP_JS, i)
        if not rest or rest["h"] < 1:
            continue
        cdp.send("CSS.forcePseudoState", {"nodeId": node, "forcedPseudoClasses": ["hover"]})
        hov = page.evaluate(SNAP_JS, i)
        cdp.send("CSS.forcePseudoState", {"nodeId": node, "forcedPseudoClasses": ["hover", "active"]})
        act = page.evaluate(SNAP_JS, i)
        cdp.send("CSS.forcePseudoState", {"nodeId": node, "forcedPseudoClasses": []})
        who = f'{rest["tag"]}.{rest["cls"]} "{rest["label"]}"'
        if hov["self"] == rest["self"] and hov["kids"] == rest["kids"]:
            missing_hover.append(who)
        if act["self"] == hov["self"] and act["kids"] == hov["kids"]:
            missing_press.append(who)
        pill = rest["radius"] >= 16
        bordered = (
            not rest["border"].startswith("0px") and "none" not in rest["border"] and alpha(rest["borderColor"]) >= 0.1
        )
        if pill and bordered and alpha(rest["bg"]) < 0.1 and alpha(hov["bg"]) >= 0.5:
            secondary_filled.append(f'{who} hover bg {hov["bg"]}')
    return missing_hover, missing_press, secondary_filled


def first_link(context, web, lang, spec):
    """The first record link on the list page (`list` may be several candidate list URLs, tried in order)."""
    lists = spec["list"] if isinstance(spec["list"], list) else [spec["list"]]
    link = spec["link"]
    for target in lists:
        page = context.new_page()
        page.goto(f"{web}/{lang}/workforce/{target}", wait_until="networkidle", timeout=45000)
        page.wait_for_timeout(800)
        hrefs = page.eval_on_selector_all("a[href]", "els => els.map(e => e.getAttribute('href'))")
        page.close()
        for h in hrefs:
            if link in h:
                rest = h.split(link, 1)[1].split("?")[0].split("#")[0]
                if rest and "/" not in rest and rest not in ("new", "edit"):
                    return h.split(f"/{lang}/workforce/", 1)[1].split("?")[0]
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--area", choices=["customer", "staff"], required=True)
    ap.add_argument("--phase", required=True)
    ap.add_argument("--pages", default="")
    ap.add_argument("--modes", default="")
    ap.add_argument("--web", default="http://localhost:3100")
    ap.add_argument("--no-shots", action="store_true")
    ap.add_argument("--theme-cookie", action="store_true")
    ap.add_argument("--reduced", action="store_true", help="emulate prefers-reduced-motion: reduce")
    ap.add_argument(
        "--path",
        action="append",
        default=[],
        help="name=path: open this record path for a page whose record cannot be found by link (menu-opened records)",
    )
    args = ap.parse_args()

    pages = load_pages(args.area)
    overrides = dict(item.split("=", 1) for item in args.path)
    if args.pages:
        wanted = set(args.pages.split(","))
        pages = [p for p in pages if p["name"] in wanted]
    modes = MODES[args.area]
    if args.modes:
        keep = set(args.modes.split(","))
        modes = [m for m in modes if m[0] in keep]
    shots_dir = ROOT / ".local" / "uxui-screens" / args.phase / args.area
    res_dir = ROOT / ".local" / "s10" / "e2" / args.phase / args.area
    shots_dir.mkdir(parents=True, exist_ok=True)
    res_dir.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch(channel="msedge", headless=True)
        resolved_first = {}
        for pg in pages:
            started = time.time()
            lang = pg.get("lang", "vi")
            cookies = session_cookies(pg.get("as"))
            if args.area == "customer":
                path = resolve_customer(pg["path"])
                url = f"{args.web}/{lang}/{path}"
            else:
                path = overrides.get(pg["name"], pg["path"])
                if "{first}" in path:
                    spec = dict(pg["first"])
                    # "@<page>" lists from another page's resolved record (a slip is linked from its payroll run, not a list).
                    if isinstance(spec["list"], str) and spec["list"].startswith("@"):
                        parent = next(p for p in load_pages(args.area) if p["name"] == spec["list"][1:])
                        parent_key = json.dumps(parent["first"], sort_keys=True)
                        if parent_key not in resolved_first:
                            ctx = browser.new_context(viewport={"width": 1440, "height": 900})
                            ctx.add_cookies([{"name": k, "value": v, "url": args.web} for k, v in cookies.items()])
                            resolved_first[parent_key] = first_link(ctx, args.web, lang, parent["first"])
                            ctx.close()
                        spec["list"] = resolved_first[parent_key] or parent["first"]["list"]
                    key = json.dumps(spec, sort_keys=True)
                    if key not in resolved_first:
                        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
                        ctx.add_cookies([{"name": k, "value": v, "url": args.web} for k, v in cookies.items()])
                        resolved_first[key] = first_link(ctx, args.web, lang, spec)
                        ctx.close()
                    if not resolved_first[key]:
                        result = {"page": pg["name"], "skipped": "no record to open from " + str(pg["first"]["list"])}
                        (res_dir / f"{pg['name']}.json").write_text(json.dumps(result, indent=1), encoding="utf-8")
                        print(f"SKIP {pg['name']}: no record in {pg['first']['list']}", flush=True)
                        continue
                    path = path.replace("{first}", resolved_first[key])
                url = f"{args.web}/{lang}/workforce/{path}".replace("/workforce/../", "/")
            result = {"page": pg["name"], "url": url, "area": args.area, "modes": {}}
            for name, width, dsf, scheme, text200 in modes:
                ctx = browser.new_context(
                    viewport={"width": width, "height": 900},
                    device_scale_factor=dsf,
                    color_scheme=scheme,
                    reduced_motion="reduce" if args.reduced else "no-preference",
                    is_mobile=width < 640 and args.area == "customer",
                    has_touch=width < 640 and args.area == "customer",
                    locale="vi-VN" if lang == "vi" else "en-US",
                )
                jar = [{"name": k, "value": v, "url": args.web, "httpOnly": True} for k, v in cookies.items()]
                if args.theme_cookie:
                    jar.append({"name": "ls-theme", "value": scheme, "url": args.web})
                if jar:
                    ctx.add_cookies(jar)
                page = ctx.new_page()
                errors = []
                page.on(
                    "console",
                    lambda m, e=errors: e.append(m.text[:300])
                    if m.type == "error" and not m.text.startswith("Failed to load resource")
                    else None,
                )
                page.on("pageerror", lambda x, e=errors: e.append("pageerror: " + str(x)[:300]))
                page.on(
                    "response",
                    lambda r, e=errors: e.append(f"HTTP {r.status} {r.url[:160]}") if r.status >= 400 and r.url != url else None,
                )
                status = None
                try:
                    resp = page.goto(url, wait_until="networkidle", timeout=60000)
                    status = resp.status if resp else None
                except Exception as exc:  # noqa: BLE001
                    try:
                        page.wait_for_load_state("load", timeout=15000)
                    except Exception:  # noqa: BLE001
                        pass
                    errors.append(f"navigation: {str(exc)[:200]}")
                bad = page.url.startswith("chrome-error") or (status or 0) >= 500 or ((status or 0) >= 400 and not pg.get("allowStatus"))
                text_len = page.evaluate("() => (document.body ? document.body.innerText.trim().length : 0)")
                if bad or text_len == 0:
                    result["modes"][name] = {"error": f"status {status} url {page.url} text {text_len}"}
                    print(f"FAIL {pg['name']} {name}: status {status} text {text_len}", flush=True)
                    ctx.close()
                    continue
                if text200:
                    page.add_style_tag(content="html{font-size:200%!important}")
                    page.wait_for_timeout(400)
                page.evaluate(SETTLE_JS)
                m = page.evaluate(MEASURE, {"area": args.area, "mode": scheme, "text200": text200})
                if name in HOVER_MODES[args.area]:
                    cdp = ctx.new_cdp_session(page)
                    mh, mp, sf = hover_pass(page, cdp, m["report"].get("hoverCandidates", 0))
                    for metric, items in (("hover-missing", mh), ("pressed-missing", mp), ("secondary-filled", sf)):
                        if items:
                            m["metrics"][metric] = items
                            m["summary"][metric] = len(items)
                if errors:
                    m["metrics"]["console-errors"] = errors
                    m["summary"]["console-errors"] = len(errors)
                m["status"] = status
                result["modes"][name] = m
                if not args.no_shots:
                    if name in HOVER_MODES[args.area]:
                        page.reload(wait_until="networkidle")
                        if text200:
                            page.add_style_tag(content="html{font-size:200%!important}")
                        page.evaluate(SETTLE_JS)
                    height = page.evaluate(HEIGHT_JS)
                    page.set_viewport_size({"width": width, "height": max(600, min(int(height), 6000))})
                    page.wait_for_timeout(250)
                    page.screenshot(path=str(shots_dir / f"{pg['name']}__{name}.png"))
                ctx.close()
            (res_dir / f"{pg['name']}.json").write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")
            sums = {}
            for mode in result["modes"].values():
                for k, v in (mode.get("summary") or {}).items():
                    sums[k] = sums.get(k, 0) + v
            print(f"ok {pg['name']} {round(time.time() - started)}s {json.dumps(sums)}", flush=True)
        browser.close()


if __name__ == "__main__":
    sys.exit(main())
