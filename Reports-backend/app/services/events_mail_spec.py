# app/services/events_mail_spec.py
# Rows of the event mail, in the order of the MariApps event-report sheet: (Tab, Section, Parameter, db column, unit).
# A column that does not exist in expanded_mariapps_data is skipped (events.build_logbook reports it as missing),
# so a wrong name here drops that row instead of breaking the mail.
# To add, remove or reorder a row, edit this list only.

_AE = (
    ("AE1", "1"),
    ("AE2", "2"),
    ("AE3", "3"),
)

ROWS = [
    # ---- Header ----
    ("Header", "Log Info", "Leg Number", "emissionx_voyage_no", ""),
    ("Header", "Log Info", "Log Number", "log_number", ""),
    ("Header", "Log Info", "Log Type / Sub Log Type", "log_type", ""),
    ("Header", "Log Info", "Date (Local)", "@date_local", ""),
    ("Header", "Log Info", "Date (UTC)", "@date_utc", ""),
    ("Header", "Log Info", "Loading Condition", "loading_condition", ""),
    ("Header", "Log Info", "Duration", "VoyageMeta_log_durationh_operational_LF", "hr"),
    ("Header", "Log Info", "Departure Port (Last Leg)", "VoyageMeta_departure_port_last_leg_operational_LF", ""),
    ("Header", "Log Info", "Arrival Port (Current Leg)",
     ("VoyageMeta_arrival_port_current_leg_operational_LF", "VoyageMeta_to_port_operational_LF"), ""),
    # ---- Position ----
    ("Position", "Distance", "Calculated Speed Over Ground (Avg.)", "Vessel_SOGcal_avg_operational_LF", "kn"),
    ("Position", "Distance", "Calculated Speed Through Water (Avg.)", "Vessel_STWcal_avg_operational_LF", "kn"),
    ("Position", "Loading Condition", "Cargo Onboard", "Vessel_Cargo_onboard_operational_LF", "MT"),
    ("Position", "Time", "ETA (LT)", "VoyageMeta_eta_estimated_time_of_arrival_lt_operational_LF", ""),
    ("Position", "Time", "ETB (LT)", "VoyageMeta_etb_estimated_time_of_berthing_lt_operational_LF", ""),
    ("Position", "Time", "ETS (LT)", "VoyageMeta_ets_estimated_time_of_sailing_lt_operational_LF", ""),
    # ---- Weather ----
    ("Weather", "Draft & Condition", "Fore Draught", "Vessel_Tf_avg_operational_LF", "m"),
    ("Weather", "Draft & Condition", "Aft Draught", "Vessel_Ta_avg_operational_LF", "m"),
    ("Weather", "Draft & Condition", "Displacement", "Vessel_DISP_avg_operational_LF", "MT"),
    ("Weather", "Draft & Condition", "Total Ballast Onboard (Avg.)", "Vessel_BallastTot_operational_LF", "MT"),
    ("Weather", "Speed", "Speed Over Ground (Inst.)", "Vessel_SOG_operational_LF", "kn"),
    ("Weather", "Speed", "Speed Through Water (Inst.)", "Vessel_STW_operational_LF", "kn"),
    ("Weather", "Wind & Current", "True Wind Speed at Anemometer (Inst.)", "Weather_Uwit_operational_LF", "kn"),
    ("Weather", "Sea State", "Wave Height (Inst.)", "Weather_Hwv_operational_LF", "m"),
    ("Weather", "Sea State", "Swell Height (Avg.)", "Weather_Hsl_avg_operational_LF", "m"),
    ("Weather", "Sea State", "Swell Height (Inst.)", "Weather_Hsl_operational_LF", "m"),
    ("Weather", "Environment", "Sea Water Temperature (Inst.)", "Weather_Tsw_operational_LF", "°C"),
    ("Weather", "Environment", "Air Temperature (Inst.)", "Weather_Tair_operational_LF", "°C"),
    ("Weather", "Environment", "Air Pressure (Inst.)", "Weather_pair_operational_LF", "mbar"),
    # ---- Consumption: fuel oil split by consumer ----
    ("Consumption", "Fuel Oil by Consumer", "ME Calculated Mass Consumption",
     ("ME_FO_mFOCcalME_avg_operational_LF", "ME_FO_mFOCME_dCnt_operational_LF"), "kg"),
    ("Consumption", "Fuel Oil by Consumer", "AE Calculated Mass Consumption",
     ("AE_FO_mFOCcalAE_avg_operational_LF", "AE_FO_mFOCAE_dCnt_operational_LF"), "kg"),
    ("Consumption", "Fuel Oil by Consumer", "Boiler Mass Consumption (Tot.)", "AuxBoiler_mFOCBL_dCnt_operational_LF", "MT"),
    ("Consumption", "Fuel Oil by Consumer", "Composite Boiler Mass Consumption", "CompositeBoiler_mFOCComBL_dCnt_operational_LF", "MT"),
    ("Consumption", "Cylinder Oil", "ME Cylinder Oil Quantity Consumed", "ME_Lub_VCOCME_dCnt_operational_LF", "L"),
    *[("Consumption", "Other Lube Items", f"{ae} System Oil Quantity Consumed", f"AE_SysOil_SOConsAE_{n}_operational_LF", "Ltr")
      for ae, n in _AE],
    ("Consumption", "Fresh Water", "Consumed", "Vessel_mfwC_dCnt_operational_LF", "MT"),
    ("Consumption", "Fresh Water", "Produced", "Vessel_mfwP_dCnt_operational_LF", "MT"),
    ("Consumption", "Fresh Water", "Received", "Vessel_mfwR_dCnt_operational_LF", "MT"),
    ("Consumption", "Fresh Water", "ROB", "VoyageMeta_section3_rob_operational_LF", "MT"),
    # ---- Operations ----
    ("Operations", "Main Engine", "ME Running Hours (Tot.)", "ME_RHME_dCnt_operational_LF", "hr"),
    ("Operations", "Main Engine", "ME Estimated Power",
     ("ME_PeffestME_avg_operational_LF", "ME_PeffcalME_avg_operational_LF"), "kW"),
    ("Operations", "Main Engine", "ME Energy Produced (Tot.)", "ME_DESME_dCnt_operational_LF", "kWh"),
    # aux engines split per generator: all of AE1, then AE2, then AE3
    *[("Operations", f"Auxiliary Engine {n}", label, f"{col}_{n}_operational_LF", unit)
      for ae, n in _AE
      for label, col, unit in (
          (f"{ae} Electric Energy Produced (Tot.)", "AE_DEelAE_dCnt", "kWh"),
          (f"{ae} Running Hours (Tot.)", "AE_RHAE_dCnt", "hr"),
          (f"{ae} Electric Power (Avg.)", "AE_PelAE_avg", "kW"),
      )],
    ("Operations", "Other Equipment", "FWG Total Running Hours (Cnt.)", "FWG_RHFWG_Cnt_operational_LF", "hr"),
    # ---- Machinery ----
    ("Machinery", "Engine Room", "ER Ambient Air Temperature (Inst.)", "Vessel_TambairER_operational_LF", "°C"),
    ("Machinery", "ME General Data", "ME Shaft Power (Inst.)", "ME_PSME_operational_LF", "kW"),
    ("Machinery", "ME General Data", "ME Speed (Inst.)", "ME_NME_operational_LF", "RPM"),
    ("Machinery", "ME General Data", "ME Specific Cylinder Oil Consumption (Set)", "ME_Lub_SCOCME_set_operational_LF", "g/kWh"),
    ("Machinery", "ME General Data", "ME Fuel Index (Inst.)", "ME_FPIME_operational_LF", ""),
    # ---- Performance (KPI) ----
    ("Performance (KPI)", "Efficiency", "Calculated SCOC", "VoyageMeta_calculated_scoc_operational_LF", ""),
    ("Performance (KPI)", "Efficiency", "Apparent Slip", "VoyageMeta_apparent_slip_operational_LF", "%"),
    ("Performance (KPI)", "Efficiency", "Real Slip", "VoyageMeta_real_slip_operational_LF", "%"),
]

# Columns for events.build_logbook(columns_override=...). A row's column may be a tuple of alternatives:
# the first one with a value in an event is shown. Names starting with "@" are computed by the mail.
def _candidates(col):
    return [col] if isinstance(col, str) else list(col)


COLUMNS = [
    {"db_column": _candidates(col)[0], "candidates": _candidates(col), "display_name": label,
     "unit": unit, "tab": tab, "section": section}
    for tab, section, label, col, unit in ROWS
]
