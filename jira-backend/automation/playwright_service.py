"""
playwright_service.py — Jira automation via Playwright (Python port of smartpal puppeteer-service.ts)
══════════════════════════════════════════════════════════════════════════════════════════════════════

KEY ARCHITECTURE (mirrors smartpal exactly):
  • Singleton browser kept alive between operations
  • scrape_all_tickets()     — sync wrapper, list scrape only (fast, no detail pages)
  • submit_ticket()          — sync wrapper, push ticket to Jira
  • open_session_async()     — ASYNC: open ONE browser, login once for batch fetching
  • fetch_detail_async()     — ASYNC: scrape ONE ticket detail page (reuses session)
  • close_session_async()    — ASYNC: close browser cleanly

COMMENT SCRAPING (smartpal 3-strategy, body text PARSED IN PYTHON like smartpal):
  Strategy 1 — body text timestamp parsing (MOST RELIABLE — smartpal's primary method)
    • Get document.body.innerText in browser
    • Parse in Python: find Activity section, split by timestamp regex
    • Author = last non-empty line before timestamp
    • Message = text after timestamp until next timestamp
    • Skip "automatic response" entries
    • Strip next author name from end of each message

  Strategy 2 — DOM activity item selectors (only if Strategy 1 finds 0 comments)
    • Structured selectors for activity feed items
    • Includes embedded image extraction

  Strategy 3 — generic comment containers (only if both 1 and 2 find 0 comments)

  IMAGE ENRICHMENT: if Strategy 1 found comments (no images), do a separate DOM pass
  to attach embedded images to comments by position index.

SESSION FLOW (pull_service calls these):
    session = await service.open_session_async()   ← one login, all 318 tickets
    for ticket in needs_detail:
        detail = await service.fetch_detail_async(session, url)
    await service.close_session_async(session)

SYNC WRAPPERS (for non-async callers like push_service):
  service.submit_ticket(ticket)    → spawns thread, runs async in new loop
  service.scrape_all_tickets()     → spawns thread, runs async in new loop
"""

import asyncio
import json
import re
import threading
from pathlib import Path
from typing import Optional, List, Dict, Tuple
from core.config import settings

# COOKIES_PATH can be overridden by env var JIRA_COOKIES_PATH.
# Default: C:/tmp/jira-cookies.json  (Windows server)
# On Linux: set JIRA_COOKIES_PATH=/tmp/jira-cookies.json in your environment.
# Both playwright_service.py and jira.py read from this same path.
import os as _os
# COOKIES_PATH   = Path(_os.environ.get("JIRA_COOKIES_PATH", "C:/tmp/jira-cookies.json"))
# SCREENSHOT_DIR = Path(_os.environ.get("JIRA_SCREENSHOT_DIR", "C:/tmp"))
BASE_DIR = Path(__file__).resolve().parent

COOKIES_PATH = Path(_os.environ.get(
    "JIRA_COOKIES_PATH",
    BASE_DIR / "jira-cookies.json"
))

SCREENSHOT_DIR = Path(_os.environ.get(
    "JIRA_SCREENSHOT_DIR",
    BASE_DIR / "screenshots"
))
COOKIES_PATH.parent.mkdir(parents=True, exist_ok=True)
SCREENSHOT_DIR.mkdir(parents=True, exist_ok=True)

# Timestamp pattern — matches smartpal's timePattern exactly
# Handles: "Today 10:20 AM", "Yesterday 3:47 PM", "Friday 10:20 AM",
#          "02 Mar 2026 9:15 AM", "2 Mar 26 9:15 AM",
#          "03 Mar 2026, 9:15 AM" (comma between date and time),
#          "Mar 04, 2026, 6:30 PM" (month-first format seen in current Jira portal)
#
# FIX 1: Added optional comma `,?` between date and time (original fix).
# FIX 2: Added month-first alternative branch: [A-Za-z]+ DD, YYYY, H:MM AM/PM
#   Jira's portal now renders some absolute timestamps month-first with two commas.
#   Without this branch those timestamps don't split the comment body correctly,
#   causing multiple comments to merge into one giant block.
TIMESTAMP_RE = re.compile(
    r'(?:'
    r'Today|Yesterday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday'  # relative
    r'|\d{1,2}\s+[A-Za-z]+\s+\d{2,4}'           # DD Mon YYYY  (day-first absolute)
    r'|[A-Za-z]+\s+\d{1,2},\s+\d{4}'            # Mon DD, YYYY (month-first absolute)
    r')'
    r',?'                                         # optional comma between date and time
    r'\s+\d{1,2}:\d{2}\s*(?:AM|PM)',
    re.IGNORECASE
)


# ─── Jira markup cleaner ──────────────────────────────────────────────────────

def _clean_jira_markup(text: str) -> str:
    # Strip raw Jira Wiki Markup and ADF tags from API comment bodies.
    # The Jira API returns raw markup, not the rendered text seen in browser:
    #   [~accountid:qm:77bb0de8...]      ->  @User
    #   [color:#172B4D]Good day[/color]  ->  Good day
    #   !image001.png|thumbnail!         ->  (removed, image is in images[] already)
    #   {adf}{...JSON...}[/adf]          ->  (removed, usually hidden email sigs)
    #   [Click Here|https://...]         ->  Click Here
    if not text:
        return ""

    # 1. Remove ADF/JSON blocks (Jira wraps email signatures in these)
    text = re.sub(r'\{adf\}.*?(?:\[/adf\]|\{adf\}|$)', '', text, flags=re.IGNORECASE | re.DOTALL)
    text = re.sub(r'\[adf\].*?(?:\[/adf\]|$)', '', text, flags=re.IGNORECASE | re.DOTALL)

    # 2. Replace account ID mentions with @User
    text = re.sub(r'\[~accountid:[^\]]+\]', '@User', text)

    # 3. Remove [color:#HEX] and [/color] bracket-style tags (keep inner text)
    text = re.sub(r'\[color:[^\]]+\]', '', text, flags=re.IGNORECASE)
    text = re.sub(r'\[/color\]', '', text, flags=re.IGNORECASE)

    # 4. Remove {color:#HEX} and {color} brace-style tags (keep inner text)
    text = re.sub(r'\{color:[^}]+\}', '', text, flags=re.IGNORECASE)
    text = re.sub(r'\{color\}', '', text, flags=re.IGNORECASE)

    # 5. Remove inline image tags like !image001.png|thumbnail!
    #    Images already appear in images[] via the DOM merger, so this tag is redundant
    text = re.sub(r'![^!\n]+!', '', text)

    # 6. Convert smart links [label|url] -> just the label text
    text = re.sub(r'\[([^|\]]+)\|[^\]]+\]', r'\1', text)

    # 7. Collapse 3+ blank lines to max 2 (tidy up leftover whitespace)
    text = re.sub(r'\n{3,}', '\n\n', text)

    return text.strip()



# ─── Thread / event-loop helpers ──────────────────────────────────────────────

def _run_in_new_loop(coro):
    """Run an async coroutine in a dedicated thread with its own event loop."""
    result = {"value": None, "error": None}

    def thread_fn():
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            result["value"] = loop.run_until_complete(coro)
        except Exception as e:
            result["error"] = e
        finally:
            loop.close()

    t = threading.Thread(target=thread_fn)
    t.start()
    t.join(timeout=600)   # 10 min for list scrape / push
    if result["error"]:
        raise result["error"]
    return result["value"]


