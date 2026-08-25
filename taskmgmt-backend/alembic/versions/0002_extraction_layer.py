"""vessel identity resolution + SmartPAL/DNV/ABS/IRS extraction tables"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

# revision identifiers
revision = "0002_extraction_layer"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "vessel_source_ids",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("imo_number", sa.Text(), nullable=False),
        sa.Column("source", sa.Text(), nullable=False),  # 'SMARTPAL' | 'DNV' | 'ABS' | 'IRS'
        sa.Column("source_vessel_id", sa.Text(), nullable=False),
        sa.Column("resolved_by", sa.Text(), nullable=True),  # 'AUTO_VERIFIED' | 'MANUAL'
        sa.Column("verified_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.UniqueConstraint("imo_number", "source", name="uq_vessel_source_ids_imo_source"),
    )

    op.create_table(
        "smartpal_certificates",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=False),
        sa.Column("vessel_id", sa.Integer(), nullable=False),
        sa.Column("certificate_id", sa.Integer(), nullable=True),
        sa.Column("certificate_name", sa.Text(), nullable=True),
        sa.Column("type", sa.Text(), nullable=True),
        sa.Column("sub_type", sa.Text(), nullable=True),
        sa.Column("term_type", sa.Text(), nullable=True),
        sa.Column("issued_date", sa.Date(), nullable=True),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("validity_months", sa.Integer(), nullable=True),
        sa.Column("attachment_files", sa.Text(), nullable=True),
        sa.Column("synced_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )

    op.create_table(
        "smartpal_surveys",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=False),
        sa.Column("vessel_id", sa.Integer(), nullable=False),
        sa.Column("survey_id", sa.Integer(), nullable=True),
        sa.Column("survey_name", sa.Text(), nullable=True),
        sa.Column("type", sa.Text(), nullable=True),
        sa.Column("date_last_done", sa.Date(), nullable=True),
        sa.Column("date_due", sa.Date(), nullable=True),
        sa.Column("due_range_from", sa.Date(), nullable=True),
        sa.Column("due_range_to", sa.Date(), nullable=True),
        sa.Column("validity_months", sa.Integer(), nullable=True),
        sa.Column("synced_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )

    op.create_table(
        "smartpal_items",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=False),
        sa.Column("vessel_id", sa.Integer(), nullable=False),
        sa.Column("doc_type", sa.Text(), nullable=False),  # 'DAE' | 'COC' | 'MEMORANDA'
        sa.Column("item_status", sa.Text(), nullable=True),
        sa.Column("item_classification", sa.Text(), nullable=True),
        sa.Column("narrative", sa.Text(), nullable=True),
        sa.Column("remarks", sa.Text(), nullable=True),
        sa.Column("date_issued", sa.Date(), nullable=True),
        sa.Column("date_due", sa.Date(), nullable=True),
        sa.Column("extension_date", sa.Date(), nullable=True),
        sa.Column("rectification_date", sa.Date(), nullable=True),
        sa.Column("deletion_date", sa.Date(), nullable=True),
        sa.Column("risk_assessment", sa.Integer(), nullable=True),
        sa.Column("parent_type", sa.Text(), nullable=True),
        sa.Column("parent_id", sa.BigInteger(), nullable=True),
        sa.Column("synced_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )

    op.create_table(
        "class_certificates",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("vessel_id", sa.Integer(), nullable=False),
        sa.Column("source", sa.Text(), nullable=False),
        sa.Column("certificate_number", sa.Text(), nullable=True),
        sa.Column("certificate_name", sa.Text(), nullable=True),
        sa.Column("term_type", sa.Text(), nullable=True),
        sa.Column("issued_date", sa.Date(), nullable=True),
        sa.Column("place_of_issuance", sa.Text(), nullable=True),
        sa.Column("issued_by", sa.Text(), nullable=True),
        sa.Column("expiry_date", sa.Date(), nullable=True),
        sa.Column("status", sa.Text(), nullable=True),
        sa.Column("status_date", sa.Date(), nullable=True),
        sa.Column("doc_type", sa.Text(), nullable=True),
        sa.Column("category", sa.Text(), nullable=True),
        sa.Column("raw_code", sa.Text(), nullable=True),
        sa.Column("synced_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )

    op.create_table(
        "class_surveys",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("vessel_id", sa.Integer(), nullable=False),
        sa.Column("source", sa.Text(), nullable=False),
        sa.Column("survey_name", sa.Text(), nullable=True),
        sa.Column("code", sa.Text(), nullable=True),
        sa.Column("category", sa.Text(), nullable=True),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("range_date_from", sa.Date(), nullable=True),
        sa.Column("range_date_to", sa.Date(), nullable=True),
        sa.Column("last_survey_date", sa.Date(), nullable=True),
        sa.Column("last_attending_office", sa.Text(), nullable=True),
        sa.Column("extended_force_majeure", sa.Text(), nullable=True),
        sa.Column("status", sa.Text(), nullable=True),
        sa.Column("synced_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )

    op.create_table(
        "class_conditions",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("vessel_id", sa.Integer(), nullable=False),
        sa.Column("source", sa.Text(), nullable=False),
        sa.Column("condition_no", sa.Text(), nullable=True),
        sa.Column("condition_category", sa.Text(), nullable=True),
        sa.Column("reference_number", sa.Text(), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("status", sa.Text(), nullable=True),
        sa.Column("raised_date", sa.Date(), nullable=True),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("synced_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )


def downgrade():
    op.drop_table("class_conditions")
    op.drop_table("class_surveys")
    op.drop_table("class_certificates")
    op.drop_table("smartpal_items")
    op.drop_table("smartpal_surveys")
    op.drop_table("smartpal_certificates")
    op.drop_table("vessel_source_ids")
