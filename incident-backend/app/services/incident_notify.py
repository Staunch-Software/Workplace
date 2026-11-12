"""Who gets told what: the notification bell and the activity feed of the Incident module.

Called after the action that caused it has been committed. Telling people must never undo or fail the action, so
every public function here swallows and logs its own errors.

Audience of an incident: the person who created it plus everyone who has written in its chat, limited to people who
still have access to the module. People tagged with @ always get a MENTION. Nobody is told about their own action.
"""
import logging
import uuid
from typing import Iterable

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.incident import Incident, IncidentFeedEvent, IncidentNotification, IncidentThread

logger = logging.getLogger(__name__)

SNIPPET = 140
FILE_LABELS = {"REPORT": "report attachment", "SOF": "SOF file", "LOG": "alarm/event log file", "PHOTO": "photo"}


def snippet(body: str, has_files: bool = False) -> str:
    body = " ".join((body or "").split())
    if not body:
        return "sent an attachment" if has_files else ""
    return body if len(body) <= SNIPPET else body[:SNIPPET - 1] + "…"


def incident_link(incident_id) -> str:
    return f"?open={incident_id}"


def where(incident: Incident) -> str:
    return f"{incident.incident_no} · {incident.vessel_name}"


def files_phrase(kind: str, count: int) -> str:
    label = FILE_LABELS.get(kind, "file")
    return f"{count} {label}{'' if count == 1 else 's'}"


async def module_users(control_db: AsyncSession) -> list[dict]:
    """People assigned to the module: active shore/admin users who have Incident Reports switched on for them.

    One definition for everything that picks people: the @ list in the chat, who can be tagged, and who is notified.
    An admin who was never assigned to the module is not listed, even though an admin can open it."""
    rows = await control_db.execute(text("""
        SELECT u.id, u.full_name, u.role FROM users u
        WHERE u.is_active AND u.role IN ('ADMIN', 'SHORE')
          AND COALESCE(u.permissions ->> 'incident_report', 'false') = 'true'
    """))
    return [{"id": uid, "name": name, "role": role} for uid, name, role in rows.fetchall()]


async def module_user_ids(control_db: AsyncSession) -> set[uuid.UUID]:
    return {u["id"] for u in await module_users(control_db)}


async def audience_of(db: AsyncSession, control_db: AsyncSession, incident: Incident) -> set[uuid.UUID]:
    """Creator + everyone who wrote in the chat, still allowed into the module."""
    rows = (await db.execute(select(IncidentThread.author_id).where(IncidentThread.incident_id == incident.id).distinct())).all()
    people = {r[0] for r in rows} | {incident.created_by}
    return people & await module_user_ids(control_db)


def _add_notifications(db: AsyncSession, user_ids: Iterable[uuid.UUID], **fields) -> int:
    n = 0
    for uid in dict.fromkeys(user_ids):
        db.add(IncidentNotification(id=uuid.uuid4(), user_id=uid, **fields))
        n += 1
    return n


def _add_feed(db: AsyncSession, **fields) -> None:
    db.add(IncidentFeedEvent(id=uuid.uuid4(), **fields))


async def on_incident_created(db: AsyncSession, *, incident: Incident, actor) -> None:
    """A new incident goes into the feed (no bell: nobody has been asked anything yet)."""
    try:
        _add_feed(db, event_type="INCIDENT_CREATED", incident_id=incident.id,
                  title=f"{actor.full_name} created {where(incident)}",
                  message=snippet(incident.description) or incident.category,
                  link=incident_link(incident.id), actor_name=actor.full_name, actor_id=actor.id,
                  meta={"recipient_ids": [], "category": incident.category})
        await db.commit()
    except Exception:
        logger.exception("Could not create the feed event for incident %s", incident.id)
        await db.rollback()


async def on_message_posted(db: AsyncSession, control_db: AsyncSession, *, incident: Incident, thread: IncidentThread,
                            author, tagged: list[str], has_files: bool) -> None:
    """A chat message was posted: tag mentions, tell the people already involved."""
    try:
        text_ = snippet(thread.body, has_files)
        place = where(incident)
        allowed = await module_user_ids(control_db)
        mention_ids = {uuid.UUID(t) for t in tagged} & allowed
        mention_ids.discard(author.id)
        audience = (await audience_of(db, control_db, incident)) - {author.id}

        common = dict(incident_id=incident.id, sender_name=author.full_name, link=incident_link(incident.id))
        _add_notifications(db, mention_ids, type="MENTION", title=f"{author.full_name} mentioned you on {place}",
                           message=text_, **common)
        _add_notifications(db, audience - mention_ids, type="MESSAGE", title=f"New message on {place}",
                           message=f"{author.full_name}: {text_}", **common)
        _add_feed(db, event_type="MENTION" if mention_ids else "MESSAGE", incident_id=incident.id,
                  title=f"{author.full_name} wrote on {place}", message=text_, link=incident_link(incident.id),
                  actor_name=author.full_name, actor_id=author.id,
                  meta={"recipient_ids": [str(u) for u in (audience | mention_ids)],
                        "mentioned_user_ids": [str(u) for u in mention_ids]})
        await db.commit()
    except Exception:
        logger.exception("Could not create notifications for a message on incident %s", incident.id)
        await db.rollback()


async def on_status_changed(db: AsyncSession, control_db: AsyncSession, *, incident: Incident, actor, closed: bool) -> None:
    """An incident was closed or reopened: tell the creator and the people in its chat."""
    try:
        place = where(incident)
        audience = (await audience_of(db, control_db, incident)) - {actor.id}
        verb = "closed" if closed else "reopened"
        _add_notifications(db, audience, type="CLOSED" if closed else "REOPENED", title=f"Incident {verb}: {place}",
                           message=f"{verb.capitalize()} by {actor.full_name}", incident_id=incident.id,
                           sender_name=actor.full_name, link=incident_link(incident.id))
        _add_feed(db, event_type="CLOSED" if closed else "REOPENED", incident_id=incident.id,
                  title=f"{actor.full_name} {verb} {place}", message=snippet(incident.description),
                  link=incident_link(incident.id), actor_name=actor.full_name, actor_id=actor.id,
                  meta={"recipient_ids": [str(u) for u in audience]})
        await db.commit()
    except Exception:
        logger.exception("Could not create notifications for incident %s being %s", incident.id, "closed" if closed else "reopened")
        await db.rollback()


async def on_files_added(db: AsyncSession, *, incident: Incident, actor, kind: str, count: int) -> None:
    """Evidence was added (photos, report, SOF, log files): a feed line, one per upload."""
    try:
        _add_feed(db, event_type="FILES_ADDED", incident_id=incident.id,
                  title=f"{actor.full_name} added {files_phrase(kind, count)} to {where(incident)}",
                  message="", link=incident_link(incident.id), actor_name=actor.full_name, actor_id=actor.id,
                  meta={"recipient_ids": [], "kind": kind, "count": count})
        await db.commit()
    except Exception:
        logger.exception("Could not create the feed event for files added to incident %s", incident.id)
        await db.rollback()