# ─── Browser helpers ──────────────────────────────────────────────────────────

async def _new_browser(p):
    return await p.chromium.launch(
        headless=True,
        args=["--no-sandbox", "--disable-setuid-sandbox",
              "--disable-dev-shm-usage", "--disable-gpu",
              "--window-size=1920,1080"]
    )


async def _new_context(browser):
    return await browser.new_context(
        viewport={"width": 1920, "height": 1080},
        user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    )


async def _load_cookies(context):
    try:
        if COOKIES_PATH.exists():
            cookies = json.loads(COOKIES_PATH.read_text())
            if cookies:
                await context.add_cookies(cookies)
                print(f"[Jira] Loaded {len(cookies)} cookies")
    except Exception as e:
        print(f"[Jira] Cookie load error: {e}")


async def _save_cookies(context):
    try:
        cookies = await context.cookies()
        COOKIES_PATH.write_text(json.dumps(cookies))
        print(f"[Jira] Saved {len(cookies)} cookies")
    except Exception as e:
        print(f"[Jira] Cookie save error: {e}")


async def _screenshot(page, name: str):
    try:
        path = SCREENSHOT_DIR / f"jira-{name}.png"
        await page.screenshot(path=str(path), full_page=True)
        print(f"[Jira] Screenshot: {path}")
    except Exception:
        pass


# ─── Login ────────────────────────────────────────────────────────────────────

async def _do_login(page, email: str, password: str, base_url: str) -> bool:
    """Full login flow: portal → cookie banner → Log in → email → password."""
    print("[Jira] Starting login flow...")
    await page.goto(f"{base_url}/servicedesk/customer/portals", wait_until="networkidle")
    await page.wait_for_timeout(3000)

    # Dismiss cookie banner
    try:
        await page.evaluate("""(function() {
            var btns = Array.from(document.querySelectorAll('button'));
            var b = btns.find(function(x){
                return (x.textContent||'').trim().toLowerCase().indexOf('only necessary') >= 0;
            });
            if (!b) b = btns.find(function(x){
                return (x.textContent||'').trim().toLowerCase().indexOf('accept all') >= 0;
            });
            if (b) b.click();
        })()""")
        await page.wait_for_timeout(1000)
    except Exception:
        pass

    # Already logged in?
    cur = page.url
    if "atlassian.net" in cur and "login" not in cur and "auth" not in cur:
        has_login = await page.evaluate("""(function() {
            var els = Array.from(document.querySelectorAll('a, button'));
            return els.some(function(el){
                var t = (el.textContent||'').trim().toLowerCase();
                return t === 'log in' || t === 'login';
            });
        })()""")
        if not has_login:
            print("[Jira] Already logged in via cookies")
            return True

    # Click Log in
    await page.evaluate("""(function() {
        var els = Array.from(document.querySelectorAll('a, button'));
        var el = els.find(function(e){
            var t = (e.textContent||'').trim().toLowerCase();
            return t === 'log in' || t === 'login' || t === 'sign in';
        });
        if (el) el.click();
    })()""")
    await page.wait_for_timeout(3000)

    # Email
    print("[Jira] Entering email...")
    try:
        await page.wait_for_selector('#user-email', timeout=15000)
        await page.fill('#user-email', email)
        await page.wait_for_timeout(500)
        btn = await page.query_selector('#login-button')
        if btn:
            await btn.click()
        else:
            await page.keyboard.press('Enter')
    except Exception as e:
        await _screenshot(page, "email-error")
        raise Exception(f"Email field error: {e}")

    await page.wait_for_timeout(4000)

    # Password
    print("[Jira] Entering password...")
    try:
        await page.wait_for_selector('#user-password', timeout=15000)
        await page.fill('#user-password', password)
        await page.wait_for_timeout(500)
        btn2 = await page.query_selector('#login-button')
        if btn2:
            await btn2.click()
        else:
            await page.keyboard.press('Enter')
    except Exception as e:
        await _screenshot(page, "password-error")
        raise Exception(f"Password field error: {e}")

    try:
        await page.wait_for_navigation(wait_until="networkidle", timeout=30000)
    except Exception:
        pass
    await page.wait_for_timeout(3000)

    post_url = page.url
    print(f"[Jira] Post-login URL: {post_url}")

    if "atlassian.net" in post_url and "login" not in post_url and "auth" not in post_url:
        await _save_cookies(page.context)
        print("[Jira] Login successful!")
        return True

    await _screenshot(page, "login-failed")
    raise Exception(f"Login failed. URL: {post_url}")


# ─── React-Select helper ──────────────────────────────────────────────────────

async def _fill_react_select(page, selector: str, value: str) -> bool:
    try:
        inp = await page.query_selector(selector)
        if not inp:
            print(f"[Jira] Dropdown not found: {selector}")
            return False
        await inp.click()
        await page.wait_for_timeout(1000)
        await inp.type(value, delay=50)
        await page.wait_for_timeout(1000)

        sv = value.replace("'", "\\'").lower()
        js = (
            "(function() { var s = '" + sv + "';"
            " var o = Array.from(document.querySelectorAll('[role=\"option\"]'));"
            " var m = o.find(function(x){return (x.textContent||'').trim().toLowerCase()===s;});"
            " if(!m) m=o.find(function(x){return (x.textContent||'').trim().toLowerCase().indexOf(s)>=0;});"
            " if(m){m.click();return (m.textContent||'').trim();} return null; })()"
        )
        selected = await page.evaluate(js)
        if selected:
            print(f"[Jira] Selected '{selected}' for {selector}")
            return True

        # Fallback: first available option
        fallback = await page.evaluate(
            "(function() { var o = Array.from(document.querySelectorAll('[role=\"option\"]'));"
            " var v = o.find(function(x){return (x.textContent||'').trim() !== 'No options';});"
            " if(v){v.click();return (v.textContent||'').trim();} return null; })()"
        )
        if fallback:
            print(f"[Jira] Fallback '{fallback}' for {selector}")
            return True
        return False
    except Exception as e:
        print(f"[Jira] Dropdown error {selector}: {e}")
        return False


# ─── Reference extractor ─────────────────────────────────────────────────────

async def _extract_reference(page, base_url: str) -> Tuple[Optional[str], str]:
    cur = page.url
    m = re.search(r"(OZLR-\d+)", cur, re.IGNORECASE)
    if m:
        return m.group(1).upper(), cur
    try:
        body = await page.evaluate("(function(){ return document.body.innerText||''; })()")
        bm = re.search(r"\b(OZLR-\d+)\b", body)
        if bm:
            ref = bm.group(1)
            return ref, f"{base_url}/browse/{ref}"
    except Exception:
        pass
    return None, cur


# ─── COMMENT PARSING IN PYTHON (smartpal's core algorithm) ───────────────────

