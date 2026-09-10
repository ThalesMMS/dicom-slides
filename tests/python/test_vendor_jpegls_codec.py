from __future__ import annotations

import os
import shutil
import subprocess
import tarfile
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
ASSETS = ("charlswasm_decode.js", "charlswasm_decode.wasm")


class VendorJpegLSCodecTests(unittest.TestCase):
    def run_vendor(self, corrupted: str | None, existing: bool) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            scripts = root / "scripts"
            scripts.mkdir()
            script = scripts / "vendor-jpegls-codec.sh"
            shutil.copyfile(ROOT / "scripts" / script.name, script)
            package = root / "package" / "dist"
            package.mkdir(parents=True)
            destination = root / "powerpoint" / "vendor" / "charls"
            originals = {name: f"existing {name}".encode() for name in ASSETS}
            if existing:
                destination.mkdir(parents=True)
                for name, content in originals.items():
                    (destination / name).write_bytes(content)
            for name in ASSETS:
                shutil.copyfile(ROOT / "powerpoint" / "vendor" / "charls" / name, package / name)
            if corrupted:
                with (package / corrupted).open("ab") as asset:
                    asset.write(b"altered npm pack output")
            archive = root / "fixture.tgz"
            with tarfile.open(archive, "w:gz") as tar:
                tar.add(package.parent, arcname="package")
            npm = scripts / "npm"
            npm.write_text('#!/bin/sh\ncp "$TEST_ARCHIVE" "$4/fixture.tgz"\n', encoding="utf-8")
            npm.chmod(0o755)
            result = subprocess.run(
                ["bash", str(script)],
                env={**os.environ, "PATH": f"{scripts}{os.pathsep}{os.environ['PATH']}",
                     "TEST_ARCHIVE": str(archive)},
                capture_output=True, text=True, check=False,
            )
            if corrupted:
                self.assertNotEqual(result.returncode, 0, result.stdout)
                self.assertIn(f"{corrupted}: FAILED", result.stdout)
                if existing:
                    for name in ASSETS:
                        self.assertEqual((destination / name).read_bytes(), originals[name])
                else:
                    self.assertFalse(destination.exists())
            else:
                self.assertEqual(result.returncode, 0, result.stderr)
                for name in ASSETS:
                    self.assertEqual((destination / name).read_bytes(), (package / name).read_bytes())

    def test_checksum_failure_preserves_destination(self) -> None:
        for corrupted in ASSETS:
            for existing in (False, True):
                with self.subTest(corrupted=corrupted, existing=existing):
                    self.run_vendor(corrupted, existing)

    def test_verified_assets_are_installed(self) -> None:
        for existing in (False, True):
            with self.subTest(existing=existing):
                self.run_vendor(None, existing)


if __name__ == "__main__":
    unittest.main()
