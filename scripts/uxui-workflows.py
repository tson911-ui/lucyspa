"""End-to-end staff workflows after the redesign (session 10 brief, Finish F): sale, payment, booking check-in, product edit, invoice view.
Runs in the real app (web 3100, scratch API 3101, scratch database) as the audit Owner, with a screenshot after every step in
.local/uxui-screens/<phase>/workflows/, and prints PASS/FAIL per workflow. The booking check-in needs a confirmed booking for today at the
main branch (see .local/s10/book-member.mjs + booking-today.mjs); its code is the first argument.

  python scripts/uxui-workflows.py --phase s10final --booking BK-261018-SA57PG --customer-phone 0912000002
"""

import argparse
import json
import re
import subprocess
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parent.parent
WEB = "http://localhost:3100"
PRODUCT = "04d996b1-4ae8-4243-9ab6-7a19673436f9"


def cookies(key):
    out = subprocess.run(["node", ".local/s10/cookies.mjs", key], cwd=ROOT, capture_output=True, text=True, check=True).stdout
    return json.loads(out.strip().splitlines()[-1])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--phase", required=True)
    ap.add_argument("--booking", required=True)
    ap.add_argument("--customer-phone", required=True)
    ap.add_argument("--only", default="", help="comma list of workflows to run (default: all)")
    args = ap.parse_args()
    shots = ROOT / ".local" / "uxui-screens" / args.phase / "workflows"
    shots.mkdir(parents=True, exist_ok=True)
    results = {}
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="msedge", headless=True)
        ctx = browser.new_context(viewport={"width": 1280, "height": 900})
        ctx.add_cookies([{"name": k, "value": v, "url": WEB} for k, v in cookies("staff").items()])
        page = ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)[:200]))
        shot = lambda name: page.screenshot(path=str(shots / f"{name}.png"), full_page=False)

        def step(name, fn):
            try:
                fn()
                results[name] = "PASS"
            except Exception as error:  # noqa: BLE001 - every failure is reported, the run goes on
                results[name] = f"FAIL: {str(error).splitlines()[0][:200]}"
                shot(f"{name}-failed")

        invoice_url = {}

        def sale():
            page.goto(f"{WEB}/vi/workforce/pos")
            page.wait_for_load_state("networkidle")
            page.get_by_role("button", name="Bán sản phẩm…").click()
            dialog = page.get_by_role("dialog")
            dialog.locator("input[type=tel]").fill(args.customer_phone)
            dialog.get_by_role("button", name="Tìm khách").click()
            dialog.get_by_role("button", name="Bắt đầu bán").click()
            page.wait_for_url(re.compile(r"/workforce/pos/[0-9a-f-]{36}"))
            page.wait_for_load_state("networkidle")
            invoice_url["url"] = page.url
            shot("1-sale-draft")
            page.get_by_role("button", name="Thêm sản phẩm…").click()
            dialog = page.get_by_role("dialog")
            dialog.locator("input[type=text]").first.fill("Tinh chất")
            page.get_by_text("Tinh chất phục hồi da (30 ml)").first.click()
            dialog.locator("input[type=text]").nth(1).fill("1")
            dialog.locator("select").first.select_option(index=1)
            dialog.get_by_role("button", name="Thêm vào hóa đơn").click()
            expect(page.get_by_role("button", name="Thao tác cho Tinh chất phục hồi da (30 ml)")).to_be_visible(timeout=15000)
            shot("2-sale-line")
            page.get_by_role("button", name="Chốt hóa đơn").click()
            expect(page.get_by_role("button", name="Thu tiền mặt…")).to_be_visible(timeout=15000)
            shot("3-sale-final")

        def payment():
            page.goto(invoice_url["url"])
            page.wait_for_load_state("networkidle")
            page.get_by_role("button", name="Thu tiền mặt…").click()
            dialog = page.get_by_role("dialog")
            amount = dialog.locator("input[type=text]").first
            if not amount.input_value():
                due = page.evaluate("() => (document.body.innerText.match(/Còn phải thu[^0-9]*([0-9.]+)/) || [])[1] || ''")
                amount.fill(due.replace(".", ""))
            given = dialog.locator("input[type=text]").nth(1)
            if not given.input_value():
                given.fill(amount.input_value())
            dialog.get_by_role("button", name="Ghi nhận thu tiền").click()
            page.wait_for_timeout(2500)
            page.wait_for_load_state("networkidle")
            shot("4-payment-done")
            expect(page.get_by_role("button", name="Thu tiền mặt…")).to_have_count(0, timeout=15000)

        def check_in():
            page.goto(f"{WEB}/vi/workforce/booking-board")
            page.wait_for_load_state("networkidle")
            shot("5-board-before")
            page.get_by_role("button", name=f"Khách đã đến: {args.booking}").first.click()
            page.wait_for_timeout(800)
            confirm = page.locator("[role=dialog], [role=alertdialog]")
            if confirm.count():
                shot("6-check-in-confirm")
                confirm.get_by_role("button").filter(has_text=re.compile("Khách đã đến|Xác nhận|Nhận khách")).last.click()
            page.wait_for_timeout(2500)
            page.wait_for_load_state("networkidle")
            shot("7-board-after")
            expect(page.get_by_role("button", name=f"Khách đã đến: {args.booking}")).to_have_count(0, timeout=15000)

        def product_edit():
            page.goto(f"{WEB}/vi/workforce/products/{PRODUCT}")
            page.wait_for_load_state("networkidle")
            page.get_by_role("button", name="Chỉnh sửa…").click()
            dialog = page.get_by_role("dialog")
            name_en = dialog.locator("input[name=nameEn]")
            original = name_en.input_value()
            name_en.fill(original + " S10")
            shot("8-product-edit")
            dialog.get_by_role("button", name="Lưu").click()
            expect(page.get_by_role("dialog")).to_have_count(0, timeout=15000)
            page.reload()
            page.wait_for_load_state("networkidle")
            page.get_by_role("button", name="Chỉnh sửa…").click()
            dialog = page.get_by_role("dialog")
            saved = dialog.locator("input[name=nameEn]").input_value()
            assert saved == original + " S10", f"saved name is {saved!r}"
            dialog.locator("input[name=nameEn]").fill(original)
            dialog.get_by_role("button", name="Lưu").click()
            expect(page.get_by_role("dialog")).to_have_count(0, timeout=15000)
            shot("9-product-reverted")

        def invoice_view():
            page.goto(invoice_url["url"])
            page.wait_for_load_state("networkidle")
            expect(page.get_by_role("heading", level=1)).to_contain_text("Hóa đơn")
            shot("10-invoice-staff")
            member = browser.new_context(viewport={"width": 390, "height": 844})
            member.add_cookies([{"name": k, "value": v, "url": WEB} for k, v in cookies("cart").items()])
            mpage = member.new_page()
            mpage.goto(f"{WEB}/vi/account/invoices")
            mpage.wait_for_load_state("networkidle")
            mpage.locator("main a[href*='/account/invoices/']").first.click()
            mpage.wait_for_url(re.compile(r"/account/invoices/[0-9a-f-]{36}"))
            mpage.wait_for_load_state("networkidle")
            expect(mpage.get_by_role("heading", level=1)).to_be_visible()
            mpage.screenshot(path=str(shots / "11-invoice-customer.png"), full_page=True)
            member.close()

        wanted = set(filter(None, args.only.split(",")))
        for name, fn in (("sale", sale), ("payment", payment), ("booking-check-in", check_in), ("product-edit", product_edit), ("invoice-view", invoice_view)):
            if not wanted or name in wanted:
                step(name, fn)
        results["page-errors"] = errors[:5] or "none"
        browser.close()
    (shots / "results.json").write_text(json.dumps(results, indent=1, ensure_ascii=False), encoding="utf-8")
    for k, v in results.items():
        print(k, v)


if __name__ == "__main__":
    main()
