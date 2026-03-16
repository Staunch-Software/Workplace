"""
THE PROPER SOLUTION — READ THIS FIRST
======================================

PROBLEM ANALYSIS:
-----------------
Current pull_service.py calls scrape_ticket_detail() for ALL 318 tickets.
scrape_ticket_detail() opens a NEW browser for EACH ticket.
= 318 browser launches × ~8s each = 40+ minutes, many timeouts

PROPER SOLUTION — 3-TIER SYNC STRATEGY:
-----------------------------------------

TIER 1 — FULL SYNC (First time / on-demand)
  - Run ONCE to populate everything
  - Opens 1 browser, visits ALL ticket detail pages
  - Gets description, full comment thread, attachments
  - Uses domcontentloaded (fast) instead of networkidle (causes timeouts)
  - Marks each ticket with: detailFetchedAt = now

TIER 2 — INCREMENTAL SYNC (Every 30 mins auto / manual)
  - Only fetches detail for tickets WHERE:
      a) It's a NEW ticket (never seen before)
      b) jiraUpdatedAt changed since last sync (Jira timestamp changed = new comment)
      c) Status changed
  - Skips tickets where nothing changed
  - Result: from 318 fetches → typically 0-10 fetches per sync

TIER 3 — STATUS-ONLY (For closed/cancelled/resolved with no changes)
  - No browser needed
  - Just updates jiraStatus in MongoDB directly
  - Pure DB write, instant

HOW THIS SCALES:
  Today:  318 tickets → Full sync ~15-20 mins (one time), incremental ~1-2 mins
  Future: 500 tickets → Full sync ~25 mins (one time), incremental still ~1-2 mins
  Future: 1000 tickets → Full sync ~45 mins (one time), incremental still ~1-2 mins

FILES TO REPLACE:
  backend/automation/pull_service.py     ← Replace entirely
  backend/automation/playwright_service.py ← Add persistent session methods

RUN THIS SCRIPT:
  cd C:\\Users\\Deepalakshmi\\Desktop\\ozellar-portal\\backend
  python write_proper_solution.py

AFTER RUNNING:
  1. Restart uvicorn
  2. Click "Sync with Jira" — this runs INCREMENTAL sync by default
  3. For FULL sync (first time), call: POST /api/jira/sync?full=true
     OR add ?full=true to your sync button temporarily
"""

import os

BASE = os.path.dirname(os.path.abspath(__file__))

# =============================================================================
# FILE 1: pull_service.py  (complete replacement)
# =============================================================================

