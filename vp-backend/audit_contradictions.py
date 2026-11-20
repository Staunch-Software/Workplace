"""
Read-only audit, second batch of the Fleet Noon Records Issues Log (2026-11-19):
the CONTRADICTION codes (E06, E07, E10, E11, C02, C03, C04, C06) and the PORT
codes (E08, D01, D02, D03), counted against OUR MariApps tables next to the
report's numbers. E09 (ROB per fuel type) is not covered here. Writes nothing.

    python audit_contradictions.py > contradictions.txt

Notes
- E08 / D01-D03 concern port strings. Our Country and EU Port? columns are DERIVED
  by expander.py from the port string, so a wrong or missing port name / LOCODE can
  give a wrong EU flag - the audit lists the distinct strings for review.
- C02 needs signed positions. lon_direction was repaired 2026-11-20; a report with a
  blank direction is treated as East/North here.
- The report counted duplicated export rows and AMNS TUFMAX (not in our data), so
  small differences from the report are expected.
"""
import math
import re
from collections import Counter, defaultdict

from sqlalchemy import text

from backend.database import SessionLocal

db = SessionLocal()
names = {i: n for i, n in db.execute(text("SELECT imo_number, vessel_name FROM vessels")).fetchall()}
NUM = r"^[-+]?[0-9]+(\.[0-9]+)?$"


def xn(col):  # numeric from an expanded (text) column, NULL when blank
    return f"(CASE WHEN x.\"{col}\"::text ~ '{NUM}' THEN x.\"{col}\"::double precision END)"


def rn(col):  # numeric from a raw text column, 0 when blank
    return f"(CASE WHEN r.{col}::text ~ '{NUM}' THEN r.{col}::double precision ELSE 0 END)"


FROM = ("FROM mariapps_reports_data r JOIN expanded_mariapps_data x ON x.raw_log_id = r.raw_report_id")
DUR = "r.log_duration"
DIST = "r.distance_og"
BL_FUELS = " + ".join(rn(f"bl_{g}") for g in ("hfo", "lfo", "mdo", "bio_fuel"))

# code, title, report count, [(label, SQL condition)]
CODES = [
    ("E06", "Boiler total > 0 but no boiler / IG fuel entered", 1,
     [("", f"{rn('bl_total_cons')} > 0 AND ({BL_FUELS}) = 0 AND COALESCE({xn('emissionx_ig_other_mt')}, 0) = 0")]),
    ("E07", "Grand total fuel = 0 on a report with duration >= 2 h", 7,
     [("", f"COALESCE({xn('emissionx_grand_total_mt')}, 0) = 0 AND {DUR} >= 2")]),
    ("E10", "Laden with no cargo / Ballast with cargo", 314,
     [("Laden, cargo = 0", "x.loading_condition = 'Laden' AND r.cargo_on_board = 0"),
      ("Ballast, cargo > 0", "x.loading_condition = 'Ballast' AND r.cargo_on_board > 0"),
      ("Ballast, cargo > 100 t", "x.loading_condition = 'Ballast' AND r.cargo_on_board > 100"),
      ("Ballast, cargo > 1000 t", "x.loading_condition = 'Ballast' AND r.cargo_on_board > 1000")]),
    ("E11", "'Noon at port' with distance > 5 nm", 221,
     [("> 5 nm", f"x.log_type ILIKE 'noon at port%' AND {DIST} > 5"),
      ("> 20 nm", f"x.log_type ILIKE 'noon at port%' AND {DIST} > 20")]),
    ("C03", "Distance/duration disagrees with SOG, or implies > 20 kn", 120,
     [("distance > 0 but duration 0/blank", f"{DIST} > 0 AND ({DUR} IS NULL OR {DUR} = 0)"),
      ("distance/duration differs from SOG by > 1 kn", f"{DUR} > 0 AND {DIST} IS NOT NULL AND r.speed_og IS NOT NULL AND ABS({DIST} / {DUR} - r.speed_og) > 1"),
      ("implied speed > 20 kn", f"{DUR} > 0 AND {DIST} / {DUR} > 20"),
      ("ANY of the above", f"({DIST} > 0 AND ({DUR} IS NULL OR {DUR} = 0)) OR ({DUR} > 0 AND {DIST} IS NOT NULL AND r.speed_og IS NOT NULL AND ABS({DIST} / {DUR} - r.speed_og) > 1) OR ({DUR} > 0 AND {DIST} / {DUR} > 20)")]),
    ("C04", "ME running hours exceed log duration", 323,
     [("any excess", f"{xn('ME_RHME_dCnt_operational_LF')} > {DUR} AND {DUR} IS NOT NULL"),
      ("excess > 1 h", f"{xn('ME_RHME_dCnt_operational_LF')} > {DUR} + 1 AND {DUR} IS NOT NULL")]),
    ("C06", "Invalid latitude / longitude (minutes >= 60 or degrees out of range)", 1,
     [("", "r.lat_minutes >= 60 OR r.lon_minutes >= 60 OR r.lat_degree > 90 OR r.lon_degree > 180")]),
]