def _parse_comments_from_body_text(body_text: str) -> List[Dict]:
    """
    Smartpal's scrapeTicketDetails comment extraction, ported to Python.

    Smartpal does this in Node.js (not in browser) for reliability.
    We do the same — get body.innerText from browser, parse here in Python.

    Algorithm:
      1. Find "Activity" section in body text
      2. Find all timestamps with TIMESTAMP_RE
      3. For each timestamp:
         - author = last non-empty line before this timestamp (after previous one)
         - message = text after this timestamp until next timestamp
      4. Skip "automatic response" authors
      5. Strip next comment's author from end of message
    """
    comments: List[Dict] = []

    # Find Activity section
    act_start = -1
    for marker in ["\nActivity\n", "\nActivity (", "Activity\n"]:
        idx = body_text.find(marker)
        if idx >= 0:
            act_start = idx + len(marker)
            break

    if act_start < 0:
        return []

    # Activity section ends at "Add a comment"
    act_end = body_text.find("Add a comment", act_start)
    activity_text = body_text[act_start: act_end if act_end >= 0 else len(body_text)].strip()

    if not activity_text:
        return []

    # Find all timestamps
    timestamps = [
        {"text": m.group(), "index": m.start()}
        for m in TIMESTAMP_RE.finditer(activity_text)
    ]

    if not timestamps:
        return []

    for ti, ts_info in enumerate(timestamps):
        # ── Author: last non-empty line before this timestamp ──
        prev_end = (
            timestamps[ti - 1]["index"] + len(timestamps[ti - 1]["text"])
            if ti > 0 else 0
        )
        author_chunk = activity_text[prev_end:ts_info["index"]].strip()
        # Remove "Show X more" artifacts (from expand button)
        author_chunk = re.sub(r'Show\s+\d+\s+more', '', author_chunk).strip()
        author_lines = [l.strip() for l in author_chunk.split('\n') if l.strip()]
        author = author_lines[-1] if author_lines else "Unknown"

        # Skip automatic status change notifications
        if author.lower() in ("automatic response", "system"):
            continue

        # ── Message: text after this timestamp until next ──
        msg_start = ts_info["index"] + len(ts_info["text"])
        msg_end = (
            timestamps[ti + 1]["index"]
            if ti < len(timestamps) - 1
            else len(activity_text)
        )
        raw_msg = activity_text[msg_start:msg_end].strip()

        # Strip next comment's author name from end of message (smartpal does this)
        if ti < len(timestamps) - 1:
            next_chunk = activity_text[
                ts_info["index"] + len(ts_info["text"]):
                timestamps[ti + 1]["index"]
            ].strip()
            next_lines = [l.strip() for l in next_chunk.split('\n') if l.strip()]
            next_author = next_lines[-1] if next_lines else ""
            if next_author and raw_msg.endswith(next_author):
                raw_msg = raw_msg[: -len(next_author)].strip()

        if raw_msg:
            comments.append({
                "author":    author,
                "message":   raw_msg,
                "createdAt": ts_info["text"],
                "images":    [],
                "source":    "jira",
            })

    return comments


def _parse_description_from_body_text(body_text: str) -> str:
    """
    Extract description from body text (smartpal's approach).
    After "Show details" clicked, body text contains:
      "...Hide details\nDescription\n[DESCRIPTION]\nModule\n..."
    """
    desc_marker = "\nDescription\n"
    d_start = body_text.find(desc_marker)
    if d_start < 0:
        return ""
    d_start += len(desc_marker)

    raw_desc = ""
    for end_marker in ["\nModule\n", "\nEnvironment\n", "\nActivity\n", "\nActivity ("]:
        d_end = body_text.find(end_marker, d_start)
        if d_end >= 0:
            raw_desc = body_text[d_start:d_end].strip()
            break

    if not raw_desc:
        # Cap at 3000 chars if no end marker found
        raw_desc = body_text[d_start: min(d_start + 3000, len(body_text))].strip()

    # Strip Jira DOM artifacts left by image rendering
    # e.g. "Open image-20260304-104123.png" or "Open screenshot.png"
    raw_desc = re.sub(r'Open image-[a-zA-Z0-9_.+-]+', '', raw_desc)
    raw_desc = re.sub(r'Open [a-zA-Z0-9_-]+\.(?:png|jpg|jpeg|gif|pdf|docx|xlsx|zip)', '', raw_desc, flags=re.IGNORECASE)
    # Collapse leftover blank lines
    raw_desc = re.sub(r'\n{3,}', '\n\n', raw_desc)

    return raw_desc.strip()


# ─── Detail page scraper (persistent session) ─────────────────────────────────

