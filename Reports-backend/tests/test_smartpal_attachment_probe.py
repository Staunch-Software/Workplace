import json
import tempfile
import unittest
from pathlib import Path

from tools.smartpal_attachment_probe import load_target


class TargetMappingTests(unittest.TestCase):
    def test_loads_an_explicit_smartpal_mapping(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "targets.json"
            path.write_text(json.dumps([{
                "key": "ae1",
                "vessel_name": "AM TARANG",
                "smartpal_equipment_code": "200.02.02",
                "report_label": "AE-1 performance",
            }]), encoding="utf-8")
            target = load_target("ae1", path)
        self.assertEqual(target.smartpal_equipment_code, "200.02.02")

    def test_refuses_a_mapping_without_external_code(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "targets.json"
            path.write_text(json.dumps([{
                "key": "ae1", "vessel_name": "AM TARANG",
                "smartpal_equipment_code": "", "report_label": "AE-1",
            }]), encoding="utf-8")
            with self.assertRaises(ValueError):
                load_target("ae1", path)


if __name__ == "__main__":
    unittest.main()