def sql_codes():
    summary = []
    for code, title, report_n, variants in CODES:
        print(f"\n{code}  {title}")
        ours_main = None
        for label, cond in variants:
            try:
                rows = db.execute(text(f"SELECT x.vessel_imo, COUNT(*) {FROM} WHERE {cond} GROUP BY 1 ORDER BY 2 DESC")).fetchall()
            except Exception as ex:
                db.rollback()
                print(f"   !! {label or 'check'} could not run: {type(ex).__name__}: {str(ex)[:150]}")
                continue
            total = sum(c for _, c in rows)
            tag = f"[{label}] " if label else ""
            top = ", ".join(f"{names.get(i, i)} {c}" for i, c in rows[:8])
            print(f"   {tag}ours: {total}   (report {report_n})" + (f"   {top}" if rows else ""))
            if ours_main is None or label in ("any excess", "ANY of the above", "> 5 nm", "Ballast, cargo > 0"):
                ours_main = total
        summary.append((code, ours_main, report_n))
    return summary


# ---------------------------------------------------------------- C02
def haversine_nm(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    dp = p2 - p1
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 3440.065 * 2 * math.asin(math.sqrt(a))


def signed(deg, minutes, direction, neg):
    if deg is None:
        return None
    v = abs(deg) + (minutes or 0) / 60.0
    return -v if (direction or "").strip().upper()[:1] == neg else v


def position_jumps():
    print("\nC02  Position jump: distance between positions far exceeds distance reported")
    rows = db.execute(text("""
        SELECT x.vessel_imo, r.log_number, r.log_date, r.distance_og,
               r.lat_degree, r.lat_minutes, r.lat_direction, r.lon_degree, r.lon_minutes, r.lon_direction
        FROM mariapps_reports_data r JOIN expanded_mariapps_data x ON x.raw_log_id = r.raw_report_id
        ORDER BY x.vessel_imo, r.log_date, r.id""")).fetchall()
    by_vessel = defaultdict(list)
    for r in rows:
        by_vessel[r[0]].append(r)
    flagged = Counter()
    hemi = 0
    examples = []
    compared = 0
    for imo, rs in by_vessel.items():
        prev = None
        for r in rs:
            lat = signed(r[4], r[5], r[6], "S")
            lon = signed(r[7], r[8], r[9], "W")
            cur = (r[2], lat, lon)
            if prev and lat is not None and lon is not None and prev[1] is not None and prev[2] is not None \
                    and r[3] is not None and prev[0] and r[2] and 0 <= (r[2] - prev[0]).days <= 2:
                compared += 1
                gc = haversine_nm(prev[1], prev[2], lat, lon)
                if abs(gc - r[3]) > max(60.0, 0.10 * r[3]):
                    flagged[imo] += 1
                    flip = haversine_nm(prev[1], prev[2], lat, -lon)
                    if abs(flip - r[3]) <= max(60.0, 0.10 * r[3]):
                        hemi += 1
                    if len(examples) < 8:
                        examples.append((names.get(imo, imo), r[1], r[2].date(), round(gc), r[3]))
            if lat is not None and lon is not None:
                prev = cur
            else:
                prev = None
    total = sum(flagged.values())
    print(f"   report pairs compared (consecutive reports <= 2 days apart): {compared}")
    print(f"   ours: {total}   (report 139)   " + ", ".join(f"{names.get(i, i)} {c}" for i, c in flagged.most_common(8)))
    print(f"   of which a hemisphere flip would explain the jump: {hemi}")
    for e in examples:
        print(f"      {e[0]:16} {e[1]} {e[2]}: positions {e[3]} nm apart, distance reported {e[4]}")
    return ("C02", total, 139)


# ---------------------------------------------------------------- ports
LOCODE_OK = re.compile(r"\{[A-Za-z]{2}[A-Za-z0-9]{3}\}")
LOCODE_ANY = re.compile(r"\{[^}]*\}")
EU_HINTS = ("tenerif", "teneriff", "canar", "las palmas", "algecir", "valencia", "barcelona", "rotterdam", "antwerp",
            "marseille", "fos", "genoa", "genova", "trieste", "piraeus", "lisbon", "sines", "hamburg", "gdansk", "riga",
            "tallinn", "helsinki", "bilbao", "cartagena", "malaga", "huelva", "gijon", "vigo", "amsterdam", "le havre",
            "dunkirk", "zeebrugge", "bremerhaven", "gothenburg", "oslo", "bergen", "napoli", "naples", "livorno",
            "la spezia", "taranto", "augusta", "ravenna", "venice", "koper", "rijeka", "constanta", "klaipeda", "cork", "dublin")


def ports():
    rows = db.execute(text("""
        SELECT x.vessel_imo,
               x."VoyageMeta_departure_port_last_leg_operational_LF" AS dep,
               x."VoyageMeta_to_port_operational_LF" AS dest,
               x.emissionx_from_country, x.emissionx_to_country, x.emissionx_from_eu_port, x.emissionx_to_eu_port
        FROM expanded_mariapps_data x""")).fetchall()
    dep_strings = Counter((r[1] or "").strip() for r in rows if (r[1] or "").strip())

    print("\nD01  Port LOCODE missing or malformed (departure port strings, which should read 'Name {LOCODE},Country')")
    no_loc = Counter({s: c for s, c in dep_strings.items() if not LOCODE_ANY.search(s)})
    bad_loc = Counter({s: c for s, c in dep_strings.items() if LOCODE_ANY.search(s) and not LOCODE_OK.search(s)})
    print(f"   ours: {sum(no_loc.values()) + sum(bad_loc.values())} reports   (report 2064)   "
          f"no LOCODE {sum(no_loc.values())}, malformed LOCODE {sum(bad_loc.values())}")
    print("   malformed (top):", dict(bad_loc.most_common(10)))
    print("   no LOCODE (top):", dict(no_loc.most_common(10)))
    print("   destination port strings carry no LOCODE by design (bare name): "
          f"{sum(1 for r in rows if (r[2] or '').strip())} reports")

    print("\nD02  LOCODE country does not match the country text (data-driven: ISO2 prefix vs the usual country for it)")
    iso_country = defaultdict(Counter)
    parsed = []
    for s, c in dep_strings.items():
        m = re.search(r"\{([A-Za-z]{2})[A-Za-z0-9 ]*\}\s*,\s*(.+)$", s)
        if m:
            iso_country[m.group(1).upper()][m.group(2).strip()] += c
            parsed.append((s, m.group(1).upper(), m.group(2).strip(), c))
    usual = {iso: cnt.most_common(1)[0][0] for iso, cnt in iso_country.items()}
    mism = [(s, iso, ctry, c) for s, iso, ctry, c in parsed if ctry != usual[iso]]
    print(f"   ours: {sum(c for *_, c in mism)} reports   (report 44)")
    for s, iso, ctry, c in sorted(mism, key=lambda t: -t[3])[:10]:
        print(f"      {s!r}: LOCODE {iso} usually = {usual[iso]!r}, here {ctry!r} ({c} reports)")

    print("\nD03  English ports listed under 'Scotland'")
    sc = Counter(s for s in dep_strings.elements() if "scotland" in s.lower())
    print(f"   ours: {sum(sc.values())} reports   (report 68)   {dict(sc.most_common(10))}")

    print("\nE08  EU Port? flag contradicts the port (our DERIVED flag)")
    to_n = Counter()
    for r in rows:
        dest = (r[2] or "").strip()
        if dest and r[6] == "N":
            to_n[dest] += 1
    hits = {d: c for d, c in to_n.items() if any(h in d.lower() for h in EU_HINTS)}
    print(f"   destination ports flagged N that look like EU ports: {sum(hits.values())} reports   (report 5)   {hits}")
    print("   most common destination ports flagged N (review for EU/EEA ports):")
    print("     " + ", ".join(f"{d} {c}" for d, c in to_n.most_common(40)))
    return [("D01", sum(no_loc.values()) + sum(bad_loc.values()), 2064), ("D02", sum(c for *_, c in mism), 44),
            ("D03", sum(sc.values()), 68), ("E08", sum(hits.values()), 5)]


def main():
    summary = sql_codes()
    summary.append(position_jumps())
    summary.extend(ports())
    n = db.execute(text("SELECT COUNT(*) FROM expanded_mariapps_data")).scalar()
    print("\n" + "=" * 70)
    print(f"SUMMARY (our expanded_mariapps_data rows: {n}; E09 not covered)")
    print(f"{'code':5} {'ours':>7} {'report':>7}")
    for code, ours, rep in summary:
        print(f"{code:5} {ours if ours is not None else '-':>7} {rep:>7}")
    db.close()
    print("\nDone. Read-only: nothing was written.")


if __name__ == "__main__":
    main()
