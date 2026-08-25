import uuid
from datetime import date
from typing import List, Optional
from pydantic import BaseModel, field_validator
from app.constants import ROLE_CODES, RACI_LETTERS


class VesselOut(BaseModel):
    imo: str
    name: str

    class Config:
        from_attributes = True


class TaskOut(BaseModel):
    id: int
    item_no: int
    description: str
    interval: Optional[str] = None
    priority: Optional[int] = None
    effort_reduction: Optional[float] = None

    class Config:
        from_attributes = True


class UserOut(BaseModel):
    id: uuid.UUID
    full_name: str
    email: str
    role_code: Optional[str] = None

    class Config:
        from_attributes = True


class AssignmentOut(BaseModel):
    role_code: str
    user_id: Optional[uuid.UUID] = None
    full_name: Optional[str] = None
    email: Optional[str] = None


class MatrixEntryOut(BaseModel):
    task_id: int
    role_code: str
    raci_values: List[str]


class ConfigOut(BaseModel):
    assignments: List[AssignmentOut]
    matrix: List[MatrixEntryOut]


class AssignmentIn(BaseModel):
    vessel_imo: str
    role_code: str
    user_id: Optional[uuid.UUID] = None  # null clears the assignment

    @field_validator("role_code")
    @classmethod
    def validate_role_code(cls, v):
        if v not in ROLE_CODES:
            raise ValueError(f"role_code must be one of {ROLE_CODES}")
        return v


class SurveyCycleRow(BaseModel):
    """One survey row for 1.W.4. Deliberately un-merged across sources — same row shows up
    once per source if e.g. SmartPAL and DNV both track it, no cross-source matching here."""
    vessel_name: str
    survey_name: str
    range_date_from: Optional[date] = None
    range_date_to: Optional[date] = None
    due_date: Optional[date] = None  # the effective due date actually used for filtering
    days_remaining: Optional[int] = None
    urgency: str  # 'RED' | 'AMBER' | 'NEUTRAL' — see app/utils/urgency.py
    source: str  # 'DNV' | 'ABS' | 'IRS' | 'SMARTPAL'


class SurveyCycleReviewOut(BaseModel):
    vessel_count: int  # distinct vessels, not row count
    rows: List[SurveyCycleRow]


class TriggerWorkOrderIn(BaseModel):
    vessel_name: str
    survey_name: str
    source: str


class TriggerWorkOrderOut(BaseModel):
    success: bool


class MatrixEntryIn(BaseModel):
    vessel_imo: str
    task_id: int
    role_code: str
    raci_values: List[str]

    @field_validator("role_code")
    @classmethod
    def validate_role_code(cls, v):
        if v not in ROLE_CODES:
            raise ValueError(f"role_code must be one of {ROLE_CODES}")
        return v

    @field_validator("raci_values")
    @classmethod
    def validate_raci_values(cls, v):
        invalid = set(v) - set(RACI_LETTERS)
        if invalid:
            raise ValueError(f"raci_values contains invalid letters: {sorted(invalid)}")
        return v
