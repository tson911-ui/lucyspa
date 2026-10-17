"""Hover and pressed state shots (E1, B23; redesign session 10).

For each page, picks one visible example of each control kind (primary, secondary, ghost/icon, text link, nav link, chip, tab,
segment, table row link, card link, field, checkbox, switch) and saves a crop of it at rest, under forced :hover and under forced
:hover:active (CDP, transitions off), in light and dark. Output: .local/uxui-screens/<phase>/states/<area>-<page>-<scheme>-<kind>-<state>.png
plus states.json (what changed per state, the same properties the E2 hover pass compares).

  python scripts/uxui-states.py --phase s10final --area customer --pages home,services,product-detail,login,account,cart
  python scripts/uxui-states.py --phase s10final --area staff --pages pos,employees,products,loyalty,reports-revenue
"""

import argparse
import json
import subprocess
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
KINDS = [
    ("primary", ".ls-btn-primary"),
    ("secondary", ".ls-btn-secondary"),
    ("neutral", ".ls-btn-neutral"),
    ("ghost", ".ls-btn-ghost"),
    ("link", "main a.ls-link, main .ls-prose a"),
    ("nav", ".ls-site-nav a:not([aria-current]), .ls-nav-link:not([aria-current])"),
    ("nav-current", ".ls-site-nav a[aria-current], .ls-nav-link[aria-current]"),
    ("chip", ".ls-chip, .ls-pills a"),
    ("tab", ".ls-tab:not(.ls-tab-active), .ls-subnav a:not([aria-current])"),
    ("segment", ".ls-segment:not(.ls-segment-active)"),
    ("row", ".ls-table tbody tr a, .ls-mem-row-link"),
    ("card", "main a[class*='card'], main a:not([class])"),
    ("field", "main .ls-input"),
    ("check", "main input[type=checkbox]"),
    ("switch", "main .ls-switch"),
    ("wordmark", ".ls-site-brand a, .ls-topbar-brand a"),
    ("contact", ".ls-contact-toggle"),
]
PROPS = "backgroundColor color borderColor textDecorationLine textDecorationThickness textDecorationColor transform opacity outlineStyle".split()


def cookies(key):
    if key in (None, "", "public"):
        return {}
    k = "staff" if key == "owner" else key
    out = subprocess.run(["node", ".local/s10/cookies.mjs", k], cwd=ROOT, capture_output=True, text=True, check=True).stdout
    return json.loads(out.strip().splitlines()[-1])


def pages_for(area):
    f = "uxui-customer-pages.json" if area == "customer" else "uxui-staff-pages.json"
    data = json.loads((ROOT / "scripts" / f).read_text(encoding="utf-8"))
    return {p["name"]: p for p in data["pages"]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--phase", required=True)
    ap.add_argument("--area", required=True, choices=["customer", "staff"])
    ap.add_argument("--pages", required=True)
    ap.add_argument("--web", default="http://localhost:3100")
    args = ap.parse_args()
    out = ROOT / ".local" / "uxui-screens" / args.phase / "states"
    out.mkdir(parents=True, exist_ok=True)
    catalog = pages_for(args.area)
    report = {}
    width = 1440 if args.area == "customer" else 1280
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="msedge", headless=True)
        for name in args.pages.split(","):
            spec = catalog.get(name, {"path": name, "as": "owner" if args.area == "staff" else "public"})
            path = spec.get("path") or ""
            if "{" in path:
                print("skip (record page)", name)
                continue
            url = f"{args.web}/vi/{path}" if args.area == "customer" else f"{args.web}/vi/workforce/{path}"
            for scheme in ("light", "dark"):
                ctx = browser.new_context(viewport={"width": width, "height": 900}, color_scheme=scheme)
                jar = cookies(spec.get("as"))
                if jar:
                    ctx.add_cookies([{"name": k, "value": v, "url": args.web} for k, v in jar.items()])
                page = ctx.new_page()
                page.goto(url)
                page.wait_for_load_state("networkidle")
                page.add_style_tag(content="*,*::before,*::after{transition:none!important;animation:none!important}")
                cdp = ctx.new_cdp_session(page)
                cdp.send("DOM.enable")
                cdp.send("CSS.enable")
                for kind, sel in KINDS:
                    handle = page.evaluate_handle(
                        "(sel) => [...document.querySelectorAll(sel)].find(e => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 8 && r.height > 8 && s.visibility !== 'hidden' && !e.closest('[inert],[aria-hidden=true]') && !e.matches(':disabled,[aria-disabled=true]'); }) || null",
                        sel,
                    )
                    el = handle.as_element()
                    if not el:
                        continue
                    el.scroll_into_view_if_needed()
                    page.evaluate("(e) => e.setAttribute('data-s10-state', '1')", el)
                    doc = cdp.send("DOM.getDocument", {"depth": 0})
                    node = cdp.send("DOM.querySelector", {"nodeId": doc["root"]["nodeId"], "selector": "[data-s10-state='1']"})["nodeId"]
                    box = el.bounding_box()
                    clip = {"x": max(box["x"] - 12, 0), "y": max(box["y"] - 12, 0), "width": min(box["width"] + 24, width), "height": box["height"] + 24}
                    seen = {}
                    for state, forced in (("rest", []), ("hover", ["hover"]), ("pressed", ["hover", "active"])):
                        cdp.send("CSS.forcePseudoState", {"nodeId": node, "forcedPseudoClasses": forced})
                        page.wait_for_timeout(30)
                        seen[state] = page.evaluate("([e, props]) => { const c = getComputedStyle(e); return Object.fromEntries(props.map(p => [p, c[p]])); }", [el, PROPS])
                        page.screenshot(path=str(out / f"{args.area}-{name}-{scheme}-{kind}-{state}.png"), clip=clip)
                    cdp.send("CSS.forcePseudoState", {"nodeId": node, "forcedPseudoClasses": []})
                    page.evaluate("(e) => e.removeAttribute('data-s10-state')", el)
                    diff = lambda a, b: {k: [seen[a][k], seen[b][k]] for k in PROPS if seen[a][k] != seen[b][k]}
                    report[f"{args.area}-{name}-{scheme}-{kind}"] = {"hover": diff("rest", "hover"), "pressed": diff("hover", "pressed")}
                ctx.close()
                print("ok", name, scheme)
        browser.close()
    target = out / f"states-{args.area}.json"
    previous = json.loads(target.read_text(encoding="utf-8")) if target.exists() else {}
    previous.update(report)
    target.write_text(json.dumps(previous, indent=1, ensure_ascii=False), encoding="utf-8")
    missing = [k for k, v in report.items() if not v["hover"] or not v["pressed"]]
    print("controls", len(report), "without a visible hover or pressed change:", missing)


if __name__ == "__main__":
    main()
