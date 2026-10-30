# Run the "new logbook event" mail check right now.
#   python send_events_mail.py                                                    (mail only vessels with a new event)
#   python send_events_mail.py --to techdevops@ozellar.com --force                (test: send every vessel's latest to one address)
#   python send_events_mail.py --dry-run --preview out.html                       (render only, nothing sent)
import argparse
import asyncio
import logging
from datetime import date

from app.services.events_mail_service import send_new_event_mails

logging.basicConfig(level=logging.INFO)

ap = argparse.ArgumentParser()
ap.add_argument("--to", default="", help="redirect every mail to this address (test mode, ignores new-event check)")
ap.add_argument("--force", action="store_true", help="send even when the vessel has no new event (state is not updated)")
ap.add_argument("--end-date", default="", help="YYYY-MM-DD, last event day to show (default: today)")
ap.add_argument("--dry-run", action="store_true", help="build but do not send")
ap.add_argument("--preview", default="", help="write the first mail's HTML to this file")
args = ap.parse_args()

res = asyncio.run(send_new_event_mails(args.to, args.dry_run, args.force, date.fromisoformat(args.end_date) if args.end_date else None))
if args.preview and res.get("previews"):
    with open(args.preview, "w", encoding="utf-8") as f:
        f.write(res["previews"][0][1])
print({k: v for k, v in res.items() if k != "previews"})