async def _fetch_detail_on_page(
    page, base_url: str, ticket_url: str, email: str, password: str
) -> Dict:
    """
    Scrape one ticket detail page using an existing browser page.
    Body text returned to Python and parsed here (mirrors smartpal).
    """
    # domcontentloaded — avoids Atlassian analytics 30s networkidle hang
    await page.goto(ticket_url, wait_until="domcontentloaded", timeout=30000)
    await page.wait_for_timeout(2500)

    # Handle session expiry mid-sync
    if "login" in page.url or "auth" in page.url:
        print("[Session] Session expired mid-sync, re-logging in...")
        await _do_login(page, email, password, base_url)
        await page.goto(ticket_url, wait_until="domcontentloaded", timeout=30000)
        await page.wait_for_timeout(2500)

    # ── Expand "Show details" to reveal description ──
    try:
        await page.evaluate("""(function(){
            var b = Array.from(document.querySelectorAll('button')).find(function(x){
                return (x.textContent||'').trim().toLowerCase() === 'show details';
            });
            if(b) b.click();
        })()""")
        await page.wait_for_timeout(1200)
    except Exception:
        pass

    # ── Expand "Show X more" — loop up to 15 times to load full thread ──
    for _ in range(15):
        try:
            clicked = await page.evaluate("""(function(){
                var b = Array.from(document.querySelectorAll('button')).find(function(x){
                    var t = (x.textContent||'').trim().toLowerCase();
                    return t.indexOf('show') >= 0 && t.indexOf('more') >= 0;
                });
                if(b){ b.click(); return true; }
                return false;
            })()""")
            if not clicked:
                break
            await page.wait_for_timeout(1500)
        except Exception:
            break

    # ── Get full body text — to be parsed in Python (smartpal pattern) ──
    body_text: str = await page.evaluate(
        "(function(){ return document.body.innerText || ''; })()"
    )

    # ── DESCRIPTION — parse in Python ──
    description = _parse_description_from_body_text(body_text)

    # ── Extract "raised this on" date from detail page body text ──────────────
    # After "Show details" is clicked, the body text contains:
    #   "AUTHOR raised this on DATE\nHide details\nDescription\n..."
    # This is the customer portal submission time — matches what Jira portal shows
    # as "raised this on", which is more accurate than the list page createdAt.
    _raised_at = None
    try:
        _raised_match = re.search(
            r'raised this on\s+('
            r'\d{1,2}/[A-Za-z]+/\d{2,4}\s+\d{1,2}:\d{2}\s*(?:AM|PM)|'        # 13/Feb/26 5:48 PM  ← NEW
            r'[A-Za-z]+\s+\d{1,2},\s+\d{4},?\s+\d{1,2}:\d{2}\s*(?:AM|PM)|'   # Mar 10, 2026, 6:36 AM
            r'\d{1,2}\s+[A-Za-z]+\s+\d{2,4},?\s+\d{1,2}:\d{2}\s*(?:AM|PM)|'  # 10 Mar 2026, 6:36 AM
            r'(?:Today|Yesterday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+\d{1,2}:\d{2}\s*(?:AM|PM)'
            r')',
            body_text, re.IGNORECASE
        )
        if _raised_match:
            _raised_at = _raised_match.group(1).strip()
            print(f"[Detail] Raised at: {_raised_at!r}")
    except Exception as _re:
        print(f"[Detail] raisedAt extraction error: {_re}")

    # DOM fallback if body text parsing got nothing
    if not description:
        description = await page.evaluate("""(function(){
            var sels = [
                '[data-testid="request-create-form-description"]',
                '.sd-request-description', '.request-description',
                'div[data-field-id="description"] p', '.itsdescription p'
            ];
            for(var i=0; i<sels.length; i++){
                var el = document.querySelector(sels[i]);
                if(el && el.innerText && el.innerText.trim()) return el.innerText.trim();
            }
            return '';
        })()""")

    # ── COMMENTS — Strategy 1: parse body text in Python (BEST, smartpal method) ──
    comments = _parse_comments_from_body_text(body_text)
    strategy_used = 1 if comments else None

    # ── COMMENTS — Strategy 2: DOM activity items (only if Strategy 1 got nothing) ──
    if not comments:
        dom_comments = await page.evaluate("""(function(){
            var results = [];
            var actItems = document.querySelectorAll(
                '[data-testid*="activity-item"],.activity-item,.comment-item,' +
                '[class*="Comment"],[class*="activity"],li[class*="activity"]'
            );
            actItems.forEach(function(item){
                var authorEl = item.querySelector(
                    '[data-testid*="author"],.author,a[href*="profile"],' +
                    '[class*="Author"],[class*="author"] a,span[class*="name"]'
                );
                var msgEl = item.querySelector(
                    '[data-testid*="message"],[data-testid*="body"],.comment-body,' +
                    '[class*="Body"],[class*="message"],[class*="content"],p'
                );
                var timeEl = item.querySelector(
                    'time,[datetime],[data-testid*="time"],.date,[class*="Date"],[class*="time"]'
                );
                var author  = authorEl ? authorEl.innerText.trim() : 'Support Team';
                var message = msgEl    ? msgEl.innerText.trim()    : '';
                var ts      = timeEl
                    ? (timeEl.getAttribute('datetime') || timeEl.innerText.trim())
                    : '';
                var images = Array.from(item.querySelectorAll('img')).map(function(img){
                    return {src:img.src||'', alt:img.alt||'', filename:img.alt||img.title||''};
                }).filter(function(img){
                    return img.src && img.src.length > 10 &&
                           img.src.indexOf('data:') < 0 &&
                           img.src.indexOf('avatar') < 0 &&
                           img.src.indexOf('/icons/') < 0 &&
                           img.src.indexOf('spinner') < 0;
                });
                if(message && message.length > 5 && author.toLowerCase() !== 'automatic response'){
                    results.push({
                        author:author, message:message, createdAt:ts,
                        images:images, source:'jira'
                    });
                }
            });
            return results;
        })()""")
        if dom_comments:
            comments = dom_comments
            strategy_used = 2

    # ── COMMENTS — Strategy 3: generic containers (last resort) ──
    if not comments:
        generic_comments = await page.evaluate("""(function(){
            var results = [];
            var containers = document.querySelectorAll(
                'div[id*="comment"],div[class*="comment"],' +
                'article[class*="comment"],div[class*="Comment"]'
            );
            containers.forEach(function(c){
                var author  = '';
                var message = c.innerText.trim();
                var aEl = c.querySelector('a[href*="user"],[class*="author"]');
                if(aEl) author = aEl.innerText.trim();
                var images = Array.from(c.querySelectorAll('img')).map(function(img){
                    return {src:img.src||'', alt:img.alt||'', filename:img.alt||img.title||''};
                }).filter(function(img){
                    return img.src && img.src.length > 10 &&
                           img.src.indexOf('data:') < 0 &&
                           img.src.indexOf('avatar') < 0;
                });
                if(message && message.length > 10){
                    results.push({
                        author:author||'Support', message:message, createdAt:'',
                        images:images, source:'jira'
                    });
                }
            });
            return results;
        })()""")
        if generic_comments:
            comments = generic_comments
            strategy_used = 3

    # ── IMAGE ENRICHMENT ──
    # Strategy 1 (body text parsing) gives accurate comments but no images,
    # because images aren't in innerText.
    #
    # The OLD approach: scrape images per DOM activity item, match by INDEX.
    # BUG: Jira DOM includes "Automatic response" items (status change notices)
    # that Strategy 1 SKIPS. So DOM index 0 = "Automatic response" but
    # comments[0] = first real comment → indices are off by N.
    #
    # FIX: Scrape images WITH their author name and a text snippet from the DOM,
    # then match to comments by finding the comment whose author appears in the
    # DOM item's text. This is robust regardless of Automatic response count.
    if strategy_used == 1 and comments and not any(c.get("images") for c in comments):
        try:
            item_data = await page.evaluate("""(function(){
                var result = [];
                var actItems = document.querySelectorAll(
                    '[data-testid*="activity-item"],.activity-item,.comment-item,' +
                    '[class*="Comment"],[class*="activity"],li[class*="activity"]'
                );
                actItems.forEach(function(item){
                    var imgs = Array.from(item.querySelectorAll('img')).map(function(img){
                        return {
                            src: img.src||'',
                            alt: img.alt||'',
                            filename: img.alt || img.title || img.src.split('/').pop() || ''
                        };
                    }).filter(function(img){
                        return img.src && img.src.length > 10 &&
                               img.src.indexOf('data:') < 0 &&
                               img.src.indexOf('avatar') < 0 &&
                               img.src.indexOf('/icons/') < 0 &&
                               img.src.indexOf('spinner') < 0 &&
                               img.src.indexOf('requesttype') < 0;
                    });
                    // Only include items that actually have images
                    if(imgs.length > 0){
                        // Get the text of this item to match with our parsed comments
                        var itemText = (item.innerText || '').trim().substring(0, 200);
                        result.push({ text: itemText, images: imgs });
                    }
                });
                return result;
            })()""")

            # Match DOM items (that have images) to parsed comments by author name
            if item_data:
                for dom_item in item_data:
                    item_text_lower = (dom_item.get("text") or "").lower()
                    for c in comments:
                        author_lower = (c.get("author") or "").lower()
                        # Match if author name appears in the DOM item's text
                        # AND comment doesn't already have images
                        if author_lower and author_lower in item_text_lower and not c.get("images"):
                            c["images"] = dom_item["images"]
                            break
        except Exception:
            pass

    # ── DEDUPLICATE comments by author+message key ──
    seen_keys: set = set()
    unique_comments: List[Dict] = []
    for c in comments:
        key = f"{c.get('author','')}|{c.get('message','')[:80]}"
        if key not in seen_keys:
            seen_keys.add(key)
            unique_comments.append(c)
    comments = unique_comments

    # ── REQUEST TYPE ──
    request_type = await page.evaluate("""(function(){
        var labels = Array.from(document.querySelectorAll('dt,.field-label,[data-testid*="label"]'));
        for(var i=0; i<labels.length; i++){
            if((labels[i].innerText||'').toLowerCase().includes('request type')){
                var next = labels[i].nextElementSibling;
                if(next) return next.innerText.trim();
            }
        }
        return null;
    })()""")

    # ── MODULE & ENVIRONMENT — scrape from "Show details" section ──
    # The detail section shows Module and Environment fields after "Hide details" is clicked.
    # We parse them from the body text (already captured above) for reliability.
    # Pattern in body text after "Show details" clicked:
    #   "Module\n<value>\nEnvironment\n<value>\n"
    scraped_module = None
    scraped_environment = None
    try:
        # Parse from body_text (already has the expanded details section)
        mod_match = re.search(r'\nModule\n([^\n]+)\n', body_text)
        if mod_match:
            scraped_module = mod_match.group(1).strip()

        env_match = re.search(r'\nEnvironment\n([^\n]+)\n', body_text)
        if env_match:
            scraped_environment = env_match.group(1).strip()

        # DOM fallback if body text didn't have it
        if not scraped_module or not scraped_environment:
            dom_fields = await page.evaluate("""(function(){
                var result = {module: null, environment: null};
                // Try dt/dd pairs first (most Jira themes)
                var dts = Array.from(document.querySelectorAll('dt,th,.field-label,[data-testid*="label"]'));
                for(var i=0; i<dts.length; i++){
                    var label = (dts[i].innerText||'').trim().toLowerCase();
                    var valEl = dts[i].nextElementSibling;
                    if(!valEl) continue;
                    var val = (valEl.innerText||'').trim();
                    if(label === 'module' && val) result.module = val;
                    if(label === 'environment' && val) result.environment = val;
                }
                // Also try simple field containers
                if(!result.module || !result.environment){
                    var allText = document.body.innerText || '';
                    var mM = allText.match(/\\nModule\\n([^\\n]+)\\n/);
                    var eM = allText.match(/\\nEnvironment\\n([^\\n]+)\\n/);
                    if(mM && !result.module) result.module = mM[1].trim();
                    if(eM && !result.environment) result.environment = eM[1].trim();
                }
                return result;
            })()""")
            if dom_fields.get("module"):
                scraped_module = dom_fields["module"]
            if dom_fields.get("environment"):
                scraped_environment = dom_fields["environment"]
    except Exception as _me:
        pass  # Non-critical — pull_service preserves existing values if None returned

    # ── SHARED WITH ──
    shared_with = await page.evaluate("""(function(){
        var names = [];
        var sections = Array.from(document.querySelectorAll('h3,h4,dt,.field-label'));
        var sec = null;
        for(var i=0; i<sections.length; i++){
            var t = (sections[i].innerText||'').toLowerCase();
            if(t.includes('shared') || t.includes('participant')){
                sec = sections[i].parentElement || sections[i].nextElementSibling;
                break;
            }
        }
        if(sec){
            sec.querySelectorAll('[data-testid*="user"],.user-avatar-item,.participant-item,span[title]')
            .forEach(function(p){
                var n = p.getAttribute('title') || p.innerText.trim();
                if(n && n.length > 1 && names.indexOf(n) < 0) names.push(n);
            });
        }
        return names;
    })()""")

    # ── TICKET-LEVEL ATTACHMENTS via Jira REST API ──────────────────────────
    # ROOT CAUSE: Jira customer portal loads attachment images as blob: URLs
    # via JavaScript (React). The real https:// URLs never appear in the DOM as
    # <img src> attributes — they're fetched by JS and converted to blob: URLs.
    # DOM scraping of <img> tags therefore ALWAYS returns 0 real attachments.
    #
    # CORRECT APPROACH: Call Jira's REST API directly to get the attachment list.
    # The API endpoint:
    #   GET /rest/servicedeskapi/request/{issueKey}/attachment
    # Returns the list of attachments with their real download URLs.
    # We use the same cookies that Playwright saved for authentication.
    #
    # Fallback: if the API call fails, try intercepting the XHR response that
    # the portal page itself makes when loading the attachments panel.
    attachments = []
    # Initialise shared API state used by BOTH attachment and comment fetch blocks.
    # Defined outside try so the comment block can reference them safely even if
    # the attachment block throws before setting them.
    import httpx as _httpx
    import json as _json
    _url_parts = ticket_url.rstrip('/').split('/')
    _issue_key = _url_parts[-1]  # e.g. OZLR-308 from .../portal/477/OZLR-308
    _cookies: dict = {}
    _headers: dict = {}
    try:
        if COOKIES_PATH.exists():
            try:
                _raw = _json.loads(COOKIES_PATH.read_text())
                _cookies = {c["name"]: c["value"] for c in _raw if c.get("name") and c.get("value")}
                print(f"[Detail] Loaded {len(_cookies)} cookies from {COOKIES_PATH}")
            except Exception as _ce:
                print(f"[Detail] Cookie file read error: {_ce}")
        else:
            # DIAGNOSTIC: If this logs every sync, COOKIES_PATH is wrong for your OS.
            # Set env var JIRA_COOKIES_PATH to the correct absolute path:
            #   Windows: JIRA_COOKIES_PATH=C:/tmp/jira-cookies.json  (default)
            #   Linux:   JIRA_COOKIES_PATH=/tmp/jira-cookies.json
            print(f"[Detail] WARNING: Cookie file not found at {COOKIES_PATH} — "
                  f"API calls will be skipped (no attachments, no comments). "
                  f"Set JIRA_COOKIES_PATH env var to fix this.")


        if _cookies and _issue_key:
            _headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Accept": "application/json",
                "Referer": f"{base_url}/",
                "X-Requested-With": "XMLHttpRequest",
                # CRITICAL: Atlassian Service Desk REST API requires these two headers.
                # Without X-ExperimentalApi, /rest/servicedeskapi/* returns 401 even
                # with valid session cookies. X-Atlassian-Token disables XSRF check.
                "X-ExperimentalApi": "opt-in",
                "X-Atlassian-Token": "no-check",
            }

            # ── Strategy A: Service Desk API attachments endpoint ──────────────
            # Returns file attachments uploaded by customer/agents via the portal.
            # Does NOT include images pasted inline into descriptions.
            _seen = set()
            _api_url = f"{base_url}/rest/servicedeskapi/request/{_issue_key}/attachment"
            async with _httpx.AsyncClient(
                follow_redirects=True, timeout=15.0,
                cookies=_cookies, headers=_headers
            ) as _client:
                _resp = await _client.get(_api_url)

            if _resp.status_code == 200:
                _data = _resp.json()
                _values = _data.get("values") or []
                for _att in _values:
                    _links = _att.get("_links") or {}
                    _content_url = _links.get("content") or ""
                    _filename = _att.get("filename") or _att.get("name") or ""
                    _mime = _att.get("mimeType") or ""
                    if _content_url and _content_url not in _seen:
                        if _content_url.startswith("/"):
                            _content_url = f"{base_url}{_content_url}"
                        _seen.add(_content_url)
                        attachments.append({
                            "src":      _content_url,
                            "alt":      _filename,
                            "filename": _filename,
                            "mimeType": _mime,
                        })
                print(f"[Session] API attachments ({_issue_key}): {len(attachments)} found")
            else:
                print(f"[Session] Attachment API {_resp.status_code} for {_issue_key}: {_resp.text[:100]}")

            # ── Strategy B: REST API v2 — ALWAYS called to catch inline images ──
            # Images pasted into the description (inline screenshots) are stored as
            # Jira issue attachments but NOT returned by the servicedeskapi endpoint.
            # /rest/api/2/issue/{key}?fields=attachment returns ALL attachments including
            # inline ones. We merge with Strategy A results, deduplicating by URL.
            _api2_url = f"{base_url}/rest/api/2/issue/{_issue_key}?fields=attachment"
            async with _httpx.AsyncClient(
                follow_redirects=True, timeout=15.0,
                cookies=_cookies, headers=_headers
            ) as _client2:
                _resp2 = await _client2.get(_api2_url)
            if _resp2.status_code == 200:
                _issue_data = _resp2.json()
                _att_list = (_issue_data.get("fields") or {}).get("attachment") or []
                _v2_new = 0
                for _att in _att_list:
                    _content_url = _att.get("content") or ""
                    _filename = _att.get("filename") or ""
                    _mime = _att.get("mimeType") or ""
                    if _content_url and _content_url not in _seen:
                        _seen.add(_content_url)
                        attachments.append({
                            "src":      _content_url,
                            "alt":      _filename,
                            "filename": _filename,
                            "mimeType": _mime,
                        })
                        _v2_new += 1
                if _v2_new:
                    print(f"[Session] API v2 found {_v2_new} extra attachments for {_issue_key} (inline images)")
            else:
                print(f"[Session] API v2 {_resp2.status_code} for {_issue_key}")

    except Exception as _att_err:
        print(f"[Session] Attachment fetch error: {_att_err}")
        attachments = []

    # ── TICKET-LEVEL COMMENTS via Jira REST API ───────────────────────────────
    # This replaces unreliable DOM scraping and "Show more" button clicking.
    # It uses the exact same session cookies we just loaded for attachments.
    #
    # WHY THIS IS BETTER THAN DOM SCRAPING:
    #   • No "Show X more" buttons to click — API returns ALL comments at once
    #   • Perfect ISO 8601 timestamps (not locale-formatted strings)
    #   • Author display names are clean — no regex parsing needed
    #   • Never misses comments due to Atlassian lazy-loading or React hydration
    #
    # ENDPOINT:
    #   GET /rest/servicedeskapi/request/{issueKey}/comment?limit=100
    # Returns: { values: [{ author: {displayName}, body, created: {iso8601} }] }
    # ─────────────────────────────────────────────────────────────────────────
    api_comments = []
    try:
        if _cookies and _issue_key:
            _comment_api_url = f"{base_url}/rest/servicedeskapi/request/{_issue_key}/comment"

            async with _httpx.AsyncClient(
                follow_redirects=True, timeout=15.0,
                cookies=_cookies, headers=_headers
            ) as _client:
                # Fetch up to 100 comments in one shot — no pagination needed for typical tickets
                _resp = await _client.get(f"{_comment_api_url}?limit=100")

            if _resp.status_code == 200:
                _data = _resp.json()
                _values = _data.get("values", [])

                for _c in _values:
                    _author = _c.get("author", {}).get("displayName", "Unknown")
                    _raw_body = _c.get("body", "").strip()

                    # Extract inline image filenames from raw body BEFORE cleaning.
                    # Jira markup tags like !image001.png|thumbnail! reference attachments
                    # we already fetched. Match by filename to build the images[] array.
                    _inline_images = []
                    _img_matches = re.findall(r'!([^!|]+)(?:\|[^!]+)?!', _raw_body)
                    for _img_name in _img_matches:
                        _img_name = _img_name.strip()
                        for _att in attachments:
                            if (_att.get("filename") == _img_name or
                                    _img_name in _att.get("filename", "")):
                                if _att not in _inline_images:
                                    _inline_images.append(_att)

                    _body = _clean_jira_markup(_raw_body)

                    # API returns a perfect ISO 8601 date: "2026-03-04T10:20:30.123+0530"
                    _created_date = _c.get("created", {}).get("iso8601", "")

                    # Skip automated system messages (same filter as DOM strategy)
                    if _author.lower() in ("automatic response", "system") or not _body:
                        continue

                    api_comments.append({
                        "author":    _author,
                        "message":   _body,
                        "createdAt": _created_date,
                        "images":    _inline_images,  # matched from attachments by filename
                        "source":    "jira",
                    })

                print(f"[Session] API comments ({_issue_key}): {len(api_comments)} found")

            elif _resp.status_code == 404:
                # Ticket may not exist in service desk API — fall back to DOM-scraped comments
                print(f"[Session] Comment API 404 for {_issue_key} — using DOM-scraped comments")

            else:
                print(f"[Session] Comment API {_resp.status_code} for {_issue_key} — using DOM-scraped comments")

    except Exception as _comm_err:
        print(f"[Session] Comment API fetch error: {_comm_err}")

    # ── MERGE DOM IMAGES INTO API COMMENTS ──────────────────────────────────
    # API comments = perfect text + author + ISO timestamps (no "Show more" issues)
    # DOM comments = may contain inline screenshot images per chat bubble
    # Strategy: match by author + first 30 chars of message, then copy images across
    if api_comments and comments:
        for api_c in api_comments:
            for dom_c in comments:
                if (dom_c.get("author") == api_c.get("author")
                        and dom_c.get("images")
                        and dom_c.get("message", "")[:30].strip() in api_c.get("message", "")):
                    api_c["images"] = dom_c["images"]
                    break

    # Prefer API comments (complete + accurate); fall back to DOM-scraped if API gave nothing
    final_comments = api_comments if api_comments else comments

    print(
        f"[Session] Done: desc={len(description)}c "
        f"comments={len(final_comments)}(api={len(api_comments)}, dom={len(comments)}, s{strategy_used}) "
        f"attachments={len(attachments)}"
    )

    return {
        "description":  description or "",
        "requestType":  request_type,
        "module":       scraped_module,       # e.g. "Crewing", "PMS / Maintenance"
        "environment":  scraped_environment,  # e.g. "Vessel", "Office", "Both"
        "sharedWith":   shared_with or [],
        "comments":     final_comments or [],
        "attachments":  attachments or [],
        "raisedAt":     _raised_at or "",    # "raised this on" portal submission time
    }