PULL_SERVICE = r'''
"""
Jira → MongoDB sync service.

TWO MODES:
  full_sync=False (default) — INCREMENTAL: only fetch details for changed/new tickets
  full_sync=True            — FULL: fetch details for ALL tickets (run once to populate)
"""
import re
from datetime import datetime, timedelta
from db.mongodb import get_db
from automation.playwright_service import get_jira_service
from automation.status_map import detect_vessel_from_text, extract_reference_num, KNOWN_VESSELS


def _parse_jira_date(date_str):
    """Parse Jira date strings like '02/Mar/26', 'Today', 'Yesterday' into datetime."""
    if not date_str:
        return None
    s = date_str.strip()
    now = datetime.utcnow()
    if s.lower() == "today":
        return datetime(now.year, now.month, now.day)
    if s.lower() == "yesterday":
        return datetime(now.year, now.month, now.day) - timedelta(days=1)
    match = re.match(r"^(\d{1,2})[\s/]+([A-Za-z]+)[\s/]+(\d{2,4})$", s)
    if match:
        day, month_str, year_str = match.groups()
        months = {"jan":1,"feb":2,"mar":3,"apr":4,"may":5,"jun":6,
                  "jul":7,"aug":8,"sep":9,"oct":10,"nov":11,"dec":12}
        month_num = months.get(month_str.lower()[:3])
        year = int(year_str)
        if year < 100:
            year += 2000
        if month_num:
            return datetime(year, month_num, int(day))
    try:
        return datetime.fromisoformat(s)
    except Exception:
        return None


def _needs_detail_fetch(existing: dict, jira_list_item: dict, full_sync: bool) -> tuple:
    """
    Decide if we need to visit the detail page for this ticket.
    Returns: (need_fetch: bool, reason: str)
    """
    # Full sync mode: fetch everything
    if full_sync:
        return True, "full_sync"

    # New ticket never seen in our DB
    if existing is None:
        return True, "new_ticket"

    # Never had detail fetched before
    if not existing.get("detailFetchedAt"):
        return True, "never_fetched"

    # Status changed since last sync
    old_status = (existing.get("jiraStatus") or "").strip()
    new_status = (jira_list_item.get("status") or "").strip()
    if old_status.lower() != new_status.lower():
        return True, f"status_changed({old_status}→{new_status})"

    # Jira updatedAt timestamp changed (means new comment or edit happened)
    jira_updated = jira_list_item.get("updatedAt") or ""
    our_updated  = existing.get("jiraUpdatedAt")
    if jira_updated:
        parsed_jira_updated = _parse_jira_date(jira_updated)
        if parsed_jira_updated and our_updated:
            # If Jira shows a newer update time, fetch
            if isinstance(our_updated, datetime):
                if parsed_jira_updated > our_updated:
                    return True, "jira_updated_at_changed"
            else:
                return True, "jira_updated_at_type_mismatch"

    # Nothing changed — skip detail fetch
    return False, "no_changes"


def _build_comments(raw_comments: list, existing_comments: list) -> list:
    """
    Build final comment list:
    - Jira comments from fresh scrape
    - Portal comments (added by our users) preserved at the end
    """
    jira_comments = []
    for c in raw_comments:
        author  = (c.get("author") or "Jira User").strip()
        message = (c.get("message") or "").strip()
        if not message:
            continue
        if author.lower() in ("automatic response", "system"):
            continue
        jira_comments.append({
            "author":    author,
            "message":   message,
            "createdAt": c.get("createdAt") or datetime.utcnow().isoformat(),
            "images":    c.get("images", []),
            "source":    "jira",
        })

    # Preserve comments added via our portal (not from Jira)
    portal_comments = [c for c in (existing_comments or []) if c.get("source") == "portal"]

    # Jira comments first, then portal comments (chronological order)
    return jira_comments + portal_comments


async def pull_jira_updates(full_sync: bool = False) -> dict:
    """
    Main sync function.

    full_sync=False → INCREMENTAL (default, fast, runs every 30 mins)
      - Fetches detail only for new/changed tickets
      - Typically 0-20 detail fetches per run

    full_sync=True  → FULL (slow, run once to populate everything)
      - Fetches detail for every ticket
      - Run once after deployment, then switch back to incremental
    """
    db      = get_db()
    service = get_jira_service()
    mode    = "FULL" if full_sync else "INCREMENTAL"

    print(f"\n{'='*60}")
    print(f"[SYNC] Starting {mode} sync at {datetime.utcnow().strftime('%H:%M:%S')}")
    print(f"{'='*60}")

    # ── STEP 1: Scrape Jira ticket list (all pages, no browser reuse needed) ──
    print("[SYNC] Scraping Jira ticket list...")
    jira_tickets = service.scrape_all_tickets()
    total = len(jira_tickets)
    print(f"[SYNC] Got {total} tickets from Jira")

    # ── STEP 2: Load all existing tickets from MongoDB in ONE query ───────────
    all_refs = [jt.get("reference","").strip() for jt in jira_tickets if jt.get("reference")]
    existing_map = {}
    async for t in db["tickets"].find({"reference": {"$in": all_refs}}):
        existing_map[t.get("reference","")] = t
    print(f"[SYNC] Found {len(existing_map)} existing tickets in MongoDB")

    # ── STEP 3: Decide what needs detail fetch ────────────────────────────────
    needs_detail = []    # (idx, jira_ticket, existing, reason)
    no_detail    = []    # (idx, jira_ticket, existing, reason)

    for idx, jt in enumerate(jira_tickets):
        ref = jt.get("reference","").strip()
        if not ref:
            continue
        existing = existing_map.get(ref)
        fetch, reason = _needs_detail_fetch(existing, jt, full_sync)
        if fetch:
            needs_detail.append((idx, jt, existing, reason))
        else:
            no_detail.append((idx, jt, existing, reason))

    print(f"[SYNC] Need detail fetch: {len(needs_detail)} tickets")
    print(f"[SYNC] Skip detail fetch: {len(no_detail)} tickets (no changes)")

    # ── STEP 4: Fetch details using ONE persistent browser session ────────────
    detail_results = {}  # reference → detail dict

    if needs_detail:
        print(f"\n[SYNC] Opening browser session for {len(needs_detail)} detail fetches...")
        session = service.open_session()
        try:
            for i, (idx, jt, existing, reason) in enumerate(needs_detail):
                ref      = jt.get("reference","").strip()
                jira_url = jt.get("url","")
                status   = jt.get("status","").strip()

                if not jira_url:
                    print(f"[SYNC] [{i+1}/{len(needs_detail)}] SKIP {ref} — no URL")
                    continue

                try:
                    print(f"[SYNC] [{i+1}/{len(needs_detail)}] Fetching {ref} ({reason}) status={status}")
                    detail = service.fetch_detail(session, jira_url)
                    detail_results[ref] = detail
                    ccount = len(detail.get("comments", []))
                    desc   = bool(detail.get("description"))
                    atts   = len(detail.get("attachments", []))
                    print(f"[SYNC]   → comments={ccount} desc={desc} attachments={atts}")
                except Exception as e:
                    print(f"[SYNC]   → FAILED: {e}")
                    detail_results[ref] = {}
        finally:
            try:
                service.close_session(session)
                print("[SYNC] Browser session closed")
            except Exception:
                pass
    else:
        print("[SYNC] No detail fetches needed — all tickets up to date!")

    # ── STEP 5: Save everything to MongoDB ────────────────────────────────────
    print(f"\n[SYNC] Saving to MongoDB...")
    updated = created = skipped = 0
    errors  = []
    now     = datetime.utcnow()

    for idx, jt in enumerate(jira_tickets):
        ref = jt.get("reference","").strip()
        if not ref:
            skipped += 1
            continue

        jira_status = jt.get("status","").strip()
        summary     = jt.get("summary","").strip()
        jira_url    = jt.get("url","")
        created_at  = _parse_jira_date(jt.get("createdAt"))
        updated_at  = _parse_jira_date(jt.get("updatedAt"))
        vessel_name = detect_vessel_from_text(summary)
        existing    = existing_map.get(ref)

        clean_summary = summary
        if vessel_name and summary.upper().startswith(vessel_name.upper()):
            clean_summary = re.sub(
                rf"^{re.escape(vessel_name)}\s*[-:]\s*",
                "", summary, flags=re.IGNORECASE
            ).strip()

        # Base update — always applied
        update_data = {
            "jiraStatus":           jira_status,
            "jiraUrl":              jira_url,
            "jiraSortOrder":        idx,
            "lastSyncedAt":         now,
            "updatedAt":            now,
            "jiraSubmissionStatus": "SYNCED",
        }
        if created_at:  update_data["jiraCreatedAt"] = created_at
        if updated_at:  update_data["jiraUpdatedAt"] = updated_at
        if vessel_name: update_data["vesselName"]    = vessel_name

        # Apply detail data if we fetched it
        detail = detail_results.get(ref)
        if detail is not None:
            update_data["detailFetchedAt"] = now  # Mark that detail was fetched

            if detail.get("description"):
                update_data["description"] = detail["description"]

            if detail.get("requestType"):
                update_data["requestType"] = detail["requestType"]

            if detail.get("sharedWith"):
                update_data["sharedWith"] = detail["sharedWith"]

            if detail.get("attachments"):
                update_data["attachments"] = detail["attachments"]

            raw_comments     = detail.get("comments", [])
            existing_comments = (existing or {}).get("comments", [])
            final_comments   = _build_comments(raw_comments, existing_comments)
            if final_comments:
                update_data["comments"] = final_comments

        try:
            if existing:
                await db["tickets"].update_one(
                    {"reference": ref},
                    {"$set": update_data}
                )
                updated += 1
            else:
                new_doc = {
                    "reference":       ref,
                    "referenceNum":    extract_reference_num(ref),
                    "summary":         clean_summary,
                    "description":     update_data.get("description", ""),
                    "module":          "Admin",
                    "environment":     "Vessel",
                    "priority":        "Minor",
                    "status":          "SUP IN PROGRESS",
                    "vesselName":      vessel_name,
                    "requester":       jt.get("requester") or "",
                    "attachments":     update_data.get("attachments", []),
                    "sharedWith":      update_data.get("sharedWith", []),
                    "comments":        update_data.get("comments", []),
                    "detailFetchedAt": update_data.get("detailFetchedAt"),
                    "createdAt":       created_at or now,
                    **update_data,
                }
                await db["tickets"].insert_one(new_doc)
                created += 1
        except Exception as e:
            errors.append(f"{ref}: {str(e)}")
            print(f"[SYNC] DB error {ref}: {e}")

    print(f"\n{'='*60}")
    print(f"[SYNC] {mode} SYNC COMPLETE")
    print(f"[SYNC] Total tickets: {total}")
    print(f"[SYNC] Detail fetched: {len(detail_results)} | Skipped: {len(no_detail)}")
    print(f"[SYNC] DB — Updated: {updated} | Created: {created} | Errors: {len(errors)}")
    print(f"{'='*60}\n")

    return {
        "mode":          mode,
        "totalScraped":  total,
        "detailFetched": len(detail_results),
        "detailSkipped": len(no_detail),
        "updated":       updated,
        "created":       created,
        "skipped":       skipped,
        "errors":        errors,
    }
'''

