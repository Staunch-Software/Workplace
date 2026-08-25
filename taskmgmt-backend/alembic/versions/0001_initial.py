"""initial schema: task_master, vessel_role_assignment, task_raci_entry (+ seed 63 tasks)"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

# revision identifiers
revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None

TASKS = [
    {"item_no": 1, "description": "Survey planning and Arrangement", "interval": "W", "priority": 1, "effort_reduction": 0.5},
    {"item_no": 2, "description": "Check and confirm that vessel's certificate database in ShipPalm is complete and in order", "interval": "W", "priority": 1, "effort_reduction": 0.75},
    {"item_no": 3, "description": "All COCs should be visible with due date into BI Portal and Ship palm and to be handled", "interval": "W", "priority": 1, "effort_reduction": 0.5},
    {"item_no": 4, "description": "All dispensation should be visible into BI Portal and Shippalm and to be handled", "interval": "W", "priority": 1, "effort_reduction": 0.5},
    {"item_no": 5, "description": "Monitoring of GHG, CII, ESG, ESI, IMO DCS, EUMRV reporting of vessel", "interval": "M", "priority": 3, "effort_reduction": 1.0},
    {"item_no": 6, "description": "Survey status with SI comments must be sent to vessel on 01st and 15th of every month.", "interval": "Bi-Weekly", "priority": 1, "effort_reduction": 0.75},
    {"item_no": 7, "description": "Review of ORB and GRB from vessel", "interval": "M", "priority": None, "effort_reduction": None},
    {"item_no": 8, "description": "Review of Corrosion maintenance and vessel condition report to be sent to vessel, monthly and bi-monthly basis", "interval": "M", "priority": 2, "effort_reduction": 0.25},
    {"item_no": 9, "description": "Ballast Tank Inspection Report with RA, PTW, inspection report (Frequency 12 months)", "interval": "3 M", "priority": 3, "effort_reduction": 0.5},
    {"item_no": 10, "description": "Void Space Inspection Report with RA, PTW, inspection report (Frequency 12 months)", "interval": "3 M", "priority": 3, "effort_reduction": 0.5},
    {"item_no": 11, "description": "Cargo Hold Inspection Record with RA, PTW, inspection report (Frequency 6 months)", "interval": "3 M", "priority": 3, "effort_reduction": 0.5},
    {"item_no": 12, "description": "Power BI report for corrosion maintanance to be maintained", "interval": "3 M", "priority": 3, "effort_reduction": 0.0},
    {"item_no": 13, "description": "Noon report in Ship palm should not be overdue and should be reviewed", "interval": "W", "priority": 2, "effort_reduction": 1.0},
    {"item_no": 14, "description": "Daily, Weekly and Monthly report should come from vessel as per format finalised by TSI", "interval": "D, W, M, 3 M", "priority": 2, "effort_reduction": 0.5},
    {"item_no": 15, "description": "Technical Monthly Meeting minutes to be prepared", "interval": "W, M, 3 M", "priority": 2, "effort_reduction": 1.0},
    {"item_no": 16, "description": "Machineries counters in shippalm should not be overdue", "interval": "W", "priority": 2, "effort_reduction": 1.0},
    {"item_no": 17, "description": "Vessel voyage performance data to be maintained and report should be sent to TSI after each voyage", "interval": "As n When", "priority": 3, "effort_reduction": 1.0},
    {"item_no": 18, "description": "Daily, Weekly and Monthly report to be compiled and to be presented to TSI for review", "interval": "D, W, M, 3 M", "priority": 3, "effort_reduction": 1.0},
    {"item_no": 19, "description": "Ensure Technical department Quarterly KPI sheet is updated including breakdown of critical equipment / loss of hire due to equipment failure / loss of propulsion during manoeuvering / black outs etc. for this vessel.", "interval": None, "priority": 3, "effort_reduction": 1.0},
    {"item_no": 20, "description": "Waterproof report from vessels to be followed and reviewed from each vessel", "interval": "M", "priority": 1, "effort_reduction": 0.75},
    {"item_no": 21, "description": "PMS Data should be Ship specific", "interval": "One Time", "priority": 1, "effort_reduction": 0.0},
    {"item_no": 22, "description": "Confirm Critical spare list for the vessel is agreed, documented and available in ShipPalm and maintained", "interval": "One Time", "priority": 1, "effort_reduction": 0.5},
    {"item_no": 23, "description": "Critical equipment monthly performance test report must be available in ShipPalm. TE-44", "interval": "3 M", "priority": 1, "effort_reduction": 0.75},
    {"item_no": 24, "description": "Review of Critical jobs in Ship palm ( ME / AE Unit overhauls, ME / AE cylinder cover overhauls, ME mountings overhaul, compressor / purifier jobs etc)", "interval": "As n When", "priority": 2, "effort_reduction": 0.75},
    {"item_no": 25, "description": "Percentage of overdue critical jobs (KPI - 0% Should be Met at all times)", "interval": "W", "priority": 2, "effort_reduction": 0.75},
    {"item_no": 26, "description": "Percentage of overdue Non-critical jobs (KPI - 3% Should be Met at all times)", "interval": "W", "priority": 2, "effort_reduction": 0.75},
    {"item_no": 27, "description": "Number of critical jobs overdue for more than 10 days should have deviation from office", "interval": "W", "priority": 3, "effort_reduction": 0.75},
    {"item_no": 28, "description": "Number of Non-critical jobs overdue for more than 30 days should have deferment from office", "interval": "W", "priority": 3, "effort_reduction": 0.75},
    {"item_no": 29, "description": "Critical Equipment maintenance should follow office approval process including RA and TE 22", "interval": "As n When", "priority": 2, "effort_reduction": 0.5},
    {"item_no": 30, "description": "Critical Equipment Failure maintenance should follow office approval process including RA and TE 22 A in ship palm", "interval": "As n When", "priority": 2, "effort_reduction": 0.5},
    {"item_no": 31, "description": "Top 4 take over report to be received within 14 days and to be reviewed (Initial)", "interval": "As n When", "priority": 2, "effort_reduction": 0.0},
    {"item_no": 32, "description": "Top 4 - Updated take over report to be received and reviewed within 14 days of planned sign off, same to be served as handing over notes", "interval": "As n When", "priority": 2, "effort_reduction": 0.0},
    {"item_no": 33, "description": "Weekly Bunker sounding record up to date and Review", "interval": "W", "priority": 2, "effort_reduction": 0.75},
    {"item_no": 34, "description": "Vessel voyage performance review to be sent to vessel", "interval": "As n When", "priority": 2, "effort_reduction": 0.75},
    {"item_no": 35, "description": "Main Engine and Aux engine performance report to be uploaded in Shipsight", "interval": "As n When", "priority": 1, "effort_reduction": 0.75},
    {"item_no": 36, "description": "Vessel inspection observations related to equipment must be linked to component and same to reflect in PMS history of subject component", "interval": "To be Postponed", "priority": 3, "effort_reduction": 0.5},
    {"item_no": 37, "description": "Confirm No Expired certificate", "interval": "W", "priority": 1, "effort_reduction": 0.5},
    {"item_no": 38, "description": "Confirm Periodical vessel inspections ( twice / year, one at port and one during sailing) are carried in VIR module.", "interval": "M", "priority": 1, "effort_reduction": 0.0},
    {"item_no": 39, "description": "The VIR reports are submitted for review within 2 weeks time.", "interval": "M", "priority": 1, "effort_reduction": 0.0},
    {"item_no": 40, "description": "VIR - defect observations should be suitably followed up till they closed.", "interval": "W", "priority": 1, "effort_reduction": 0.5},
    {"item_no": 41, "description": "Weekly defect list mail to be reviewed and should be communicated to vessel", "interval": "W", "priority": 1, "effort_reduction": 0.25},
    {"item_no": 42, "description": "All Hull and machinery defects are reported in ShipPalm defect module / DRS and follow up action in place", "interval": "W", "priority": 1, "effort_reduction": 0.25},
    {"item_no": 43, "description": "Confirm all OPEN defects ( H&M + VIR + Third party) are Prioritised / Urgent and High risk defects are visible to TM", "interval": "W", "priority": 1, "effort_reduction": 0.25},
    {"item_no": 44, "description": "Account Report review and Variance Explanation to be finalised", "interval": "M", "priority": 1, "effort_reduction": 0.75},
    {"item_no": 45, "description": "Vessel Budget Preparation and control", "interval": "One Time", "priority": 2, "effort_reduction": 0.0},
    {"item_no": 46, "description": "Check and confirm running DD repair specifications are available", "interval": "As n When", "priority": 1, "effort_reduction": 0.5},
    {"item_no": 47, "description": "Confirm Yard contract is signed by head of technical and retained as record.", "interval": "As n When", "priority": 2, "effort_reduction": 0.0},
    {"item_no": 48, "description": "Confirm the paint vendor are agreed with necessary support and expertise post supply of paints.", "interval": "As n When", "priority": 2, "effort_reduction": 0.0},
    {"item_no": 49, "description": "Confirm DD Summary report is available with all details including follow up action plan.", "interval": "As n When", "priority": 2, "effort_reduction": 0.0},
    {"item_no": 50, "description": "TECH-051 Checklist for Docking & OF-TECH-024 Docking Guide for Supts (MOC for dockings) are filled up, updated and filed. In progress ones available for planned dockings", "interval": "As n When", "priority": 2, "effort_reduction": 0.0},
    {"item_no": 51, "description": "On completion of Docking, Yard evaluation form has been filled up and submitted to the Docking & Repair cell.", "interval": "As n When", "priority": 2, "effort_reduction": 0.0},
    {"item_no": 52, "description": "Ensure no critical spare is below Re-order level. If so, ensure PO issued and RA is in place", "interval": "M", "priority": 1, "effort_reduction": 0.5},
    {"item_no": 53, "description": "Is \"minimum mandatory spare list\" amended based on vessel's past history / company's decision/redundancy, vessel's operation etc?", "interval": "To be Postponed", "priority": 2, "effort_reduction": 0.5},
    {"item_no": 54, "description": "Appraisal of Master, Chief Engineer, Chief Officer and second engineer", "interval": "As n When", "priority": 2, "effort_reduction": 0.0},
    {"item_no": 55, "description": "LO Analysis report and follow ups action to be addressed", "interval": "W", "priority": 1, "effort_reduction": 0.75},
    {"item_no": 56, "description": "All concerns wrt LO analysis report should be cleared", "interval": "W", "priority": 1, "effort_reduction": 0.75},
    {"item_no": 57, "description": "Technical Monthly Meeting minutes for each vessel should be reviewed", "interval": "M", "priority": 2, "effort_reduction": 0.75},
    {"item_no": 58, "description": "Monthly report (min TE-01, TE-02, TE07, TE08, TE-10, TE-12, TE-18, TE-22, TE-25, TE-30, TE-36, TE-44, TE-51 and TE-55 ) to be reviewed and should be comunicated to vessel", "interval": "M", "priority": 1, "effort_reduction": 0.5},
    {"item_no": 59, "description": "Weekly and monthly report to be reviewed and should be communicated to owner as appropriate", "interval": "M", "priority": 1, "effort_reduction": 0.25},
    {"item_no": 60, "description": "Review of ME and AE performance report and Scavenge space inspection report to be sent to vessel ASAP after job completion", "interval": "M", "priority": 1, "effort_reduction": 0.75},
    {"item_no": 61, "description": "Weekly report to be reviewed and should be communicated to vessel", "interval": "W", "priority": 1, "effort_reduction": 0.25},
    {"item_no": 62, "description": "Review of Bunker plan", "interval": "W", "priority": 1, "effort_reduction": 0.75},
    {"item_no": 63, "description": "Travel memo to be prepared by TSI when going on travel", "interval": "As n When", "priority": 1, "effort_reduction": 0.25},
]


def upgrade():
    task_master = op.create_table(
        "task_master",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("item_no", sa.Integer(), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("interval", sa.String(), nullable=True),
        sa.Column("priority", sa.Integer(), nullable=True),
        sa.Column("effort_reduction", sa.Float(), nullable=True),
    )

    op.create_table(
        "vessel_role_assignment",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("vessel_imo", sa.String(length=7), nullable=False),
        sa.Column("role_code", sa.String(), nullable=False),
        sa.Column("user_id", UUID(as_uuid=True), nullable=True),
        sa.UniqueConstraint("vessel_imo", "role_code", name="uq_vessel_role"),
    )
    op.create_index(
        "ix_vessel_role_assignment_vessel_imo", "vessel_role_assignment", ["vessel_imo"]
    )

    op.create_table(
        "task_raci_entry",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("vessel_imo", sa.String(length=7), nullable=False),
        sa.Column("task_id", sa.Integer(), sa.ForeignKey("task_master.id", ondelete="CASCADE"), nullable=False),
        sa.Column("role_code", sa.String(), nullable=False),
        sa.Column("raci_values", JSONB(), nullable=False, server_default="[]"),
        sa.UniqueConstraint("vessel_imo", "task_id", "role_code", name="uq_vessel_task_role"),
    )
    op.create_index(
        "ix_task_raci_entry_vessel_imo", "task_raci_entry", ["vessel_imo"]
    )

    op.bulk_insert(task_master, TASKS)


def downgrade():
    op.drop_index("ix_task_raci_entry_vessel_imo", table_name="task_raci_entry")
    op.drop_table("task_raci_entry")
    op.drop_index("ix_vessel_role_assignment_vessel_imo", table_name="vessel_role_assignment")
    op.drop_table("vessel_role_assignment")
    op.drop_table("task_master")