# ─── Persistent session open/close ───────────────────────────────────────────

async def _open_persistent_session(email: str, password: str, base_url: str):
    """
    Open ONE browser, login once.
    Returns session tuple: (playwright_instance, browser, context, page)
    Reused for all fetch_detail_async() calls in a sync run.
    """
    from playwright.async_api import async_playwright

    print("[Jira] Opening persistent browser session...")
    p       = await async_playwright().start()
    browser = await _new_browser(p)
    context = await _new_context(browser)
    page    = await context.new_page()
    page.set_default_timeout(20000)
    page.set_default_navigation_timeout(20000)

    # ── Check if saved session token is still within refreshTimeout ──────────
    # Atlassian's customer.account.session.token JWT has two expiry fields:
    #   exp            = token hard-expiry (won't work after this)
    #   refreshTimeout = API/REST call expiry (REST calls fail after this,
    #                    even if the browser page still loads correctly)
    # We MUST force a fresh login if refreshTimeout has passed, otherwise
    # httpx API calls (attachments, comments) return 401 even with valid cookies.
    _needs_fresh_login = False
    try:
        import json as _jwt_json, base64 as _b64, time as _time
        if COOKIES_PATH.exists():
            _raw_cookies = _jwt_json.loads(COOKIES_PATH.read_text())
            for _ck in _raw_cookies:
                if _ck.get("name") == "customer.account.session.token":
                    _parts = _ck["value"].split(".")
                    if len(_parts) >= 2:
                        _payload = _parts[1] + "=="
                        _decoded = _jwt_json.loads(_b64.b64decode(_payload).decode())
                        _refresh_timeout = _decoded.get("refreshTimeout", 0)
                        _now = _time.time()
                        if _refresh_timeout and _refresh_timeout < _now:
                            _age_hours = (_now - _refresh_timeout) / 3600
                            print(f"[Session] JWT refreshTimeout expired {_age_hours:.1f}h ago — forcing fresh login")
                            _needs_fresh_login = True
                        else:
                            _remaining = (_refresh_timeout - _now) / 3600
                            print(f"[Session] JWT refreshTimeout valid for {_remaining:.1f}h more")
                    break
    except Exception as _jwt_err:
        print(f"[Session] JWT check error: {_jwt_err}")

    await _load_cookies(context)

    # Verify cookie validity — also force login if JWT refreshTimeout expired
    await page.goto(f"{base_url}/servicedesk/customer/portals", wait_until="domcontentloaded")
    await page.wait_for_timeout(2000)

    if "login" in page.url or "auth" in page.url or _needs_fresh_login:
        if _needs_fresh_login and "login" not in page.url:
            print("[Session] Forcing fresh login — JWT refreshTimeout expired (API calls would fail)")
        else:
            print("[Session] Cookies expired — logging in fresh...")
        await _do_login(page, email, password, base_url)
    else:
        print("[Session] Session valid — reusing cookies")
        await _save_cookies(context)

    return (p, browser, context, page)


