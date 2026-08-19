"""Read-only SmartPAL attachment diagnostic.

This deliberately does not use the existing scraper, database models, or Azure
storage.  It logs into SmartPAL, selects an explicitly mapped equipment code,
and records attachment evidence only.  On every failure it writes a screenshot
and page HTML under ``diagnostics/`` for inspection.

Usage (PowerShell):
  $env:SMARTPAL_BROWSER_EXECUTABLE = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
  .\.reports-runtime\Scripts\python.exe tools\smartpal_attachment_probe.py --target ae1-performance
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from urllib.parse import urljoin


ROOT = Path(__file__).resolve().parents[1]
MAPPING_FILE = ROOT / "tools" / "smartpal_targets.json"
ARTIFACT_DIR = ROOT / "diagnostics"


@dataclass(frozen=True)
class Target:
    key: str
    vessel_name: str
    smartpal_equipment_code: str
    report_label: str


def load_target(key: str, path: Path = MAPPING_FILE) -> Target:
    """Load one target and require the actual SmartPAL equipment code."""
    items = json.loads(path.read_text(encoding="utf-8"))
    for item in items:
        if item.get("key") == key:
            required = ("key", "vessel_name", "smartpal_equipment_code", "report_label")
            missing = [name for name in required if not str(item.get(name, "")).strip()]
            if missing:
                raise ValueError(f"Target '{key}' is missing: {', '.join(missing)}")
            return Target(**{name: item[name].strip() for name in required})
    raise ValueError(f"Unknown target '{key}'. Add its SmartPAL equipment code to {path.name}.")


async def save_evidence(page, label: str) -> tuple[Path, Path]:
    ARTIFACT_DIR.mkdir(exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    base = ARTIFACT_DIR / f"{stamp}-{label}"
    png, html = base.with_suffix(".png"), base.with_suffix(".html")
    await page.screenshot(path=str(png), full_page=True)
    html.write_text(await page.content(), encoding="utf-8")
    return png, html


async def login(page, settings) -> None:
    await page.goto(settings.SMARTPAL_BASE_URL, wait_until="domcontentloaded", timeout=120_000)
    await page.get_by_text("Login with your Microsoft account", exact=False).first.click(timeout=30_000)
    await page.locator("input[type='email']").fill(settings.SMARTPAL_EMAIL, timeout=30_000)
    await page.get_by_role("button", name=re.compile("next", re.I)).click(timeout=20_000)
    await page.locator("input[type='password']").fill(settings.SMARTPAL_PASSWORD, timeout=30_000)
    await page.get_by_role("button", name=re.compile("sign in", re.I)).click(timeout=20_000)
    try:
        await page.get_by_role("button", name=re.compile("yes", re.I)).click(timeout=5_000)
    except Exception:
        pass
    await page.wait_for_url(lambda url: "login.microsoftonline.com" not in url, timeout=90_000)


async def open_overview(context, base_url: str):
    page = await context.new_page()
    url = urljoin(base_url.rstrip("/") + "/", "MaintenancePALApp/Maintenance/JobOverview")
    await page.goto(url, wait_until="domcontentloaded", timeout=90_000)
    await page.locator("body").wait_for(state="visible", timeout=30_000)
    return page


async def exact_equipment_search(page, target: Target) -> None:
    """Select only the exact external SmartPAL equipment code, never a guess."""
    vessel = page.locator("input[placeholder*='Vessel'], input[id*='vessel' i]").first
    if await vessel.count():
        await vessel.fill(target.vessel_name)
        await vessel.press("ArrowDown")
        await vessel.press("Enter")

    search = page.locator("input[placeholder*='Search Equipment']").first
    await search.wait_for(state="visible", timeout=30_000)
    await search.fill(target.smartpal_equipment_code)
    choices = page.locator(".k-animation-container li, .k-list-container li, ul.k-list li")
    await choices.first.wait_for(state="visible", timeout=20_000)
    labels = [label.strip() for label in await choices.all_inner_texts() if label.strip()]
    expected = re.sub(r"\s+", "", target.smartpal_equipment_code).upper()
    exact_label = next(
        (label for label in labels if re.sub(r"\s+", "", label.split(maxsplit=1)[0]).upper() == expected),
        None,
    )
    if not exact_label:
        raise RuntimeError(f"Exact code {target.smartpal_equipment_code} not found; candidates={labels[:10]!r}")
    await choices.filter(has_text=re.compile(rf"^\s*{re.escape(target.smartpal_equipment_code)}(?:\s|$)", re.I)).first.click()
    await page.locator("#jobOverviewShowBtn").click(timeout=20_000)
    await page.locator("a.cellEqpNameLink").first.wait_for(state="visible", timeout=30_000)


async def inspect_attachments(page) -> list[dict[str, str]]:
    """Return the displayed attachment rows; it never downloads or uploads files."""
    await page.get_by_text("Attachments", exact=False).first.click(timeout=20_000)
    await page.locator("iframe[src*='Attachment'], .attachment-grid, .k-grid").first.wait_for(timeout=20_000)
    rows = page.locator(".attachment-grid tbody tr, [class*='attachment'] tbody tr")
    return [{"text": text.strip()} for text in await rows.all_inner_texts() if text.strip()]


async def probe(target: Target) -> list[dict[str, str]]:
    from playwright.async_api import async_playwright
    from app.core.config import settings

    executable = os.getenv("SMARTPAL_BROWSER_EXECUTABLE")
    launch = {"headless": True}
    if executable:
        launch["executable_path"] = executable
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(**launch)
        context = await browser.new_context()
        try:
            landing = await context.new_page()
            await login(landing, settings)
            overview = await open_overview(context, settings.SMARTPAL_BASE_URL)
            await exact_equipment_search(overview, target)
            # The job-detail page must be selected intentionally after this
            # probe confirms the exact equipment mapping and exposes its grid.
            evidence = await save_evidence(overview, "exact-equipment-selected")
            print(f"Exact equipment selected. Evidence: {evidence[0]}, {evidence[1]}")
            return []
        except Exception:
            current = next((p for p in context.pages if not p.is_closed()), None)
            if current:
                png, html = await save_evidence(current, "failure")
                print(f"Failure evidence: {png}, {html}")
            raise
        finally:
            await browser.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Read-only SmartPAL exact-equipment diagnostic")
    parser.add_argument("--target", required=True, help="Target key from tools/smartpal_targets.json")
    args = parser.parse_args()
    asyncio.run(probe(load_target(args.target)))


if __name__ == "__main__":
    main()
