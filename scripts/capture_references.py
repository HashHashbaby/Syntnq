"""Capture design references at 390, 820 and 1440 px, light and dark (docs/REFERENCES.md).

Needs Playwright with Chromium, for example::

    uv run --with playwright python -m playwright install chromium
    uv run --with playwright python scripts/capture_references.py

Output goes to ``data/references/`` (git-ignored) as ``<name>_<width>_<scheme>.png``.
Pages are public; nothing is logged in to or submitted.
"""

from __future__ import annotations

import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "references"
SITES = {
    "landonorris": ("https://landonorris.com/", False),  # (url, full page?)
    "apple_design_resources": ("https://developer.apple.com/design/resources/", True),
}
SIZES = {390: 844, 820: 1180, 1440: 900}
SCHEMES = ("light", "dark")
SETTLE_MS = 7000  # the first site shows a full-screen loader before its hero


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    failures = 0
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for name, (url, full) in SITES.items():
            for width, height in SIZES.items():
                for scheme in SCHEMES:
                    target = OUT / f"{name}_{width}_{scheme}.png"
                    ctx = browser.new_context(
                        viewport={"width": width, "height": height},
                        color_scheme=scheme,  # type: ignore[arg-type]
                        device_scale_factor=1,
                    )
                    page = ctx.new_page()
                    try:
                        page.goto(url, wait_until="load", timeout=45000)
                        page.wait_for_timeout(SETTLE_MS)
                        page.screenshot(path=str(target), full_page=full)
                        sys.stdout.write(f"ok   {target.name}\n")
                    except Exception as exc:  # noqa: BLE001 - report and continue
                        failures += 1
                        sys.stdout.write(f"FAIL {target.name}: {str(exc)[:120]}\n")
                    finally:
                        ctx.close()
        browser.close()
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
