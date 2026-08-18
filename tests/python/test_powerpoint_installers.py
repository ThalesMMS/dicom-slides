from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "powerpoint" / "manifest.xml"
MACOS_INSTALLER = ROOT / "scripts" / "install-powerpoint-macos.sh"
WINDOWS_INSTALLER = ROOT / "scripts" / "install-powerpoint-windows.ps1"
POWERSHELL = os.environ.get("DICOM_SLIDES_PWSH") or shutil.which("pwsh")
MINIMAL_LOOKALIKE_MANIFEST = """<?xml version="1.0" encoding="UTF-8"?>
<OfficeApp xmlns="http://schemas.microsoft.com/office/appforoffice/1.1">
  <Id>3c8d5463-e606-4e35-86de-515114b31089</Id>
  <Hosts><Host Name="Presentation" /></Hosts>
  <DefaultSettings>
    <SourceLocation DefaultValue="https://thalesmms.github.io/dicom-slides/powerpoint/content.html" />
  </DefaultSettings>
</OfficeApp>
"""


class MacOSPowerPointInstallerTests(unittest.TestCase):
    def run_installer(self, *arguments: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["/bin/bash", str(MACOS_INSTALLER), *arguments],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
        )

    def test_install_and_update_preserve_other_addins(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            wef = Path(directory) / "wef"
            wef.mkdir()
            other_addin = wef / "other-addin.xml"
            other_addin.write_text("other", encoding="utf-8")

            result = self.run_installer(
                "--manifest-source", str(MANIFEST),
                "--wef-dir", str(wef),
                "--no-open",
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            installed = wef / "dicom-slides.xml"
            self.assertEqual(installed.read_bytes(), MANIFEST.read_bytes())
            self.assertEqual(other_addin.read_text(encoding="utf-8"), "other")
            self.assertIn("Installed DICOM Slides", result.stdout)

            installed.write_text("stale", encoding="utf-8")
            updated = self.run_installer(
                "--manifest-source", str(MANIFEST),
                "--wef-dir", str(wef),
                "--no-open",
            )
            self.assertEqual(updated.returncode, 0, updated.stderr)
            self.assertEqual(installed.read_bytes(), MANIFEST.read_bytes())
            self.assertIn("Updated DICOM Slides", updated.stdout)

    def test_invalid_manifest_does_not_replace_existing_installation(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            wef = root / "wef"
            wef.mkdir()
            installed = wef / "dicom-slides.xml"
            installed.write_text("known-good", encoding="utf-8")
            invalid = root / "invalid.xml"
            invalid.write_text(MINIMAL_LOOKALIKE_MANIFEST, encoding="utf-8")

            result = self.run_installer(
                "--manifest-source", str(invalid),
                "--wef-dir", str(wef),
                "--no-open",
            )

            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(installed.read_text(encoding="utf-8"), "known-good")
            self.assertIn("valid DICOM Slides manifest", result.stderr)

    def test_install_migrates_the_previous_manifest_filename(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            wef = Path(directory) / "wef"
            wef.mkdir()
            legacy = wef / "manifest.xml"
            legacy.write_bytes(MANIFEST.read_bytes())
            other_addin = wef / "other-addin.xml"
            other_addin.write_text("other", encoding="utf-8")

            result = self.run_installer(
                "--manifest-source", str(MANIFEST),
                "--wef-dir", str(wef),
                "--no-open",
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertFalse(legacy.exists())
            self.assertEqual((wef / "dicom-slides.xml").read_bytes(), MANIFEST.read_bytes())
            self.assertEqual(other_addin.read_text(encoding="utf-8"), "other")
            self.assertIn("Migrated the previous manifest.xml installation", result.stdout)

    def test_uninstall_removes_the_previous_manifest_filename_only_when_owned(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            wef = Path(directory) / "wef"
            wef.mkdir()
            legacy = wef / "manifest.xml"
            legacy.write_bytes(MANIFEST.read_bytes())
            other_addin = wef / "other-addin.xml"
            other_addin.write_text("other", encoding="utf-8")

            result = self.run_installer(
                "--uninstall",
                "--wef-dir", str(wef),
                "--no-open",
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertFalse(legacy.exists())
            self.assertEqual(other_addin.read_text(encoding="utf-8"), "other")
            self.assertIn("Uninstalled DICOM Slides", result.stdout)

    def test_install_and_uninstall_preserve_an_unrelated_legacy_filename(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            wef = root / "wef"
            wef.mkdir()
            legacy = wef / "manifest.xml"
            legacy.write_text("<OfficeApp><Id>another-add-in</Id></OfficeApp>", encoding="utf-8")

            installed = self.run_installer(
                "--manifest-source", str(MANIFEST),
                "--wef-dir", str(wef),
                "--no-open",
            )
            uninstalled = self.run_installer(
                "--uninstall",
                "--wef-dir", str(wef),
                "--no-open",
            )

            self.assertEqual(installed.returncode, 0, installed.stderr)
            self.assertEqual(uninstalled.returncode, 0, uninstalled.stderr)
            self.assertEqual(
                legacy.read_text(encoding="utf-8"),
                "<OfficeApp><Id>another-add-in</Id></OfficeApp>",
            )

    def test_uninstall_removes_only_dicom_slides(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            wef = Path(directory) / "wef"
            wef.mkdir()
            installed = wef / "dicom-slides.xml"
            installed.write_bytes(MANIFEST.read_bytes())
            other_addin = wef / "other-addin.xml"
            other_addin.write_text("other", encoding="utf-8")

            result = self.run_installer(
                "--uninstall",
                "--wef-dir", str(wef),
                "--no-open",
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertFalse(installed.exists())
            self.assertEqual(other_addin.read_text(encoding="utf-8"), "other")
            self.assertIn("Uninstalled DICOM Slides", result.stdout)

    def test_refuses_a_broad_wef_directory(self) -> None:
        result = self.run_installer(
            "--uninstall",
            "--wef-dir", "/",
            "--no-open",
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("unsafe WEF directory", result.stderr)


@unittest.skipUnless(POWERSHELL, "PowerShell is not available")
class WindowsPowerPointInstallerTests(unittest.TestCase):
    def run_installer(self, *arguments: str) -> subprocess.CompletedProcess[str]:
        assert POWERSHELL
        return subprocess.run(
            [POWERSHELL, "-NoLogo", "-NoProfile", "-File", str(WINDOWS_INSTALLER), *arguments],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
        )

    def test_prepare_and_update_preserve_other_downloads(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / "downloads"
            destination.mkdir()
            other_file = destination / "other-file.txt"
            other_file.write_text("other", encoding="utf-8")

            result = self.run_installer(
                "-ManifestSource", str(MANIFEST),
                "-DownloadDirectory", str(destination),
                "-NoOpen",
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            prepared = destination / "dicom-slides-manifest.xml"
            self.assertEqual(prepared.read_bytes(), MANIFEST.read_bytes())
            self.assertEqual(other_file.read_text(encoding="utf-8"), "other")
            self.assertIn("Prepared DICOM Slides", result.stdout)

            prepared.write_text("stale", encoding="utf-8")
            updated = self.run_installer(
                "-ManifestSource", str(MANIFEST),
                "-DownloadDirectory", str(destination),
                "-NoOpen",
            )
            self.assertEqual(updated.returncode, 0, updated.stderr)
            self.assertEqual(prepared.read_bytes(), MANIFEST.read_bytes())
            self.assertIn("Updated DICOM Slides", updated.stdout)

    def test_invalid_manifest_does_not_replace_prepared_copy(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            destination = root / "downloads"
            destination.mkdir()
            prepared = destination / "dicom-slides-manifest.xml"
            prepared.write_text("known-good", encoding="utf-8")
            invalid = root / "invalid.xml"
            invalid.write_text(MINIMAL_LOOKALIKE_MANIFEST, encoding="utf-8")

            result = self.run_installer(
                "-ManifestSource", str(invalid),
                "-DownloadDirectory", str(destination),
                "-NoOpen",
            )

            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(prepared.read_text(encoding="utf-8"), "known-good")
            self.assertIn("not a valid DICOM Slides", result.stderr.replace("\n", " "))

    def test_runs_on_windows_powershell_without_iswindows_variable(self) -> None:
        assert POWERSHELL
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / "downloads"
            destination.mkdir()
            quote = lambda value: str(value).replace("'", "''")
            command = (
                "Remove-Variable IsWindows -Force -ErrorAction SilentlyContinue; "
                f"& '{quote(WINDOWS_INSTALLER)}' "
                f"-ManifestSource '{quote(MANIFEST)}' "
                f"-DownloadDirectory '{quote(destination)}' "
                "-NoOpen"
            )

            result = subprocess.run(
                [POWERSHELL, "-NoLogo", "-NoProfile", "-Command", command],
                cwd=ROOT,
                capture_output=True,
                text=True,
                check=False,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue((destination / "dicom-slides-manifest.xml").is_file())

    def test_uninstall_removes_only_prepared_manifest(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / "downloads"
            destination.mkdir()
            prepared = destination / "dicom-slides-manifest.xml"
            prepared.write_bytes(MANIFEST.read_bytes())
            other_file = destination / "other-file.txt"
            other_file.write_text("other", encoding="utf-8")

            result = self.run_installer(
                "-Uninstall",
                "-DownloadDirectory", str(destination),
                "-NoOpen",
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertFalse(prepared.exists())
            self.assertEqual(other_file.read_text(encoding="utf-8"), "other")
            self.assertIn("Removed the prepared DICOM Slides manifest", result.stdout)

    def test_refuses_a_volume_root_as_download_directory(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            volume_root = Path(directory).anchor
            result = self.run_installer(
                "-Uninstall",
                "-DownloadDirectory", volume_root,
                "-NoOpen",
            )

            self.assertNotEqual(result.returncode, 0)
            self.assertIn("unsafe download directory", result.stderr)


if __name__ == "__main__":
    unittest.main()
