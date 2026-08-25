# Shared urgency bucketing — used by 1.W.4 today, and meant to be reused as-is by
# 1.W.1–1.W.3 once their own due-date-driven review logic exists. Keep this the single
# source of truth for the RED/AMBER/NEUTRAL thresholds rather than re-deriving them per
# subtask.
from datetime import date
from typing import Optional


def days_remaining(due_date: Optional[date], today: Optional[date] = None) -> Optional[int]:
    """None in, None out — callers don't need to special-case missing due dates themselves."""
    if due_date is None:
        return None
    today = today or date.today()
    return (due_date - today).days


def urgency_bucket(days: Optional[int]) -> str:
    """<=15 days -> RED, <=30 -> AMBER, else (including unknown/None) -> NEUTRAL."""
    if days is None:
        return "NEUTRAL"
    if days <= 15:
        return "RED"
    if days <= 30:
        return "AMBER"
    return "NEUTRAL"
