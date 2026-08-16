from __future__ import annotations

import struct
import sys
import tempfile
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from tools import convert_dicom


def explicit_element(group: int, element: int, vr: bytes, payload: bytes) -> bytes:
    padding = b"\0" if vr == b"UI" else b" "
    if len(payload) % 2:
        payload += padding
    return struct.pack("<HH2sH", group, element, vr, len(payload)) + payload


def explicit_element_endian(group: int, element: int, vr: bytes, payload: bytes, endian: str) -> bytes:
    padding = b"\0" if vr == b"UI" else b" "
    if len(payload) % 2:
        payload += padding
    if vr in convert_dicom.LONG_VR:
        return struct.pack(f"{endian}HH2sHI", group, element, vr, 0, len(payload)) + payload
    return struct.pack(f"{endian}HH2sH", group, element, vr, len(payload)) + payload


def implicit_element(group: int, element: int, payload: bytes) -> bytes:
    if len(payload) % 2:
        payload += b" "
    return struct.pack("<HHI", group, element, len(payload)) + payload


class DicomMetadataEncodingTests(unittest.TestCase):
    def write_metadata_file(self, root: Path, character_set: bytes, description: bytes) -> Path:
        path = root / "metadata.dcm"
        dataset = b"".join(
            [
                explicit_element(0x0002, 0x0010, b"UI", b"1.2.840.10008.1.2.1"),
                explicit_element(0x0008, 0x0005, b"CS", character_set),
                explicit_element(0x0008, 0x1030, b"LO", description),
                explicit_element(0x0028, 0x0010, b"US", struct.pack("<H", 1)),
                explicit_element(0x0028, 0x0011, b"US", struct.pack("<H", 1)),
                explicit_element(0x0028, 0x0100, b"US", struct.pack("<H", 16)),
                explicit_element(0x0028, 0x0103, b"US", struct.pack("<H", 1)),
            ]
        )
        path.write_bytes(bytes(128) + b"DICM" + dataset)
        return path

    def test_decodes_iso_ir_100_text_without_replacement_characters(self) -> None:
        with tempfile.TemporaryDirectory(prefix="dicom-slide-charset-test-") as temporary:
            path = self.write_metadata_file(
                Path(temporary),
                b"ISO_IR 100",
                "IRM cérébrale, neuro-crâne".encode("latin-1"),
            )

            meta = convert_dicom.parse_dicom(path, require_pixels=False)

            self.assertEqual(meta["specificCharacterSet"], "ISO_IR 100")
            self.assertEqual(meta["studyDescription"], "IRM cérébrale, neuro-crâne")
            self.assertNotIn("�", meta["studyDescription"])

    def test_decodes_iso_ir_101_and_rejects_unknown_declared_charsets(self) -> None:
        with tempfile.TemporaryDirectory(prefix="dicom-slide-charset-test-") as temporary:
            root = Path(temporary)
            path = self.write_metadata_file(root, b"ISO_IR 101", "Příliš žluťoučký".encode("iso8859-2"))
            self.assertEqual(
                convert_dicom.parse_dicom(path, require_pixels=False)["studyDescription"],
                "Příliš žluťoučký",
            )

            path = self.write_metadata_file(root, b"ISO_IR 999", b"unsupported")
            with self.assertRaisesRegex(ValueError, "Unsupported DICOM Specific Character Set"):
                convert_dicom.parse_dicom(path, require_pixels=False)

            path = self.write_metadata_file(root, b"ISO 2022 IR 100", b"\x1b-Aunsupported")
            with self.assertRaisesRegex(ValueError, "code extension"):
                convert_dicom.parse_dicom(path, require_pixels=False)


class BigEndianDicomTests(unittest.TestCase):
    def test_reads_explicit_vr_big_endian_metadata_and_signed_pixels(self) -> None:
        with tempfile.TemporaryDirectory(prefix="dicom-slide-big-endian-test-") as temporary:
            path = Path(temporary) / "big-endian.dcm"
            file_meta = explicit_element_endian(
                0x0002,
                0x0010,
                b"UI",
                b"1.2.840.10008.1.2.2",
                "<",
            )
            dataset = b"".join(
                [
                    explicit_element_endian(0x0008, 0x0060, b"CS", b"MR", ">"),
                    explicit_element_endian(0x0028, 0x0002, b"US", struct.pack(">H", 1), ">"),
                    explicit_element_endian(0x0028, 0x0004, b"CS", b"MONOCHROME2", ">"),
                    explicit_element_endian(0x0028, 0x0010, b"US", struct.pack(">H", 1), ">"),
                    explicit_element_endian(0x0028, 0x0011, b"US", struct.pack(">H", 2), ">"),
                    explicit_element_endian(0x0028, 0x0100, b"US", struct.pack(">H", 16), ">"),
                    explicit_element_endian(0x0028, 0x0101, b"US", struct.pack(">H", 16), ">"),
                    explicit_element_endian(0x0028, 0x0102, b"US", struct.pack(">H", 15), ">"),
                    explicit_element_endian(0x0028, 0x0103, b"US", struct.pack(">H", 1), ">"),
                    explicit_element_endian(0x7FE0, 0x0010, b"OW", struct.pack(">hh", -100, 200), ">"),
                ]
            )
            path.write_bytes(bytes(128) + b"DICM" + file_meta + dataset)

            meta = convert_dicom.parse_dicom(path)
            pixels = convert_dicom.read_hu(meta)

            self.assertEqual(meta["transferSyntaxUID"], "1.2.840.10008.1.2.2")
            self.assertEqual((meta["rows"], meta["columns"]), (1, 2))
            self.assertEqual(list(pixels), [-100, 200])


