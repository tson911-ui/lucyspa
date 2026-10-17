"""Frame sequence of a shared-element photo morph (G8 evidence, redesign session 10).

Opens a customer list page, clicks the first card whose link matches --link, and records the screen through Chrome's screencast
while the view transition runs (about 900 ms), then saves the frames. Also reports whether a view transition ran and its duration,
and repeats with reduced motion (the morph must be instant or a <= 120 ms fade, G6).

  python scripts/uxui-morph-frames.py --phase s10final --list services --link /services/ --name service-morph
  python scripts/uxui-morph-frames.py --phase s10final --list products --link /products/ --name product-morph
"""

import argparse
import base64
import json
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent


def record(page, cdp, link, ms):
    frames = []

    def on_frame(params):
        frames.append((time.perf_counter(), params["data"]))
        cdp.send("Page.screencastFrameAck", {"sessionId": params["sessionId"]})

    cdp.on("Page.screencastFrame", on_frame)
    page.evaluate(
        """() => {
      window.__vt = [];
      const orig = document.startViewTransition?.bind(document);
      if (!orig) return;
      document.startViewTransition = (arg) => {
        const t0 = performance.now();
        const vt = orig(arg);
        vt.finished.finally(() => window.__vt.push(Math.round(performance.now() - t0)));
        return vt;
      };
    }"""
    )
    cdp.send("Page.startScreencast", {"format": "png", "everyNthFrame": 1})
    start = time.perf_counter()
    page.locator(f'main a[href*="{link}"]:visible').first.click()
    while time.perf_counter() - start < ms / 1000:
        page.wait_for_timeout(20)
    cdp.send("Page.stopScreencast")
    page.wait_for_load_state("networkidle")
    vt = page.evaluate("() => window.__vt || []")
    return [(t - start, d) for t, d in frames], vt


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--phase", required=True)
    ap.add_argument("--list", required=True, help="list path under /vi/")
    ap.add_argument("--link", required=True, help="href fragment of the card link")
    ap.add_argument("--name", required=True)
    ap.add_argument("--web", default="http://localhost:3100")
    ap.add_argument("--width", type=int, default=1440)
    ap.add_argument("--ms", type=int, default=900)
    args = ap.parse_args()
    out = ROOT / ".local" / "uxui-screens" / args.phase / "motion"
    out.mkdir(parents=True, exist_ok=True)
    result = {}
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="msedge", headless=True)
        for mode in ("full", "reduced"):
            ctx = browser.new_context(
                viewport={"width": args.width, "height": 900},
                reduced_motion="reduce" if mode == "reduced" else "no-preference",
            )
            page = ctx.new_page()
            page.goto(f"{args.web}/vi/{args.list}")
            page.wait_for_load_state("networkidle")
            page.wait_for_timeout(800)
            cdp = ctx.new_cdp_session(page)
            frames, vt = record(page, cdp, args.link, args.ms)
            saved = []
            for i, (t, data) in enumerate(frames[:40]):
                f = out / f"{args.name}-{mode}-{i:02d}-{int(t * 1000):04d}ms.png"
                f.write_bytes(base64.b64decode(data))
                saved.append(f.name)
            result[mode] = {"frames": len(frames), "viewTransitionMs": vt, "url": page.url, "saved": saved[:5] + ["..."]}
            ctx.close()
        browser.close()
    (out / f"{args.name}.json").write_text(json.dumps(result, indent=1), encoding="utf-8")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
