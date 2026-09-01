from __future__ import annotations

import importlib.util
import subprocess
import sys
import tempfile
from pathlib import Path
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from tools import convert_study


class PreparePixelsTests(unittest.TestCase):
    def test_missing_local_decoder_uses_gdcmconv_for_supported_jpeg_codecs(self) -> None:
        transfer_syntaxes = (
            "1.2.840.10008.1.2.4.90",
            "1.2.840.10008.1.2.4.80",
        )
        for transfer_syntax in transfer_syntaxes:
            with self.subTest(transfer_syntax=transfer_syntax), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                source = root / "source.dcm"
                source.write_bytes(b"compressed")
                destination = root / "prepared"
                destination.mkdir()

                def run_gdcm(command, **_kwargs):
                    Path(command[-1]).write_bytes(b"uncompressed")
                    return subprocess.CompletedProcess(command, 0, "", "")

                with (
                    mock.patch.object(importlib.util, "find_spec", return_value=None),
                    mock.patch.object(convert_study.subprocess, "run", side_effect=run_gdcm) as run,
                    mock.patch.object(
                        convert_study,
                        "parse_dicom",
                        side_effect=lambda path: {"path": str(path)},
                    ),
                ):
                    prepared = convert_study.prepare_pixels(
                        [{"path": str(source), "transferSyntaxUID": transfer_syntax}],
                        destination,
                        "/usr/local/bin/gdcmconv",
                    )

                target = destination / "000000.dcm"
                self.assertEqual(prepared, [{"path": str(target)}])
                run.assert_called_once()


if __name__ == "__main__":
    unittest.main()
