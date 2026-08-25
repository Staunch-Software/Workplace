"""Shared word-grouping helpers for the position-based PDF parsers (DNV, ABS)."""


def group_lines(words, tol=2.0):
    """Group extracted words into physical text lines by vertical position."""
    lines = []
    for w in sorted(words, key=lambda w: (w["top"], w["x0"])):
        if lines and abs(w["top"] - lines[-1]["top"]) <= tol:
            lines[-1]["words"].append(w)
        else:
            lines.append({"top": w["top"], "words": [w]})
    for line in lines:
        line["words"].sort(key=lambda w: w["x0"])
        line["text"] = " ".join(w["text"] for w in line["words"])
    return lines


def cluster_rows(lines, gap_threshold=8.0):
    """Group physical lines into logical rows by vertical gap.

    A wrapped cell's overflow line can render either just BEFORE or just AFTER its row's
    data line (confirmed against a real ABS report — both patterns occur), so row-start
    can't be inferred from column content alone. But the vertical gap between a wrapped
    line and its own row's other lines is consistently much smaller (~half the normal row
    pitch) than the gap between two different rows. Cluster on that instead.
    """
    rows = []
    for line in lines:
        if rows and (line["top"] - rows[-1][-1]["top"]) <= gap_threshold:
            rows[-1].append(line)
        else:
            rows.append([line])
    return rows


def assign_columns(line_words, columns):
    """columns: list of (name, x_start, x_end). Returns {name: joined_text}."""
    buckets = {name: [] for name, _, _ in columns}
    for w in line_words:
        cx = (w["x0"] + w["x1"]) / 2
        for name, x_start, x_end in columns:
            if x_start <= cx < x_end:
                buckets[name].append(w["text"])
                break
    return {name: " ".join(words) for name, words in buckets.items()}
