"""Alert configuration read by the compliance checks: which alerts are on, their severity and thresholds.

A run (`run_all_checks`) loads the configuration once for its vessel and publishes it through a context
variable, so the individual checks stay `(vessel_id, upload_id, db)` functions. Thresholds come from
`orb_threshold_params`: the vessel's own override when it has one, else the default row, else the value in
alert_catalog.PARAM_DEFAULTS (so nothing breaks while migration 019 is not applied).
"""
import uuid
from contextvars import ContextVar
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.orb_config import AlertConfig, ThresholdParam
from app.services.alert_catalog import PARAM_DEFAULTS, PARAMS

_COMPARATORS = {
    ">": lambda x, v: x > v,
    ">=": lambda x, v: x >= v,
    "<": lambda x, v: x < v,
    "<=": lambda x, v: x <= v,
    "=": lambda x, v: x == v,
    "+/-": lambda x, v: abs(x) > v,
}
_DEFAULT_COMPARATOR = {code: comp for code, _a, _l, comp, _v, _u, _n in PARAMS}


@dataclass
class RunConfig:
    # alert_code -> (enabled, severity, scope); empty when the table is missing or has no row
    alerts: dict = field(default_factory=dict)
    values: dict = field(default_factory=dict)        # param_code -> value for this vessel
    comparators: dict = field(default_factory=dict)   # param_code -> comparator

    def is_enabled(self, code: str) -> bool:
        row = self.alerts.get(code)
        return True if row is None else row[0]

    def severity(self, code: str, fallback: str) -> str:
        row = self.alerts.get(code)
        return fallback if row is None else row[1]

    def scope(self, code: str) -> str | None:
        row = self.alerts.get(code)
        return None if row is None else row[2]

    def value(self, code: str) -> float:
        return self.values.get(code, PARAM_DEFAULTS[code])

    def exceeds(self, code: str, x: float) -> bool:
        """True when x breaches the threshold, using the parameter's comparator (x is rounded to 4 dp,
        the readings are 2 dp, so float noise such as 28.7 - (7.2 + 21.5) never counts)."""
        comparator = self.comparators.get(code) or _DEFAULT_COMPARATOR[code]
        return _COMPARATORS[comparator](round(x, 4), self.value(code))


_current: ContextVar[RunConfig | None] = ContextVar("orb_run_config", default=None)


def current() -> RunConfig:
    """The configuration of the run in progress; defaults (everything enabled) outside a run."""
    return _current.get() or RunConfig()


def set_current(cfg: RunConfig | None):
    return _current.set(cfg)


def reset_current(token) -> None:
    _current.reset(token)


async def load_run_config(db: AsyncSession, vessel_id: uuid.UUID | None) -> RunConfig:
    cfg = RunConfig()
    for row in (await db.execute(select(AlertConfig))).scalars().all():
        cfg.alerts[row.alert_code] = (row.enabled, row.severity, row.scope)
    params = (await db.execute(
        select(ThresholdParam).where((ThresholdParam.vessel_id.is_(None)) | (ThresholdParam.vessel_id == vessel_id))
    )).scalars().all()
    # defaults first, then the vessel's overrides on top
    for p in sorted(params, key=lambda r: r.vessel_id is not None):
        cfg.values[p.param_code] = p.value
        cfg.comparators[p.param_code] = p.comparator
    return cfg


async def disabled_alert_codes(db: AsyncSession) -> list[str]:
    """Withdrawn alerts: their old rows stay in the database but are left out of lists, counts and exports."""
    return list((await db.execute(select(AlertConfig.alert_code).where(AlertConfig.enabled.is_(False)))).scalars().all())


def not_withdrawn(disabled: list[str]):
    """SQL condition for the alerts to show: everything except old alerts of a withdrawn type. A withdrawn
    alert that has a conversation, or is awaiting approval, stays visible so nothing in flight is orphaned."""
    from sqlalchemy import and_, exists, not_
    from app.models.orb_alert import OrbAlert
    from app.models.orb_alert_thread import OrbAlertThread

    hidden = and_(
        OrbAlert.alert_type.in_(disabled),
        OrbAlert.status != "PENDING_APPROVAL",
        ~exists().where(OrbAlertThread.alert_id == OrbAlert.id),
    )
    return not_(hidden)
