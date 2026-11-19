"""
Keep AMNS POLAR's Wartsila FOS reports visible in expanded_wni_data.

POLAR has no WNI feed; its noon reports come from the Wartsila scraper into
noon_report_data (source_id = 'Wartsila FOS') and analysis_data. The Logbook
page reads expanded_wni_data, so these rows are copied across. The copy is
idempotent (ON CONFLICT on raw_report_id) and never changes a vessel's IMO.

The IMO used is the workplace one for AMNS POLAR. Do not add alias or rewrite
logic for any other number here: IMOs are corrected once, by
scripts/correct_amns_imos.py.
"""
from sqlalchemy import text

POLAR_IMO = "9521813"
POLAR_SOURCE = "Wartsila FOS"

_HAS_ROWS_SQL = text(
    "SELECT 1 FROM expanded_wni_data "
    "WHERE vessel_imo = :imo AND source_id = :src LIMIT 1"
)

_SYNC_SQL = text("""
    INSERT INTO expanded_wni_data (
        raw_report_id, vessel_imo, source_id, date, event_type, voyage_no, loading_condition,
        "VoyageMeta_log_durationh_operational_LF",
        "wnix_distance_nm_reported_distance_nm",
        "wnix_m_e_fuel_consumption_vlsfo_hfo_mt",
        "wnix_a_e_fuel_consumption_vlsfo_lfo_mt",
        "wnix_total_fuel_consumption_lfo_mt",
        "VoyageMeta_to_port_operational_LF",
        "VoyageMeta_departure_port_last_leg_operational_LF",
        "Vessel_SOG_avg_operational_LF",
        "wnix_speed_reported_spd_kts",
        "VoyageMeta_latitude_operational_LF",
        "VoyageMeta_latitude_lat_minutes_operational_LF",
        "VoyageMeta_latitude_lat_direction_operational_LF",
        "VoyageMeta_longitude_operational_LF",
        "VoyageMeta_longitude_lon_minutes_operational_LF",
        "VoyageMeta_longitude_lon_direction_operational_LF"
    )
    SELECT DISTINCT ON (n.raw_report_id)
        n.raw_report_id,
        :imo as vessel_imo,
        :src as source_id,
        CAST(n.log_date AS DATE) as date,
        n.log_type as event_type,
        a."Voyage_No" as voyage_no,
        a."Loading_Cond" as loading_condition,
        CAST(n.log_duration AS TEXT),
        CAST(n.distance_og AS TEXT),
        CAST(a."ME_FOC_MT" AS TEXT),
        CAST(a."AE_FOC_MT" AS TEXT),
        CAST(COALESCE(a."ME_FOC_MT", 0) + COALESCE(a."AE_FOC_MT", 0) AS TEXT),
        a."To_Port",
        a."From_Port",
        CAST(a."SOG_kn" AS TEXT),
        CAST(a."SOG_kn" AS TEXT),
        CAST(n.lat_degree AS TEXT),
        CAST(n.lat_minutes AS TEXT),
        n.lat_direction,
        CAST(n.lon_degree AS TEXT),
        CAST(n.lon_minutes AS TEXT),
        n.lon_direction
    FROM noon_report_data n
    JOIN analysis_data a ON a.raw_report_id = n.raw_report_id
    WHERE n.source_id = :src AND n.vessel_imo = :imo
    ON CONFLICT (raw_report_id) DO UPDATE SET
        vessel_imo = EXCLUDED.vessel_imo,
        source_id = EXCLUDED.source_id,
        date = EXCLUDED.date,
        event_type = EXCLUDED.event_type,
        voyage_no = EXCLUDED.voyage_no,
        loading_condition = EXCLUDED.loading_condition,
        "VoyageMeta_log_durationh_operational_LF" = EXCLUDED."VoyageMeta_log_durationh_operational_LF",
        "wnix_distance_nm_reported_distance_nm" = EXCLUDED."wnix_distance_nm_reported_distance_nm",
        "wnix_m_e_fuel_consumption_vlsfo_hfo_mt" = EXCLUDED."wnix_m_e_fuel_consumption_vlsfo_hfo_mt",
        "wnix_a_e_fuel_consumption_vlsfo_lfo_mt" = EXCLUDED."wnix_a_e_fuel_consumption_vlsfo_lfo_mt",
        "wnix_total_fuel_consumption_lfo_mt" = EXCLUDED."wnix_total_fuel_consumption_lfo_mt",
        "VoyageMeta_to_port_operational_LF" = EXCLUDED."VoyageMeta_to_port_operational_LF",
        "VoyageMeta_departure_port_last_leg_operational_LF" = EXCLUDED."VoyageMeta_departure_port_last_leg_operational_LF",
        "Vessel_SOG_avg_operational_LF" = EXCLUDED."Vessel_SOG_avg_operational_LF",
        "wnix_speed_reported_spd_kts" = EXCLUDED."wnix_speed_reported_spd_kts"
""")

_PARAMS = {"imo": POLAR_IMO, "src": POLAR_SOURCE}


def polar_wartsila_rows_exist(executor) -> bool:
    """True when expanded_wni_data already holds POLAR Wartsila rows.
    `executor` is a SQLAlchemy Session or Connection."""
    return executor.execute(_HAS_ROWS_SQL, _PARAMS).first() is not None


def sync_polar_wartsila(executor) -> int:
    """Copy POLAR's Wartsila reports into expanded_wni_data. Returns the row count.
    The caller commits (or rolls back)."""
    return executor.execute(_SYNC_SQL, _PARAMS).rowcount
