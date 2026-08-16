from __future__ import annotations

import base64
import gzip
import json
import re
import struct
import sys
import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))


PAYLOAD_RE = re.compile(r"var p=(\[.*?\]);if\(")


class VisibleHumanImporterTests(unittest.TestCase):
    def test_uses_the_nominal_spacing_when_coordinates_contain_a_gap(self) -> None:
        from tools import import_visible_human

        self.assertEqual(import_visible_human.nominal_slice_spacing([1554.0, 1560.0, 1563.0]), 3.0)

    def test_retries_a_transient_download_timeout(self) -> None:
        from tools import import_visible_human

        class Response:
            def __init__(self, payload=None, error=None):
                self.payload = payload
                self.error = error

            def __enter__(self):
                return self

            def __exit__(self, *_):
                return False

            def read(self):
                if self.error:
                    raise self.error
                return self.payload

        png = b"\x89PNG\r\n\x1a\n" + b"test"
        responses = [Response(error=TimeoutError("temporary timeout")), Response(payload=png)]
        with tempfile.TemporaryDirectory(prefix="dicom-slide-vhp-download-test-") as temporary:
            with patch.object(import_visible_human, "urlopen", side_effect=responses) as opener:
                index, path = import_visible_human.download_one(
                    "frozenCT", 1500, Path(temporary), retries=2, retry_delay=0
                )

            self.assertEqual(index, 1500)
            self.assertEqual(path.read_bytes(), png)
            self.assertEqual(opener.call_count, 2)

    def test_skips_the_documented_normal_ct_acquisition_gap(self) -> None:
        from tools import import_visible_human

        normal, frozen = import_visible_human.source_indices(1554, 1560)

        self.assertEqual(normal, [1554, 1560])
        self.assertEqual(frozen, list(range(1554, 1561)))

    def test_packages_downsampled_png_slices_as_hounsfield_units(self) -> None:
        try:
            from tools import import_visible_human
        except ImportError:
            self.fail("Visible Human PNG importer is missing")

        with tempfile.TemporaryDirectory(prefix="dicom-slide-vhp-test-") as temporary:
            root = Path(temporary)
            source_images = []
            for slice_index, offset in [(1500, 0), (1501, 100)]:
                path = root / f"cvm{slice_index:04d}f.png"
                values = [1024 + offset + value for value in range(16)]
                image = Image.frombytes("I;16", (4, 4), struct.pack("<16H", *values))
                image.save(path)
                source_images.append((slice_index, path))

            output = root / "series"
            manifest = import_visible_human.package_series(
                source_images,
                output,
                case_id="visible-human-test--frozen-ct",
                title="Frozen CT",
                series_number="2",
                series_kind="frozenCT",
                downsample=2,
                chunk_size=1,
            )

            self.assertEqual(manifest["dimensions"], {"columns": 2, "rows": 2, "slices": 2})
            self.assertEqual(manifest["spacing"], {"column": 1.796875, "row": 1.796875, "slice": 1.0})
            self.assertEqual(manifest["sliceCoordinates"], [-515.0, -514.0])
            self.assertEqual(manifest["valueRange"], {"minimum": 0, "maximum": 110})
            self.assertEqual(manifest["source"]["rawToHU"], "stored value - 1024")

            chunks = []
            for spec in manifest["chunks"]:
                script = (output / spec["script"]).read_text(encoding="utf-8")
                match = PAYLOAD_RE.search(script)
                self.assertIsNotNone(match)
                _, _, encoded = json.loads(match.group(1))
                chunks.extend(struct.unpack("<4h", gzip.decompress(base64.b64decode(encoded))))
            self.assertEqual(chunks, [100, 102, 108, 110, 0, 2, 8, 10])

    def test_packages_slices_in_inferior_to_superior_patient_order(self) -> None:
        from tools import import_visible_human

        with tempfile.TemporaryDirectory(prefix="dicom-slide-vhp-order-test-") as temporary:
            root = Path(temporary)
            source_images = []
            for slice_index, stored_value in [(1500, 1024), (1501, 1124)]:
                path = root / f"cvm{slice_index:04d}f.png"
                image = Image.frombytes("I;16", (2, 2), struct.pack("<4H", *([stored_value] * 4)))
                image.save(path)
                source_images.append((slice_index, path))

            output = root / "series"
            manifest = import_visible_human.package_series(
                source_images,
                output,
                case_id="visible-human-test--frozen-ct-order",
                title="Frozen CT order",
                series_number="2",
                series_kind="frozenCT",
                downsample=1,
                chunk_size=2,
            )

            self.assertEqual(manifest["sliceCoordinates"], [-515.0, -514.0])
            self.assertEqual(manifest["source"]["firstSourceIndex"], 1500)
            self.assertEqual(manifest["source"]["lastSourceIndex"], 1501)

            script = (output / manifest["chunks"][0]["script"]).read_text(encoding="utf-8")
            match = PAYLOAD_RE.search(script)
            self.assertIsNotNone(match)
            _, _, encoded = json.loads(match.group(1))
            voxels = struct.unpack("<8h", gzip.decompress(base64.b64decode(encoded)))
            self.assertEqual(voxels, (100, 100, 100, 100, 0, 0, 0, 0))


if __name__ == "__main__":
    unittest.main()