async def _close_persistent_session(p, browser):
    try:
        await browser.close()
        await p.stop()
    except Exception:
        pass


# ─── PUSH: Submit ticket to Jira ─────────────────────────────────────────────

async def _do_submit_ticket(email: str, password: str, base_url: str, ticket: dict) -> dict:
    from playwright.async_api import async_playwright
    from automation.status_map import map_module, map_environment, get_request_type_id, build_jira_summary

    vessel_name = ticket.get("vesselName") or ""
    summary     = ticket.get("summary", "")
    description = ticket.get("description", "")
    module      = ticket.get("module", "Admin")
    environment = ticket.get("environment", "Vessel")
    priority    = ticket.get("priority", "Minor")

    if vessel_name and summary.upper().startswith(vessel_name.upper()):
        jira_summary = summary
    else:
        jira_summary = build_jira_summary(vessel_name, summary) if vessel_name else summary

    request_type_id = get_request_type_id(priority)
    jira_module     = map_module(module)
    jira_env        = map_environment(environment)

    print(f"[Jira] Submitting: '{jira_summary}' type={request_type_id}")

    async with async_playwright() as p:
        browser = await _new_browser(p)
        context = await _new_context(browser)
        page    = await context.new_page()
        page.set_default_timeout(30000)
        page.set_default_navigation_timeout(60000)

        await _load_cookies(context)

        create_url = f"{base_url}/servicedesk/customer/portal/477/create/{request_type_id}"
        await page.goto(create_url, wait_until="networkidle")
        await page.wait_for_timeout(3000)

        if "login" in page.url or "auth" in page.url:
            await _do_login(page, email, password, base_url)
            await page.goto(create_url, wait_until="networkidle")
            await page.wait_for_timeout(3000)

        await _screenshot(page, "create-form")
        if "login" in page.url:
            raise Exception(f"Still on login: {page.url}")

        # Summary
        summary_el = await page.wait_for_selector('input[name="summary"]', timeout=10000)
        if not summary_el:
            raise Exception("Summary field not found")
        await summary_el.click(click_count=3)
        await summary_el.type(jira_summary, delay=30)

        # Description
        if description:
            for sel in ['div[contenteditable="true"]', '[aria-label="Description"]']:
                try:
                    d = await page.wait_for_selector(sel, timeout=3000)
                    if d:
                        await d.click()
                        await d.type(description, delay=20)
                        break
                except Exception:
                    continue

        # Dropdowns
        await _fill_react_select(page, "#components", jira_module)
        await page.wait_for_timeout(500)
        await _fill_react_select(page, "#customfield_10043", jira_env)
        await page.wait_for_timeout(500)
        await _fill_react_select(page, "#customfield_10002", "No one")
        await page.wait_for_timeout(1000)
        await _screenshot(page, "pre-submit")

        submit_btn = await page.query_selector(
            '[data-testid="request-create-form-submit-button"], button[type="submit"]'
        )
        if not submit_btn:
            await _screenshot(page, "no-submit-btn")
            raise Exception("Submit button not found")

        await submit_btn.click()
        print("[Jira] Submit clicked!")

        try:
            await page.wait_for_navigation(wait_until="networkidle", timeout=30000)
        except Exception:
            pass
        await page.wait_for_timeout(3000)

        if "/create/" in page.url:
            await _screenshot(page, "validation-error")
            raise Exception("Validation failed — still on create page")

        reference, jira_url = await _extract_reference(page, base_url)
        print(f"[Jira] Submitted! Reference: {reference}")
        await browser.close()
        return {"reference": reference, "jiraUrl": jira_url}


