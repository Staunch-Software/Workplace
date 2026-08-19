from datetime import datetime
import unittest

from app.scraper.smartpal_scraper_corrected import (
    ReportTarget,
    choose_exact_candidate,
    normalise_report_code,
    safe_blob_name,
)


class ExactMatchTests(unittest.TestCase):
    def test_normalises_formatting_only(self):
        self.assertEqual(normalise_report_code(" 200. 02.02 "), "200.02.02")

    def test_rejects_similar_but_wrong_first_result(self):
        candidates = ["200.02.03 Deck Weekly", "200.02.02 Engine Weekly"]
        self.assertEqual(choose_exact_candidate("200.02.02", candidates), candidates[1])

    def test_returns_none_when_expected_code_is_absent(self):
        self.assertIsNone(choose_exact_candidate("200.02.02", ["200.02.03 Deck Weekly"]))

    def test_blob_path_removes_path_traversal_from_filename(self):
        target = ReportTarget("9290777", "AM TARANG", "200.02.02", "Weekly")
        path = safe_blob_name(target, "../report?.pdf", datetime(2026, 8, 15))
        self.assertEqual(path, "reports/9290777/200.02.02/2026-08-15_report.pdf")


if __name__ == "__main__":
    unittest.main()
