from __future__ import annotations

import hashlib
import importlib.util
import shutil
import tempfile
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / "tools" / "validate_powerpoint_addin.py"
SPEC = importlib.util.spec_from_file_location("validate_powerpoint_addin", MODULE_PATH)
assert SPEC and SPEC.loader
VALIDATOR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(VALIDATOR)
INSTALLER_GIT_ATTRIBUTES = """powerpoint/manifest.xml text eol=lf
scripts/*.sh text eol=lf
scripts/*.ps1 text eol=lf
"""


class PowerPointAddinTests(unittest.TestCase):
    def test_manifest(self) -> None:
        VALIDATOR.validate_manifest()

    def test_manifest_rejects_non_numeric_version(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            fixture = Path(directory) / "manifest.xml"
            tree = ET.parse(ROOT / "powerpoint" / "manifest.xml")
            version = tree.getroot().find("o:Version", {"o": VALIDATOR.NAMESPACE})
            self.assertIsNotNone(version)
            version.text = "1.two.0.0"
            tree.write(fixture, encoding="utf-8", xml_declaration=True)
            with mock.patch.object(VALIDATOR, "MANIFEST", fixture):
                with self.assertRaisesRegex(ValueError, "Version must have four numeric parts"):
                    VALIDATOR.validate_manifest()

    def test_manifest_rejects_untrusted_source_location(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            fixture = Path(directory) / "manifest.xml"
            tree = ET.parse(ROOT / "powerpoint" / "manifest.xml")
            source = tree.getroot().find("o:DefaultSettings/o:SourceLocation", {"o": VALIDATOR.NAMESPACE})
            self.assertIsNotNone(source)
            source.set("DefaultValue", "https://untrusted.example/powerpoint/content.html")
            tree.write(fixture, encoding="utf-8", xml_declaration=True)
            with mock.patch.object(VALIDATOR, "MANIFEST", fixture):
                with self.assertRaisesRegex(ValueError, "approved production URL"):
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

    def test_manifest_requires_embedded_presentation_storage_api(self) -> None:
        root = ET.parse(ROOT / "powerpoint" / "manifest.xml").getroot()
        requirement = root.find(
            "o:Requirements/o:Sets/o:Set",
            {"o": VALIDATOR.NAMESPACE},
        )
        self.assertIsNotNone(requirement)
        self.assertEqual(requirement.attrib.get("Name"), "PowerPointApi")
        self.assertEqual(requirement.attrib.get("MinVersion"), "1.7")

    def test_html_and_scripts(self) -> None:
        VALIDATOR.validate_html_and_scripts()

    def test_html_validation_requires_runtime_entrypoint_file(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            with mock.patch.object(VALIDATOR, "ROOT", Path(directory)):
                with self.assertRaisesRegex(ValueError, "missing runtime/dicom-slide.js"):
                    VALIDATOR.validate_html_and_scripts()

    def test_html_validation_does_not_accept_required_id_in_comment(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            fixture_root = Path(directory)
            fixture_powerpoint = fixture_root / "powerpoint"
            shutil.copytree(ROOT / "powerpoint", fixture_powerpoint)
            runtime_dir = fixture_root / "runtime"
            runtime_dir.mkdir()
            shutil.copy2(ROOT / "runtime" / "dicom-slide.js", runtime_dir / "dicom-slide.js")
            html_path = fixture_powerpoint / "content.html"
            html = html_path.read_text(encoding="utf-8")
            html_path.write_text(
                html.replace(
                    '<div id="viewerMount" class="viewer-mount"></div>',
                    '<div class="viewer-mount"></div><!-- id="viewerMount" -->',
                    1,
                ),
                encoding="utf-8",
            )
            with (
                mock.patch.object(VALIDATOR, "ROOT", fixture_root),
                mock.patch.object(VALIDATOR, "POWERPOINT", fixture_powerpoint),
            ):
                with self.assertRaisesRegex(ValueError, "viewerMount"):
                    VALIDATOR.validate_html_and_scripts()

    def test_javascript_validation_does_not_accept_contracts_in_comments(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            fixture_root = Path(directory)
            fixture_powerpoint = fixture_root / "powerpoint"
            shutil.copytree(ROOT / "powerpoint", fixture_powerpoint)
            runtime_dir = fixture_root / "runtime"
            runtime_dir.mkdir()
            shutil.copy2(ROOT / "runtime" / "dicom-slide.js", runtime_dir / "dicom-slide.js")
            (fixture_powerpoint / "content.js").write_text(
                "/* Office.onReady getActiveViewAsync ActiveViewChanged document.settings "
                "dicom-study-viewer importLocalFiles ensureRegistered dicom-slides-local: */\n",
                encoding="utf-8",
            )
            with (
                mock.patch.object(VALIDATOR, "ROOT", fixture_root),
                mock.patch.object(VALIDATOR, "POWERPOINT", fixture_powerpoint),
            ):
                with self.assertRaisesRegex(ValueError, "Office.onReady"):
                    VALIDATOR.validate_html_and_scripts()

    def test_powerpoint_uses_one_compact_viewer_toolbar(self) -> None:
        html = (ROOT / "powerpoint" / "content.html").read_text(encoding="utf-8")
        self.assertEqual(html.count('class="viewer-toolbar"'), 1)
        self.assertIn('<script src="presentation-storage.js"></script>', html)
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

    def test_powerpoint_status_does_not_consume_a_visible_row(self) -> None:
        html = (ROOT / "powerpoint" / "content.html").read_text(encoding="utf-8")
        self.assertNotIn('<footer', html)
        self.assertNotIn('class="brandbar"', html)
        self.assertIn('id="statusText" class="visually-hidden"', html)

    def test_browser_dicom_importer_contract(self) -> None:
        VALIDATOR.validate_importer()

    def test_powerpoint_loads_local_jpeg2000_decoder(self) -> None:
        html = (ROOT / "powerpoint" / "content.html").read_text(encoding="utf-8")
        self.assertIn(
            '<script src="vendor/openjpeg/openjpegwasm_decode.js"></script>',
            html,
        )
        codec_root = ROOT / "powerpoint" / "vendor" / "openjpeg"
        self.assertTrue((codec_root / "openjpegwasm_decode.js").is_file())
        self.assertTrue((codec_root / "openjpegwasm_decode.wasm").is_file())
        self.assertTrue((codec_root / "LICENSE").is_file())
        self.assertTrue((codec_root / "LICENSE-OPENJPEG").is_file())

    def test_powerpoint_loads_local_jpegls_decoder(self) -> None:
        html = (ROOT / "powerpoint" / "content.html").read_text(encoding="utf-8")
        self.assertIn(
            '<script src="vendor/charls/charlswasm_decode.js"></script>',
            html,
        )
        codec_root = ROOT / "powerpoint" / "vendor" / "charls"
        self.assertTrue((codec_root / "charlswasm_decode.js").is_file())
        self.assertTrue((codec_root / "charlswasm_decode.wasm").is_file())
        self.assertTrue((codec_root / "LICENSE").is_file())
        self.assertTrue((codec_root / "LICENSE-CHARLS").is_file())

    def test_runtime_entrypoint_is_present(self) -> None:
        self.assertTrue((ROOT / "runtime" / "dicom-slide.js").is_file())

    def test_readme_documents_sideloading_and_local_storage(self) -> None:
        VALIDATOR.validate_documentation()
        readme = (ROOT / "powerpoint" / "README.md").read_text(encoding="utf-8")
        self.assertIn(
            "https://thalesmms.github.io/dicom-slides/powerpoint/content.html",
            readme,
        )

    def test_installers_are_packaged(self) -> None:
        VALIDATOR.validate_installers()

    def test_installer_validation_rejects_a_missing_scripts_directory(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            with mock.patch.object(VALIDATOR, "ROOT", Path(directory)):
                with self.assertRaisesRegex(ValueError, "install-powerpoint-macos.sh"):
                    VALIDATOR.validate_installers()

    def test_installer_validation_requires_current_checksums_in_both_readmes(self) -> None:
        macos = ROOT / "scripts" / "install-powerpoint-macos.sh"
        windows = ROOT / "scripts" / "install-powerpoint-windows.ps1"
        macos_checksum = hashlib.sha256(macos.read_bytes()).hexdigest()
        windows_checksum = hashlib.sha256(windows.read_bytes()).hexdigest()
        complete_documentation = f"{macos_checksum}\n{windows_checksum}\n"

        for missing_readme in ("README.md", "powerpoint/README.md"):
            with self.subTest(missing_readme=missing_readme), tempfile.TemporaryDirectory() as directory:
                fixture_root = Path(directory)
                fixture_scripts = fixture_root / "scripts"
                fixture_scripts.mkdir()
                shutil.copy2(macos, fixture_scripts / macos.name)
                shutil.copy2(windows, fixture_scripts / windows.name)
                fixture_powerpoint = fixture_root / "powerpoint"
                fixture_powerpoint.mkdir()
                (fixture_root / "README.md").write_text(complete_documentation, encoding="utf-8")
                (fixture_powerpoint / "README.md").write_text(complete_documentation, encoding="utf-8")
                (fixture_root / ".gitattributes").write_text(INSTALLER_GIT_ATTRIBUTES, encoding="utf-8")
                (fixture_root / missing_readme).write_text(windows_checksum + "\n", encoding="utf-8")

                with mock.patch.object(VALIDATOR, "ROOT", fixture_root):
                    with self.assertRaisesRegex(ValueError, "current installer SHA-256"):
                        VALIDATOR.validate_installers()

    def test_installer_validation_requires_lf_checkout_rules(self) -> None:
        macos = ROOT / "scripts" / "install-powerpoint-macos.sh"
        windows = ROOT / "scripts" / "install-powerpoint-windows.ps1"
        checksums = "\n".join(
            hashlib.sha256(path.read_bytes()).hexdigest()
            for path in (macos, windows)
        )
        with tempfile.TemporaryDirectory() as directory:
            fixture_root = Path(directory)
            fixture_scripts = fixture_root / "scripts"
            fixture_scripts.mkdir()
            shutil.copy2(macos, fixture_scripts / macos.name)
            shutil.copy2(windows, fixture_scripts / windows.name)
            fixture_powerpoint = fixture_root / "powerpoint"
            fixture_powerpoint.mkdir()
            (fixture_root / "README.md").write_text(checksums, encoding="utf-8")
            (fixture_powerpoint / "README.md").write_text(checksums, encoding="utf-8")
            (fixture_root / ".gitattributes").write_text("* text=auto\n", encoding="utf-8")

            with mock.patch.object(VALIDATOR, "ROOT", fixture_root):
                with self.assertRaisesRegex(ValueError, "LF line endings"):
                    VALIDATOR.validate_installers()


if __name__ == "__main__":
    unittest.main()