# ─── PULL Pass 1: Scrape ticket list ─────────────────────────────────────────

async def _do_scrape_all(email: str, password: str, base_url: str) -> List[Dict]:
    """Scrape all pages of the Jira request list. Returns list of ticket dicts."""
    from playwright.async_api import async_playwright

    async with async_playwright() as p:
        browser = await _new_browser(p)
        context = await _new_context(browser)
        page    = await context.new_page()
        page.set_default_timeout(30000)

        await _load_cookies(context)

        url = f"{base_url}/servicedesk/customer/user/requests?page=1&reporter=all&status=all"
        await page.goto(url, wait_until="networkidle")
        await page.wait_for_timeout(3000)

        if "login" in page.url or "auth" in page.url:
            print("[Jira] Session expired, re-logging in...")
            await _do_login(page, email, password, base_url)
            await page.goto(url, wait_until="networkidle")
            await page.wait_for_timeout(3000)

        all_tickets: List[Dict] = []
        page_num = 1

        while True:
            print(f"[Jira] Scraping list page {page_num}...")
            try:
                await page.wait_for_selector("table tbody tr", timeout=10000)
            except Exception:
                pass
            await page.wait_for_timeout(2000)

            page_tickets = await page.evaluate("""(function() {
                var tickets = [];
                var rows = document.querySelectorAll('table tbody tr');
                rows.forEach(function(row) {
                    var cells = Array.from(row.querySelectorAll('td'));
                    if (cells.length < 4) return;

                    var typeCell    = cells[0];
                    var typeImg     = typeCell ? typeCell.querySelector('img') : null;
                    var requestType = typeImg
                        ? (typeImg.alt||'').trim()
                        : (typeCell ? (typeCell.textContent||'').trim() : null);

                    var refCell = cells[1];
                    var refLink = refCell ? refCell.querySelector('a') : null;
                    var refText = refLink
                        ? (refLink.textContent||'').trim()
                        : (refCell ? (refCell.textContent||'').trim() : '');
                    var refMatch = refText.match(/([A-Z]+-\\d+)/);
                    if (!refMatch) return;
                    var reference = refMatch[1];

                    var summaryCell = cells[2];
                    var summaryLink = summaryCell ? summaryCell.querySelector('a') : null;
                    var summary = summaryLink
                        ? (summaryLink.textContent||'').trim()
                        : (summaryCell ? (summaryCell.textContent||'').trim() : '');

                    var statusCell    = cells[3];
                    var statusLozenge = statusCell
                        ? statusCell.querySelector('[data-test-id="request-details.status-lozenge"] span')
                        : null;
                    var status = statusLozenge
                        ? (statusLozenge.textContent||'').trim()
                        : (statusCell ? (statusCell.textContent||'').trim() : '');

                    var url       = refLink ? refLink.href : null;
                    var requester = cells[5] ? (cells[5].textContent||'').trim() : null;
                    var createdAt = cells[6] ? (cells[6].textContent||'').trim() : null;
                    var updatedAt = cells[7] ? (cells[7].textContent||'').trim() : null;
                    var priority  = cells[8] ? (cells[8].textContent||'').trim() : null;

                    tickets.push({
                        reference:   reference,
                        summary:     summary || refText,
                        status:      status,
                        url:         url,
                        requester:   requester,
                        priority:    priority,
                        createdAt:   createdAt,
                        updatedAt:   updatedAt,
                        requestType: requestType
                    });
                });
                return tickets;
            })()""")

            all_tickets.extend(page_tickets)
            print(f"[Jira] List page {page_num}: {len(page_tickets)} tickets")

            next_btn = await page.query_selector(
                'button[aria-label="Next Page"], a[aria-label="Next Page"]'
            )
            if not next_btn:
                break
            is_disabled = await page.evaluate(
                "(function(btn){ return btn.hasAttribute('disabled') || btn.getAttribute('aria-disabled')==='true'; })",
                next_btn
            )
            if is_disabled or not page_tickets:
                break
            await next_btn.click()
            await page.wait_for_timeout(3000)
            page_num += 1

        await browser.close()
        print(f"[Jira] List scrape complete: {len(all_tickets)} tickets")
        return all_tickets


