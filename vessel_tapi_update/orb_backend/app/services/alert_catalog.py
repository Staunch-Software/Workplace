"""The alert set agreed in the ORB Part I compliance review (ORB_Compliance_Alerts_Review_v2.xlsx).

One row per alert of the Alert Register: 25 are enabled (14 existing + 11 new) and 12 withdrawn ones are
kept disabled, never deleted. `BUILT` lists the alert codes that have a check in calculations.py; the
accepted alerts that are not in it yet are waiting for their data (see the build order in the plan).

This module only seeds the configuration tables (migration 019). After that the database is the source of
truth and an administrator edits it; the defaults here are also the safety net when a row is missing.
"""

# (no, code, name, category, severity, scope, enabled, in_alerts_filter)
CATALOG = [
    (1,  "tank_capacity_exceeded",       "Tank over certified capacity",              "Tank quantities",     "critical",    "Entry",         True,  True),
    (2,  "sludge_vs_fuel_consumption",   "Sludge vs fuel burn",                       "Bilge and sludge",    "critical",    "Batch",         True,  True),
    (3,  "wrong_item_code",              "Wrong item/code",                           "Item numbers and codes", "major",    "Entry",         True,  True),
    (4,  "mass_balance_error",           "Mass balance error",                        "Tank quantities",     "major",       "Entry",         True,  True),
    (5,  "combined_capacity_threshold",  "Combined tank fill",                        "Tank quantities",     "major",       "Batch (vessel)", True, True),
    (6,  "bilge_increasing_rate",        "Bilge rising unexplained",                  "Bilge and sludge",    "major",       "Entry",         False, False),
    (7,  "bilge_pump_capacity",          "Pump capacity exceeded",                    "Bilge and sludge",    "major",       "Entry",         True,  True),
    (8,  "bunker_quantity_mismatch",     "Bunker quantity mismatch",                  "Bunkering",           "major",       "Entry",         True,  True),
    (9,  "item_value_missing",           "Item value missing",                        "Item numbers and codes", "major",    "Entry",         False, False),
    (10, "item_number_missing",          "Item number missing",                       "Item numbers and codes", "minor",    "Entry",         False, False),
    (11, "capacity_reading_mismatch",    "Capacity reading differs",                  "Tank quantities",     "minor",       "Entry",         False, False),
    (12, "sludge_generation_rate",       "Sludge drop unexplained",                   "Bilge and sludge",    "minor",       "Entry",         True,  True),
    (13, "bilge_transfer_vs_soundings",  "Bilge sounding mismatch",                   "Bilge and sludge",    "minor",       "Entry",         False, False),
    (14, "bunker_mismatch",              "Bunker details missing",                    "Bunkering",           "minor",       "Entry",         True,  True),
    (15, "missing_master_signature",     "Signature missing",                         "Document quality",    "minor",       "Batch",         True,  True),
    (16, "non_chronological_entry",      "Out of date order",                         "Document quality",    "minor",       "Entry",         True,  True),
    (17, "gap_between_entries",          "Blank line before entry",                   "Document quality",    "minor",       "Entry",         True,  True),
    (18, "erasure_detected",             "Erasure or correction",                     "Document quality",    "observation", "Entry",         True,  True),
    (19, "reading_needs_review",         "Reading needs review",                      "Tank quantities",     "observation", "Entry",         True,  True),
    (20, "sludge_below_expected",        "Sludge too low vs fuel burn",               "Bilge and sludge",    "major",       "Batch",         False, False),
    (21, "bilge_below_expected",         "Bilge generation too low",                  "Bilge and sludge",    "major",       "Batch",         False, False),
    (22, "ows_discharge_location",       "OWS discharge position / en route",         "OWS discharge",       "critical",    "Entry",         False, False),
    (23, "ows_alarm_record_mismatch",    "ORB vs 15 ppm alarm record",                "OWS discharge",       "critical",    "Entry",         True,  True),
    (24, "discharge_during_ofe_failure", "Discharge during equipment failure",        "Equipment failure",   "critical",    "Entry",         False, False),
    (25, "tank_not_in_iopp",             "Tank not in IOPP Supplement",               "Tank quantities",     "major",       "Entry",         True,  True),
    (26, "shore_disposal_no_receipt",    "Shore disposal without receipt",            "Disposal to shore",   "major",       "Entry",         False, False),
    (27, "incineration_check",           "Incineration exceeds capacity / in port",   "Bilge and sludge",    "major",       "Entry",         False, False),
    (28, "page_sequence_gap",            "Missing page / page sequence",              "Document quality",    "critical",    "Batch (vessel)", False, False),
    (29, "weekly_c11_missing",           "Weekly sludge inventory missing",           "Bilge and sludge",    "minor",       "Entry",         True,  True),
    (30, "missing_officer_signature",    "Officer signature per entry missing",       "Document quality",    "major",       "Entry",         True,  True),
    (31, "late_entry",                   "In-page order / late entry",                "Document quality",    "minor",       "Entry",         True,  True),
    (32, "code_ab_present",              "Code A / B entry found",                    "Item numbers and codes", "observation", "Entry",       True,  True),
    (33, "auto_discharge_location",      "Code E discharge in port / special area",   "OWS discharge",       "major",       "Entry",         True,  True),
    (34, "accidental_discharge_notify",  "Accidental discharge - notification",       "Accidental discharge", "major",      "Entry",         True,  True),
    (35, "bunker_bdn_mismatch",          "Bunker sulphur / BDN mismatch",             "Bunkering",           "minor",       "Entry",         True,  True),
    (36, "orb_language",                 "Book language",                             "Document quality",    "minor",       "Batch (vessel)", True, True),
    (37, "sludge_review_fuel_missing",   "Sludge review not possible",                "Bilge and sludge",    "minor",       "Batch",         True,  True),
]

