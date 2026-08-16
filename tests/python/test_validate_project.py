from __future__ import annotations

import json
import sys
import struct
import tempfile
from pathlib import Path
import unittest

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from tools import validate_project
from tools import import_visible_human


class StudyValidationTests(unittest.TestCase):
    def test_accepts_a_png_derived_study_with_an_image_file_count(self) -> None:
        with tempfile.TemporaryDirectory(prefix="dicom-slide-png-study-test-") as temporary:
            root = Path(temporary)
            images = []
            for index in (1500, 1501):
                path = root / f"cvm{index:04d}f.png"
                Image.frombytes("I;16", (4, 4), struct.pack("<16H", *([1024] * 16))).save(path)
                images.append((index, path))
            output = root / "study"
            import_visible_human.package_study(images, images, output, downsample=2, chunk_size=1)

            validate_project.validate_study(output)
            study = json.loads((output / "study.json").read_text(encoding="utf-8"))
            self.assertEqual(study["title"], "Visible Human Male — abdominal CT")
            self.assertEqual(
                [series["title"] for series in study["series"]],
                ["Normal CT (before freezing)", "CT after freezing"],
            )
            normal_manifest = json.loads(
                (output / "series" / "normal-ct" / "manifest.json").read_text(encoding="utf-8")
            )
            self.assertEqual(normal_manifest["presets"]["soft"]["label"], "Soft tissue")
            self.assertEqual(normal_manifest["presets"]["lung"]["label"], "Lung")
            self.assertEqual(normal_manifest["presets"]["bone"]["label"], "Bone")


if __name__ == "__main__":
    unittest.main()
