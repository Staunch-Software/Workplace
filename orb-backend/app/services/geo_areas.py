"""Special areas and polar waters for alert 33 (automatic bilge discharge, Code E).

APPROXIMATE: each area is a bounding box, not the legal boundary of MARPOL Annex I Regulation 1.11 / Polar Code
waters. They are used only to raise an Observation ("confirm the 15 ppm alarm and automatic stop"), or, for the
polar areas, a Major alert, so a box is deliberately kept inside the real area where it matters (the Arctic uses
the Arctic Circle, narrower than the Polar Code waters). Refine the table, or replace it with polygons, when a
stricter reading is required.
"""

# (name, lat_min, lat_max, lon_min, lon_max)
SPECIAL_AREAS = [
    ("Mediterranean Sea",               30.0,  46.0,  -5.6,  36.5),
    ("Baltic Sea",                      53.5,  66.0,   9.3,  30.5),
    ("Black Sea",                       40.9,  47.5,  27.4,  41.8),
    ("Red Sea",                         12.5,  30.0,  32.3,  43.6),
    ("Gulfs area",                      23.5,  30.5,  48.0,  57.0),
    ("Gulf of Aden",                    11.3,  15.0,  43.0,  52.0),
    ("North West European waters",      48.0,  62.5, -20.0,  13.0),
    ("Oman area of the Arabian Sea",    16.6,  25.5,  53.3,  62.0),
    ("Southern South African waters",  -47.0, -31.2,  16.5,  50.0),
]

ANTARCTIC_LAT = -60.0       # south of 60°S
ARCTIC_LAT = 66.5           # north of the Arctic Circle (the Polar Code waters are wider)

POLAR = ("Antarctic area", "Arctic waters")


def special_area(lat: float, lon: float) -> str | None:
    """Name of the special or polar area containing the position, or None."""
    if lat < ANTARCTIC_LAT:
        return "Antarctic area"
    if lat > ARCTIC_LAT:
        return "Arctic waters"
    for name, la0, la1, lo0, lo1 in SPECIAL_AREAS:
        if la0 <= lat <= la1 and lo0 <= lon <= lo1:
            return name
    return None