# Alert codes that calculations.py can raise today.
BUILT = {
    "tank_capacity_exceeded", "sludge_vs_fuel_consumption", "wrong_item_code", "mass_balance_error",
    "combined_capacity_threshold", "bilge_pump_capacity", "bunker_quantity_mismatch", "sludge_generation_rate",
    "bunker_mismatch", "missing_master_signature", "non_chronological_entry", "gap_between_entries",
    "erasure_detected", "reading_needs_review", "sludge_review_fuel_missing",
    "weekly_c11_missing", "missing_officer_signature", "late_entry", "code_ab_present",
    "accidental_discharge_notify", "orb_language", "auto_discharge_location", "bunker_bdn_mismatch",
    "tank_not_in_iopp", "ows_alarm_record_mismatch",
}

# (param_code, alert_code, label, comparator, value, unit, note)
# The Thresholds sheet of the review, reviewer decisions applied. Only parameters of enabled alerts.
PARAMS = [
    ("mass_balance_drop_tolerance", "mass_balance_error", "Retained figure may fall below the running balance by", ">", 0.0, "m3",
     "Zero tolerance: a drop that no transfer, disposal, evaporation or incineration explains is flagged."),
    ("mass_balance_rise_tolerance", "mass_balance_error", "Retained figure may rise above the running balance by (tanks other than bilge/sludge)", ">", 0.15, "m3",
     "Unchanged from the previous rule; the review only changed the rule for a drop."),
    ("combined_fill_pct", "combined_capacity_threshold", "Combined fill of the main tanks", ">", 85.0, "%", None),
    ("main_tank_min_capacity", "combined_capacity_threshold", "A main tank has a capacity above", ">", 10.0, "m3",
     "Only main tanks count towards the combined fill."),
    ("sludge_ratio_major", "sludge_vs_fuel_consumption", "Sludge as % of fuel burned - Major", ">=", 1.5, "%", None),
    ("sludge_ratio_critical", "sludge_vs_fuel_consumption", "Sludge as % of fuel burned - Critical", ">=", 2.0, "%", None),
    ("pump_capacity_allowance", "bilge_pump_capacity", "Quantity may exceed pump rate x hours by", ">", 0.05, "m3",
     "There is no default pump rate: it is set per vessel in the equipment register."),
    ("sludge_drop_tolerance", "sludge_generation_rate", "Sludge tank may fall by", ">", 0.01, "m3", None),
    ("bunker_sum_tolerance", "bunker_quantity_mismatch", "Per-tank figures may differ from the stated total by", ">", 0.5, "MT",
     "Compared in MT only."),
    ("low_confidence_cutoff", "reading_needs_review", "Extraction confidence at or below which a reading needs review", "<=", 0.4, "",
     "Downgrades the Critical capacity alert to an Observation."),
    ("alarm_match_window", "ows_alarm_record_mismatch", "Time window to match an ORB entry with the 15 ppm alarm record", "+/-", 15.0, "min", None),
    ("fuel_coverage_min_pct", "sludge_review_fuel_missing", "Share of the period's days that must have a fuel record", "<", 95.0, "%",
     "Below this the sludge vs fuel burn review is not possible and alert 37 is raised (Mariapps reports)."),
    ("weekly_inventory_interval", "weekly_c11_missing", "Gap between two Code C 11 entries of a sludge tank", ">", 7.0, "days", None),
    ("bdn_qty_tolerance", "bunker_bdn_mismatch", "Bunker quantity may differ from the BDN by", "+/-", 0.5, "%", None),
]

# Safety net when the parameter table has no row (e.g. before migration 019 is applied).
PARAM_DEFAULTS = {code: value for code, _a, _l, _c, value, _u, _n in PARAMS}
