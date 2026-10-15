"""G8 motion evidence (session 10): per page, every animation that runs from load through a scroll to the bottom and back, in three modes:
full (no preference), reduced (prefers-reduced-motion: reduce) and off (the `ls-fx=off` cookie). Reduced and off must be 0.

  python scripts/uxui-motion-probe.py --area customer|staff --phase s10f [--pages a,b] [--frames home]

Counted: GSAP tweens created through the kit wrapper (window.__lsMotionLog, recorded only because this driver sets window.__lsMotionProbe)
and CSS animations / transitions / Web Animations seen by document.getAnimations() while the page loads and scrolls (sampled every 50 ms).
Staff: any tween or animation longer than 200 ms is a failure (Owner G5). `--frames` saves a frame sequence of the first 900 ms for the
named pages (the main moment). Output: .local/s10/motion/<phase>/<area>.json and frames under .local/uxui-screens/<phase>/motion/.
"""

import argparse
import json
import re
import subprocess
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent

PROBE_INIT = "window.__lsMotionProbe = true; window.__lsMotionLog = [];"

SAMPLER = """() => {
  window.__lsAnimSeen = new Map();
  const take = () => {
    for (const a of document.getAnimations()) {
      const t = a.effect && a.effect.target;
      const name = a.animationName || a.transitionProperty || (a.id || 'waapi');
      const timing = a.effect ? a.effect.getComputedTiming() : {};
      const el = t ? (t.tagName ? t.tagName.toLowerCase() : 'pseudo') + (t.className && typeof t.className === 'string' ? '.' + t.className.trim().split(/\\s+/).slice(0, 2).join('.') : '') : '?';
      const key = el + '|' + name;
      if (!window.__lsAnimSeen.has(key))
        window.__lsAnimSeen.set(key, { el, name, kind: a.constructor.name, duration: Number.isFinite(timing.duration) ? timing.duration : String(timing.duration), iterations: Number.isFinite(timing.iterations) ? timing.iterations : String(timing.iterations) });
    }
  };
  take();
  window.__lsAnimTimer = setInterval(take, 50);
}"""

SCROLL = """async () => {
  const box = document.querySelector('[data-ls-scroll]');
  const inner = box && box.scrollHeight > box.clientHeight + 1 ? box : null;
  const step = Math.max(300, innerHeight - 100);
  const total = () => (inner ? inner.scrollHeight : document.documentElement.scrollHeight);
  const to = (y) => (inner ? inner.scrollTo(0, y) : scrollTo(0, y));
  for (let y = 0; y < total(); y += step) { to(y); await new Promise((r) => setTimeout(r, 160)); }
  to(0);
  await new Promise((r) => setTimeout(r, 900));
  clearInterval(window.__lsAnimTimer);
  return { tweens: window.__lsMotionLog || [], animations: [...window.__lsAnimSeen.values()] };
}"""


def cookies_for(key):
    if key in (None, "", "public"):
        return {}
    k = "staff" if key == "owner" else key
    out = subprocess.run(["node", ".local/s10/cookies.mjs", k], cwd=ROOT, capture_output=True, text=True, check=True).stdout
    return json.loads(out.strip().splitlines()[-1])