class ImplicitVrDicomTests(unittest.TestCase):
    def test_infers_numeric_vrs_for_implicit_little_endian(self) -> None:
        with tempfile.TemporaryDirectory(prefix="dicom-slide-implicit-vr-test-") as temporary:
            path = Path(temporary) / "implicit-vr.dcm"
            file_meta = explicit_element_endian(
                0x0002,
                0x0010,
                b"UI",
                b"1.2.840.10008.1.2",
                "<",
            )
            dataset = b"".join(
                [
                    implicit_element(0x0008, 0x0060, b"MR"),
                    implicit_element(0x0028, 0x0002, struct.pack("<H", 1)),
                    implicit_element(0x0028, 0x0004, b"MONOCHROME2"),
                    implicit_element(0x0028, 0x0010, struct.pack("<H", 1)),
                    implicit_element(0x0028, 0x0011, struct.pack("<H", 2)),
                    implicit_element(0x0028, 0x0100, struct.pack("<H", 16)),
                    implicit_element(0x0028, 0x0101, struct.pack("<H", 16)),
                    implicit_element(0x0028, 0x0102, struct.pack("<H", 15)),
                    implicit_element(0x0028, 0x0103, struct.pack("<H", 1)),
                    implicit_element(0x7FE0, 0x0010, struct.pack("<hh", -100, 200)),
                ]
            )
            path.write_bytes(bytes(128) + b"DICM" + file_meta + dataset)

            meta = convert_dicom.parse_dicom(path)
            pixels = convert_dicom.read_hu(meta)

            self.assertEqual(meta["transferSyntaxUID"], "1.2.840.10008.1.2")
            self.assertEqual((meta["rows"], meta["columns"]), (1, 2))
            self.assertEqual(meta["bitsAllocated"], 16)
            self.assertEqual(list(pixels), [-100, 200])


class PresetLabelTests(unittest.TestCase):
    def test_uses_english_authored_preset_labels(self) -> None:
        from tools import convert_dicom

        _, ct_presets = convert_dicom.presets_for_series(
            {"modality": "CT", "windowCenter": 40, "windowWidth": 400},
            -1024,
            2000,
        )
        self.assertEqual(ct_presets["soft"]["label"], "Soft tissue")
        self.assertEqual(ct_presets["lung"]["label"], "Lung")
        self.assertEqual(ct_presets["bone"]["label"], "Bone")

        _, mr_presets = convert_dicom.presets_for_series(
            {"modality": "MR", "windowCenter": 100, "windowWidth": 200},
            0,
            1000,
        )
        self.assertEqual(mr_presets["full"]["label"], "Full range")


class EncapsulatedPixelDataTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="dicom-slide-j2k-test-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)

    def write_encapsulated(self, fragments: list[bytes], *, corrupt_first_fragment: bool = False) -> tuple[dict, bytes]:
        payload = bytearray(struct.pack("<HHI", 0xFFFE, 0xE000, 0))
        for index, fragment in enumerate(fragments):
            tag = (0x0008, 0x0008) if corrupt_first_fragment and index == 0 else (0xFFFE, 0xE000)
            payload.extend(struct.pack("<HHI", tag[0], tag[1], len(fragment)))
            payload.extend(fragment)
        payload.extend(struct.pack("<HHI", 0xFFFE, 0xE0DD, 0))
        path = self.root / "encapsulated.bin"
        path.write_bytes(payload)
        return {"path": str(path), "pixelOffset": 0}, b"".join(fragments)

    def test_extracts_one_frame_from_multiple_fragments(self) -> None:
        meta, expected = self.write_encapsulated([b"\xff\x4fAB", b"CD\xff\xd9"])
        extract = getattr(convert_dicom, "extract_encapsulated_single_frame", None)
        self.assertIsNotNone(extract, "JPEG 2000 encapsulated-frame extractor is missing")
        self.assertEqual(extract(meta), expected)

    def test_rejects_a_non_item_pixel_fragment(self) -> None:
        meta, _ = self.write_encapsulated([b"broken"], corrupt_first_fragment=True)
        extract = getattr(convert_dicom, "extract_encapsulated_single_frame", None)
        self.assertIsNotNone(extract, "JPEG 2000 encapsulated-frame extractor is missing")
        with self.assertRaisesRegex(ValueError, "fragment item"):
            extract(meta)


if __name__ == "__main__":
    unittest.main()
