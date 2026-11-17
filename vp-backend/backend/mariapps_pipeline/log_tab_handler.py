import logging
import time
from playwright.sync_api import Page

log = logging.getLogger(__name__)


def _find_log_link(target, log_number, log_date_raw=None):
    """Detail-link locator for one grid row. MariApps can reuse a log number on
    a different date (AMNS POLAR: VOY 52 L1/01/01-06 on 13-15 Jul and again on
    25-27 Aug), so the row is matched on log number AND the grid's Log Date
    text. If no row matches on date and the number is ambiguous (several links),
    returns None instead of guessing: opening the wrong log would save its
    data under this log's date."""
    number_links = target.locator("a#toLogBook", has_text=log_number)
    if log_date_raw:
        by_row = (
            target.locator(".k-grid-content table tr")
            .filter(has_text=log_number)
            .filter(has_text=log_date_raw)
            .locator("a#toLogBook", has_text=log_number)
        )
        if by_row.count() > 0:
            return by_row.first
    if number_links.count() <= 1:
        return number_links.first   # unambiguous number: previous behaviour
    return None


class MariAppsLogTabHandler:
    def __init__(self, page: Page):
        self.page = page

    def open_log_tab(self, row_data: dict):
        """
        Opens the detail page for a given log by clicking its hyperlink.
        Waits for the new tab to fully load before returning it.

        Returns the new Page object, or None if it could not be opened.

        Popup-leak fix: if the popup DOES open but a later wait (page load,
        Weather-tab-visible) times out, the old code fell through to the
        except block and returned None WITHOUT ever closing `new_page` — a
        real bug found during the CP Remarks historical backfill, where
        each such failure left an orphaned tab open in the same browser
        context. Over ~170 consecutive failures on one vessel this piled up
        enough open tabs to degrade the whole context (one gap between log
        lines was ~85 minutes), which then cascaded into near-100% failures
        on every subsequent log for the rest of that run. `new_page` is now
        tracked outside the risky waits and explicitly closed on any
        failure path before returning None.
        """
        log_number = row_data.get("log_number")
        if not log_number:
            log.warning("open_log_tab called with no log_number in row_data.")
            return None

        new_page = None
        try:
            # Find the frame that contains the grid links
            target = self.page
            for frame in self.page.frames:
                try:
                    if frame.locator("a#toLogBook").count() > 0:
                        target = frame
                        break
                except Exception:
                    continue

            # Locate the specific link for this log number
            log_link = _find_log_link(target, log_number, row_data.get("log_date_raw"))

            if log_link is None:
                log.warning(
                    f"  Log {log_number} ({row_data.get('log_date_raw')}) appears on several grid "
                    f"rows and none matched on date — skipped rather than risk opening the wrong log."
                )
                return None

            if log_link.count() == 0:
                log.warning(f"  Link for log {log_number} not found in grid — may be off-screen.")
                return None

            # Scroll the element into view before clicking
            log_link.evaluate("el => el.scrollIntoView({ block: 'center', behavior: 'auto' })")
            time.sleep(0.5)  # short settle time

            # Open the link in a new tab by catching the popup
            with self.page.context.expect_page(timeout=30000) as new_page_info:
                log_link.evaluate("el => el.click()")

            new_page = new_page_info.value
            new_page.wait_for_load_state("domcontentloaded", timeout=30000)

            # Wait for the Performance tab to be present — confirms the detail page loaded
            new_page.locator("a[href='#Weather']").wait_for(state="visible", timeout=20000)

            log.info(f"  ↳ Detail tab opened for log {log_number}.")
            return new_page

        except Exception as e:
            log.error(f"  ❌ Error opening tab for log {log_number}: {e}")
            if new_page is not None:
                try:
                    if not new_page.is_closed():
                        new_page.close()
                except Exception:
                    pass
            return None