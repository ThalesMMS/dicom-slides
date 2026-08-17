from __future__ import annotations

import importlib.util
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / "tools" / "validate_powerpoint_addin.py"
SPEC = importlib.util.spec_from_file_location("validate_powerpoint_addin", MODULE_PATH)
assert SPEC and SPEC.loader
VALIDATOR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(VALIDATOR)


class PowerPointAddinTests(unittest.TestCase):
    def test_manifest(self) -> None:
        VALIDATOR.validate_manifest()

    def test_manifest_metadata_is_english(self) -> None:
        root = ET.parse(ROOT / "powerpoint" / "manifest.xml").getroot()
        namespace = {"o": VALIDATOR.NAMESPACE}
        locale = root.find("o:DefaultLocale", namespace)
        description = root.find("o:Description", namespace)
        self.assertIsNotNone(locale)
        self.assertIsNotNone(description)
        self.assertEqual(locale.text, "en-US")
        self.assertEqual(
            description.attrib.get("DefaultValue"),
            "Import DICOM and view interactive 2D stacks, MPR, and 3D volume rendering in PowerPoint slides.",
        )

    def test_html_and_scripts(self) -> None:
        VALIDATOR.validate_html_and_scripts()

    def test_powerpoint_uses_one_compact_viewer_toolbar(self) -> None:
        html = (ROOT / "powerpoint" / "content.html").read_text(encoding="utf-8")
        self.assertEqual(html.count('class="viewer-toolbar"'), 1)
        self.assertIn('<script src="powerpoint-host.js"></script>', html)
        for control_id in (
            "importButton",
            "toolWindowButton",
            "toolPanButton",
            "toolZoomButton",
            "toolScrollButton",
            "windowPresetSelect",
            "seriesSelect",
            "mode2dButton",
            "modeMprButton",
            "mode3dButton",
            "resetViewButton",
            "expandViewButton",
        ):
            self.assertIn(f'id="{control_id}"', html)
        for removed_id in ("studyLabel", "modeBadge", "seriesBadge", "sliceBadge"):
            self.assertNotIn(f'id="{removed_id}"', html)
        self.assertNotIn('class="brand-block"', html)
        self.assertNotIn('class="state-badges"', html)

    def test_browser_dicom_importer_contract(self) -> None:
        VALIDATOR.validate_importer()

    def test_readme_documents_sideloading_and_local_storage(self) -> None:
        VALIDATOR.validate_documentation()


if __name__ == "__main__":
    unittest.main()