def pages_for(area):
    sys.path.insert(0, str(ROOT / "scripts"))
    import importlib.util

    spec = importlib.util.spec_from_file_location("cap", ROOT / "scripts" / "uxui-capture.py")
    cap = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(cap)
    return cap, cap.load_pages(area)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--area", choices=["customer", "staff"], required=True)
    ap.add_argument("--phase", required=True)
    ap.add_argument("--pages", default="")
    ap.add_argument("--frames", default="")
    ap.add_argument("--web", default="http://localhost:3100")
    args = ap.parse_args()
    cap, pages = pages_for(args.area)
    if args.pages:
        keep = set(args.pages.split(","))
        pages = [p for p in pages if p["name"] in keep]
    frames_for = set(filter(None, args.frames.split(",")))
    out_dir = ROOT / ".local" / "s10" / "motion" / args.phase
    out_dir.mkdir(parents=True, exist_ok=True)
    frame_dir = ROOT / ".local" / "uxui-screens" / args.phase / "motion"
    frame_dir.mkdir(parents=True, exist_ok=True)
    width = 1440 if args.area == "customer" else 1280
    results = {}
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="msedge", headless=True)
        resolved = {}
        for pg in pages:
            lang = pg.get("lang", "vi")
            jar = cookies_for(pg.get("as"))
            if args.area == "customer":
                url = f"{args.web}/{lang}/{cap.resolve_customer(pg['path'])}"
            else:
                path = pg["path"]
                if "{first}" in path:
                    key = json.dumps(pg["first"], sort_keys=True)
                    if key not in resolved:
                        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
                        ctx.add_cookies([{"name": k, "value": v, "url": args.web} for k, v in jar.items()])
                        resolved[key] = cap.first_link(ctx, args.web, lang, pg["first"])
                        ctx.close()
                    if not resolved[key]:
                        results[pg["name"]] = {"skipped": True}
                        continue
                    path = path.replace("{first}", resolved[key])
                url = f"{args.web}/{lang}/workforce/{path}".replace("/workforce/../", "/")
            row = {"url": url}
            for mode in ("full", "reduced", "off"):
                ctx = browser.new_context(
                    viewport={"width": width, "height": 900},
                    reduced_motion="reduce" if mode == "reduced" else "no-preference",
                    color_scheme="light",
                )
                cookies = [{"name": k, "value": v, "url": args.web, "httpOnly": True} for k, v in jar.items()]
                if mode == "off":
                    cookies.append({"name": "ls-fx", "value": "off", "url": args.web})
                if cookies:
                    ctx.add_cookies(cookies)
                ctx.add_init_script(PROBE_INIT)
                page = ctx.new_page()
                page.add_init_script(
                    "document.addEventListener('DOMContentLoaded', () => { (" + SAMPLER + ")(); });"
                )
                shots = []
                if mode == "full" and pg["name"] in frames_for:
                    page.goto(url, wait_until="commit", timeout=60000)
                    start = time.time()
                    for i in range(10):
                        file = frame_dir / f"{args.area}-{pg['name']}-{i * 100:03d}ms.png"
                        page.screenshot(path=str(file))
                        shots.append(file.name)
                        time.sleep(max(0, (i + 1) * 0.1 - (time.time() - start)))
                    page.wait_for_load_state("networkidle", timeout=60000)
                else:
                    page.goto(url, wait_until="networkidle", timeout=60000)
                data = page.evaluate(SCROLL)
                # A 0.01 ms animation is the reduced-motion placeholder (no visible tween); only real durations count.
                anims = [a for a in data["animations"] if not isinstance(a.get("duration"), (int, float)) or a["duration"] > 1]
                tweens = data["tweens"]
                # The skeleton pulse is the one allowed loop (DESIGN 11.3, G5): a loop cycle, not a tween; excluded from the 200 ms check.
                over = [
                    a
                    for a in anims
                    if isinstance(a.get("duration"), (int, float)) and a["duration"] > 200 and "ls-skeleton" not in a["el"]
                ]
                over += [t for t in tweens if t["duration"] > 0.2]
                row[mode] = {
                    "tweens": len(tweens),
                    "animations": len(anims),
                    "tweenList": tweens,
                    "animationList": anims,
                    "over200ms": len(over) if args.area == "staff" else None,
                    "frames": shots,
                }
                ctx.close()
            results[pg["name"]] = row
            f = row["full"]
            print(
                f"ok {pg['name']} full={f['tweens']}t/{f['animations']}a reduced={row['reduced']['tweens']}t/{row['reduced']['animations']}a "
                f"off={row['off']['tweens']}t/{row['off']['animations']}a"
                + (f" over200={f['over200ms']}" if args.area == "staff" else ""),
                flush=True,
            )
        browser.close()
    (out_dir / f"{args.area}.json").write_text(json.dumps(results, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    sys.exit(main())
