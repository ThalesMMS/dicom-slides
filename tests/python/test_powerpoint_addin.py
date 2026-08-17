from __future__ import annotations

import importlib.util
import unittest
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

    def test_html_and_scripts(self) -> None:
        VALIDATOR.validate_html_and_scripts()

    def test_browser_dicom_importer_contract(self) -> None:
        VALIDATOR.validate_importer()

    def test_readme_documents_sideloading_and_local_storage(self) -> None:
        VALIDATOR.validate_documentation()


if __name__ == "__main__":
    unittest.main()