# =============================================================================
# FILE 2: Additions to playwright_service.py
# (persistent session: open_session / fetch_detail / close_session)
# =============================================================================

PERSISTENT_SESSION_CODE = r'''

# ─── Persistent browser session for batch detail fetching ────────────────────
# One browser, one login, reused for all tickets in a sync run.

async def _open_persistent_session(email, password, base_url):
    """Open ONE browser and login. Returns session = (playwright, browser, context, page)."""
    from playwright.async_api import async_playwright

    p       = await async_playwright().start()
    browser = await _new_browser(p)
    context = await _new_context(browser)
    page    = await context.new_page()
    page.set_default_timeout(20000)
    page.set_default_navigation_timeout(20000)

    await _load_cookies(context)

    # Check if cookies are still valid
    await page.goto(f"{base_url}/servicedesk/customer/portals", wait_until="domcontentloaded")
    await page.wait_for_timeout(2000)

    if "login" in page.url or "auth" in page.url:
        print("[Session] Cookies expired, logging in fresh...")
        await _do_login(page, email, password, base_url)
    else:
        print("[Session] Session valid — reusing cookies")

    return (p, browser, context, page)


async def _fetch_detail_persistent(page, base_url, ticket_url, email, password):
    """
    Scrape a single ticket detail page using an already-open browser page.
    Uses domcontentloaded = fast. No 30s timeouts from Atlassian analytics.
    """
    # Navigate to ticket
    await page.goto(ticket_url, wait_until="domcontentloaded")
    await page.wait_for_timeout(2000)

    # Handle session expiry mid-sync
    if "login" in page.url or "auth" in page.url:
        print(f"[Session] Session expired mid-sync, re-logging in...")
        await _do_login(page, email, password, base_url)
        await page.goto(ticket_url, wait_until="domcontentloaded")
        await page.wait_for_timeout(2000)

    # Expand "Show details" section
    try:
        await page.evaluate("""(function(){
            var b = Array.from(document.querySelectorAll('button')).find(function(x){
                return (x.textContent||'').trim().toLowerCase() === 'show details';
            });
            if(b) b.click();
        })()""")
        await page.wait_for_timeout(1000)
    except Exception:
        pass

    # Expand all "Show X more" to load full comment thread
    for _ in range(10):
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

    # ── DESCRIPTION ──────────────────────────────────────────────────────────
    description = await page.evaluate("""
        (function(){
            var selectors = [
                '[data-testid="request-create-form-description"]',
                '.sd-request-description', '.request-description',
                'div[data-field-id="description"] p', '.itsdescription p',
            ];
            for(var i=0;i<selectors.length;i++){
                var el = document.querySelector(selectors[i]);
                if(el && el.innerText && el.innerText.trim()) return el.innerText.trim();
            }
            var bodyText = document.body.innerText || '';
            var descMarker = '\\nDescription\\n';
            var dStart = bodyText.indexOf(descMarker);
            if(dStart >= 0){
                dStart += descMarker.length;
                var dEnd = bodyText.indexOf('\\nModule\\n', dStart);
                if(dEnd < 0) dEnd = bodyText.indexOf('\\nActivity\\n', dStart);
                if(dEnd < 0) dEnd = Math.min(dStart + 3000, bodyText.length);
                return bodyText.substring(dStart, dEnd).trim();
            }
            return '';
        })()
    """)

    # ── REQUEST TYPE ──────────────────────────────────────────────────────────
    request_type = await page.evaluate("""
        (function(){
            var labels = Array.from(document.querySelectorAll('dt,.field-label,[data-testid*="label"]'));
            for(var i=0;i<labels.length;i++){
                if((labels[i].innerText||'').toLowerCase().includes('request type')){
                    var next = labels[i].nextElementSibling;
                    if(next) return next.innerText.trim();
                }
            }
            return null;
        })()
    """)

    # ── SHARED WITH ───────────────────────────────────────────────────────────
    shared_with = await page.evaluate("""
        (function(){
            var names = [];
            var sections = Array.from(document.querySelectorAll('h3,h4,dt,.field-label'));
            var sec = null;
            for(var i=0;i<sections.length;i++){
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
                    if(n && n.length>1 && names.indexOf(n)<0) names.push(n);
                });
            }
            return names;
        })()
    """)

    # ── COMMENTS — All 3 strategies ───────────────────────────────────────────
    raw_comments = await page.evaluate("""
        (function(){
            var results = [];

            // ── Strategy 1: Structured activity list items ────────────────
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
                var ts      = timeEl   ? (timeEl.getAttribute('datetime') || timeEl.innerText.trim()) : '';

                // Collect embedded images (attachments in comments)
                var images = Array.from(item.querySelectorAll('img')).map(function(img){
                    return {src:img.src||'',alt:img.alt||'',filename:img.alt||img.title||''};
                }).filter(function(img){
                    return img.src && img.src.length>10 &&
                           img.src.indexOf('data:')<0 &&
                           img.src.indexOf('avatar')<0 &&
                           img.src.indexOf('/icons/')<0 &&
                           img.src.indexOf('spinner')<0;
                });

                if(message && message.length>5 && author.toLowerCase()!=='automatic response'){
                    results.push({author:author, message:message, createdAt:ts, images:images});
                }
            });

            // ── Strategy 2: Generic comment containers ────────────────────
            if(results.length === 0){
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
                        return {src:img.src||'',alt:img.alt||'',filename:img.alt||img.title||''};
                    }).filter(function(img){
                        return img.src&&img.src.length>10&&
                               img.src.indexOf('data:')<0&&img.src.indexOf('avatar')<0;
                    });
                    if(message && message.length>10){
                        results.push({author:author||'Support',message:message,createdAt:'',images:images});
                    }
                });
            }

            // ── Strategy 3: Timestamp-based text parsing (most reliable) ──
            if(results.length === 0){
                var bodyText = document.body.innerText || '';
                var actStart = bodyText.indexOf('\\nActivity\\n');
                var actEnd   = bodyText.indexOf('Add a comment');
                if(actStart >= 0){
                    var actText = bodyText.substring(
                        actStart + '\\nActivity\\n'.length,
                        actEnd >= 0 ? actEnd : bodyText.length
                    ).trim();

                    var timePat = /(Today|Yesterday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|\\d{1,2}\\s+[A-Za-z]+\\s+\\d{2,4})\\s+\\d{1,2}:\\d{2}\\s*(AM|PM)/gi;
                    var matches = [];
                    var m;
                    while((m = timePat.exec(actText)) !== null){
                        matches.push({text:m[0], index:m.index});
                    }

                    matches.forEach(function(ts, ti){
                        var prevEnd = ti===0 ? 0 : matches[ti-1].index + matches[ti-1].text.length;
                        var authorChunk = actText.substring(prevEnd, ts.index).trim()
                            .replace(/Show\\s+\\d+\\s+more/g,'').trim();
                        var authorLines = authorChunk.split('\\n')
                            .map(function(l){return l.trim();}).filter(Boolean);
                        var author = authorLines.length>0 ? authorLines[authorLines.length-1] : 'Unknown';
                        if(author.toLowerCase() === 'automatic response') return;

                        var msgStart = ts.index + ts.text.length;
                        var msgEnd   = ti < matches.length-1 ? matches[ti+1].index : actText.length;
                        var rawMsg   = actText.substring(msgStart, msgEnd).trim();

                        if(ti < matches.length-1){
                            var nextLines = actText.substring(msgStart, matches[ti+1].index).trim()
                                .split('\\n').map(function(l){return l.trim();}).filter(Boolean);
                            var nextAuthor = nextLines.length>0 ? nextLines[nextLines.length-1] : '';
                            if(nextAuthor && rawMsg.endsWith(nextAuthor)){
                                rawMsg = rawMsg.slice(0, rawMsg.length - nextAuthor.length).trim();
                            }
                        }
                        if(rawMsg.length > 0){
                            results.push({author:author, message:rawMsg, createdAt:ts.text, images:[]});
                        }
                    });
                }
            }

            // De-duplicate by author+message key
            var seen = {};
            return results.filter(function(r){
                var key = r.author + '|' + r.message.substring(0,80);
                if(seen[key]) return false;
                seen[key] = true;
                return true;
            });
        })()
    """)

    # ── ATTACHMENTS (all images on the page from Jira) ────────────────────────
    ticket_attachments = await page.evaluate("""
        (function(){
            var atts = [];
            var seen = new Set();
            Array.from(document.querySelectorAll('img')).forEach(function(img){
                var src = img.src || '';
                if(src && !seen.has(src) &&
                   src.indexOf('data:')<0 && src.indexOf('avatar')<0 &&
                   src.indexOf('/icons/')<0 && src.indexOf('spinner')<0 &&
                   (src.indexOf('attachment')>=0 || src.indexOf('secure')>=0 ||
                    src.indexOf('atlassian.net')>=0) && src.length>20){
                    seen.add(src);
                    atts.push({
                        src:      src,
                        alt:      img.alt||'',
                        filename: img.alt || img.title || src.split('/').pop() || ''
                    });
                }
            });
            return atts;
        })()
    """)

    return {
        "description":  description or "",
        "requestType":  request_type,
        "sharedWith":   shared_with or [],
        "comments":     raw_comments or [],
        "attachments":  ticket_attachments or [],
    }


async def _close_persistent_session(p, browser):
    try:
        await browser.close()
        await p.stop()
    except Exception:
        pass

'''