# ─── Service class ─────────────────────────────────────────────────────────────

class JiraPlaywrightService:

    @property
    def email(self):    return settings.JIRA_EMAIL
    @property
    def password(self): return settings.JIRA_PASSWORD
    @property
    def base_url(self): return settings.JIRA_BASE_URL

    # ── Sync wrappers (for push_service, scheduler) ──────────────────────────
    # These are called from sync/non-async contexts.
    # They spin up a new thread + event loop — NO deadlock with FastAPI's loop.

    def submit_ticket(self, ticket: dict) -> dict:
        """Push one ticket to Jira. Returns {reference, jiraUrl}."""
        print(f"[Jira] submit_ticket: {ticket.get('summary','')[:60]}")
        return _run_in_new_loop(
            _do_submit_ticket(self.email, self.password, self.base_url, ticket)
        )

    def scrape_all_tickets(self) -> list:
        """Scrape full Jira request list (all pages). Returns list of ticket dicts."""
        print("[Jira] scrape_all_tickets...")
        return _run_in_new_loop(
            _do_scrape_all(self.email, self.password, self.base_url)
        )

    # ── Batch detail fetch for pull_service ─────────────────────────────────
    # ROOT CAUSE OF NotImplementedError on Windows:
    #   Playwright's async_playwright().start() calls asyncio.create_subprocess_exec()
    #   which requires a ProactorEventLoop.  FastAPI's uvicorn runs a SelectorEventLoop
    #   on Windows (Python 3.10), so any await of async_playwright() inside the
    #   FastAPI event loop raises:
    #     NotImplementedError: _make_subprocess_transport
    #
    # FIX: Run the ENTIRE browser lifecycle (open → fetch × N → close) inside
    #   _run_in_new_loop(), which spawns a fresh thread.  asyncio.new_event_loop()
    #   on Windows automatically creates a ProactorEventLoop — subprocess works fine.
    #
    # pull_service calls this one method with the full needs_detail list.
    # It blocks (synchronously) until all fetches are done, then returns the map.
    # pull_service awaits it via asyncio.to_thread() so FastAPI stays non-blocking.

    def fetch_all_details_sync(self, needs_detail: list) -> dict:
        """
        Fetch detail pages for ALL tickets in ONE browser session.
        Runs in a dedicated thread with its own ProactorEventLoop.

        Args:
            needs_detail: list of (idx, jt, existing, reason) tuples

        Returns:
            dict mapping reference_key → detail dict
        """
        email    = self.email
        password = self.password
        base_url = self.base_url

        async def _run_all():
            detail_map = {}
            p, browser, context, page = await _open_persistent_session(
                email, password, base_url
            )
            try:
                total = len(needs_detail)
                for i, (idx, jt, existing, reason) in enumerate(needs_detail):
                    ref      = jt.get("reference", "").strip()
                    jira_url = jt.get("url", "")
                    status   = jt.get("status", "").strip()

                    if not jira_url:
                        print(f"[SYNC] [{i+1}/{total}] SKIP {ref} — no URL")
                        detail_map[ref] = {}
                        continue

                    try:
                        print(f"[SYNC] [{i+1}/{total}] {ref} ({reason}) status={status}")
                        detail = await _fetch_detail_on_page(
                            page, base_url, jira_url, email, password
                        )
                        detail_map[ref] = detail
                    except Exception as e:
                        print(f"[SYNC]   FAILED {ref}: {e}")
                        detail_map[ref] = {}
            finally:
                await _close_persistent_session(p, browser)
                print("[Jira] Browser session closed")
            return detail_map

        # NOTE: We do NOT use _run_in_new_loop() here because that has a 600s
        # timeout suited only for list scrape / push.  A full sync of 342 tickets
        # takes ~45 min (7200s).  We manage the thread directly with the correct
        # timeout, and check t.is_alive() to detect a timeout vs normal completion.
        result = {"value": None, "error": None}

        def _thread_fn():
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                result["value"] = loop.run_until_complete(_run_all())
            except Exception as e:
                result["error"] = e
            finally:
                loop.close()

        t = threading.Thread(target=_thread_fn)
        t.start()
        t.join(timeout=7200)   # 2 hours — enough for 342 tickets × ~8s each

        if t.is_alive():
            # Thread is still running after 2 hours — something is badly hung
            raise RuntimeError(
                "fetch_all_details_sync timed out after 7200s — "
                "browser thread is still alive. Check Playwright / network."
            )
        if result["error"]:
            raise result["error"]
        if result["value"] is None:
            raise RuntimeError(
                "fetch_all_details_sync returned None — "
                "browser thread completed but produced no detail_map."
            )
        return result["value"]

    def refresh_cookies_sync(self) -> bool:
        """
        Open a browser, log in to Jira, save fresh cookies, close browser.
        Called by the image proxy on 401 to auto-refresh without a full sync.
        Returns True if cookies were refreshed successfully, False on error.
        """
        email    = self.email
        password = self.password
        base_url = self.base_url

        async def _do_refresh():
            p, browser, context, page = await _open_persistent_session(
                email, password, base_url
            )
            await _close_persistent_session(p, browser)
            return True

        try:
            result = _run_in_new_loop(_do_refresh())
            print("[Playwright] Cookie refresh complete ✓")
            return bool(result)
        except Exception as e:
            print(f"[Playwright] Cookie refresh failed: {e}")
            return False

    # ── Legacy async methods kept for backwards compatibility ────────────────
    # These will raise NotImplementedError on Windows when called from FastAPI.
    # pull_service now uses fetch_all_details_sync() instead.

    async def open_session_async(self):
        return await _open_persistent_session(self.email, self.password, self.base_url)

    async def fetch_detail_async(self, session, ticket_url: str) -> dict:
        _p, _browser, _context, page = session
        return await _fetch_detail_on_page(
            page, self.base_url, ticket_url, self.email, self.password
        )

    async def close_session_async(self, session):
        p, browser, _context, _page = session
        await _close_persistent_session(p, browser)
        print("[Jira] Browser session closed")


# ─── Singleton ────────────────────────────────────────────────────────────────

_service_instance: Optional[JiraPlaywrightService] = None


def get_jira_service() -> JiraPlaywrightService:
    global _service_instance
    if not _service_instance:
        _service_instance = JiraPlaywrightService()
    return _service_instance