NEW_SERVICE_METHODS = '''
    def open_session(self):
        """
        Open ONE browser session for batch detail fetching.
        Login once and reuse the page for all tickets in a sync run.
        Returns session tuple: (playwright, browser, context, page)
        """
        print("[Jira] Opening persistent browser session...")
        return _run_in_new_loop(
            _open_persistent_session(self.email, self.password, self.base_url)
        )

    def fetch_detail(self, session, ticket_url: str) -> dict:
        """
        Fetch ticket detail using an already-open browser session.
        Fast: domcontentloaded, no 30s timeouts.
        Returns: {description, requestType, sharedWith, comments, attachments}
        """
        p, browser, context, page = session
        result = _run_in_new_loop(
            _fetch_detail_persistent(page, self.base_url, ticket_url, self.email, self.password)
        )
        return result or {}

    def close_session(self, session):
        """Close the persistent browser session cleanly."""
        p, browser, context, page = session
        _run_in_new_loop(_close_persistent_session(p, browser))
        print("[Jira] Browser session closed")
'''


def write_files():
    # ── 1. Write pull_service.py ──────────────────────────────────────────────
    pull_path = os.path.join(BASE, "automation", "pull_service.py")
    with open(pull_path, "w", encoding="utf-8") as f:
        f.write(PULL_SERVICE)
    print(f"✅ Written: {pull_path}")

    # ── 2. Patch playwright_service.py ────────────────────────────────────────
    ps_path = os.path.join(BASE, "automation", "playwright_service.py")
    with open(ps_path, "r", encoding="utf-8") as f:
        content = f.read()

    # Remove old persistent session functions if they exist (avoid duplicates)
    for fn_marker in [
        "async def _open_persistent_session(",
        "async def _fetch_detail_persistent(",
        "async def _close_persistent_session(",
        "async def _open_session(",
        "async def _fetch_detail_in_session(",
        "async def _close_session(",
    ]:
        if fn_marker in content:
            start = content.find(fn_marker)
            # Find end of this function (next top-level async def or class)
            candidates = []
            for marker in ["async def ", "\nclass ", "\n_service_instance"]:
                idx = content.find(marker, start + len(fn_marker))
                if idx > 0:
                    candidates.append(idx)
            end = min(candidates) if candidates else len(content)
            content = content[:start] + content[end:]
            print(f"  Removed old: {fn_marker}")

    # Remove old session methods from class body
    for method_marker in [
        "    def open_session(",
        "    def fetch_detail(",
        "    def close_session(",
        "    def open_detail_session(",
        "    def fetch_detail_in_session(",
        "    def close_detail_session(",
    ]:
        if method_marker in content:
            start = content.find(method_marker)
            end = content.find("\n    def ", start + len(method_marker))
            if end < 0:
                end = content.find("\n_service_instance", start)
            if end < 0:
                end = len(content)
            content = content[:start] + content[end:]
            print(f"  Removed old method: {method_marker.strip()}")

    # Fix networkidle → domcontentloaded in _do_scrape_detail only
    if "async def _do_scrape_detail(" in content:
        start = content.find("async def _do_scrape_detail(")
        # Find next top-level function
        end = content.find("\nasync def _do_", start + 10)
        if end < 0:
            end = content.find("\nclass ", start)
        if end < 0:
            end = len(content)
        section = content[start:end]
        # Replace networkidle with domcontentloaded
        section_fixed = section.replace('wait_until="networkidle"', 'wait_until="domcontentloaded"')
        section_fixed = section_fixed.replace("wait_until='networkidle'", "wait_until='domcontentloaded'")
        content = content[:start] + section_fixed + content[end:]
        print("✅ Fixed networkidle → domcontentloaded in _do_scrape_detail")

    # Insert new async functions BEFORE class definition
    class_marker = "class JiraPlaywrightService:"
    if class_marker in content and "_open_persistent_session" not in content:
        content = content.replace(class_marker, PERSISTENT_SESSION_CODE + "\n\n" + class_marker)
        print("✅ Inserted persistent session async functions")

    # Insert new methods INSIDE class, before _service_instance
    instance_marker = "\n_service_instance"
    if instance_marker in content and "def open_session(" not in content:
        content = content.replace(instance_marker, NEW_SERVICE_METHODS + instance_marker)
        print("✅ Inserted session methods into JiraPlaywrightService class")

    with open(ps_path, "w", encoding="utf-8") as f:
        f.write(content)
    print(f"✅ Patched: {ps_path}")

    # ── 3. Patch jira router to support full sync ─────────────────────────────
    jira_router = os.path.join(BASE, "routers", "jira.py")
    if os.path.exists(jira_router):
        with open(jira_router, "r", encoding="utf-8") as f:
            jira_content = f.read()

        # Add full_sync query param if not present
        if "full_sync" not in jira_content and "pull_jira_updates" in jira_content:
            jira_content = jira_content.replace(
                "async def sync_jira(",
                'async def sync_jira(full: bool = False, '
            )
            jira_content = jira_content.replace(
                "pull_jira_updates()",
                "pull_jira_updates(full_sync=full)"
            )
            with open(jira_router, "w", encoding="utf-8") as f:
                f.write(jira_content)
            print(f"✅ Patched jira router: added ?full=true support")

    print()
    print("=" * 65)
    print("  ALL FILES WRITTEN SUCCESSFULLY!")
    print()
    print("  SYNC BEHAVIOR:")
    print()
    print("  ┌─ FIRST TIME / FULL SYNC ──────────────────────────────┐")
    print("  │  POST /api/jira/sync?full=true                         │")
    print("  │  Fetches detail for ALL tickets (300+)                 │")
    print("  │  Time: ~15-25 mins (domcontentloaded, 1 browser)       │")
    print("  │  Run once after deployment                             │")
    print("  └────────────────────────────────────────────────────────┘")
    print()
    print("  ┌─ INCREMENTAL SYNC (every 30 mins / manual button) ────┐")
    print("  │  POST /api/jira/sync  (no params)                      │")
    print("  │  Only fetches detail for:                              │")
    print("  │    - NEW tickets (never seen before)                   │")
    print("  │    - Tickets where Jira updatedAt changed              │")
    print("  │    - Tickets where status changed                      │")
    print("  │  Typical: 0-10 fetches per run                         │")
    print("  │  Time: 30 seconds - 2 minutes                          │")
    print("  └────────────────────────────────────────────────────────┘")
    print()
    print("  STEPS:")
    print("  1. Restart uvicorn")
    print("  2. Run full sync once:  POST /api/jira/sync?full=true")
    print("     (use curl or the Sync button — add ?full=true in jira.py)")
    print("  3. After full sync, normal button auto-does incremental")
    print("=" * 65)


if __name__ == "__main__":
    write_files()