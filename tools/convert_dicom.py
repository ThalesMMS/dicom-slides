#!/usr/bin/env python3
"""Convert one DICOM series into a dependency-free browser package.

The generated case contains:
  * gzip-compressed Int16 or RGB8 chunks wrapped in classic JavaScript files;
  * a manifest.js file registered in a small global registry.

Uncompressed input uses only Python's standard library. Optional conversion
dependencies decode single-frame JPEG 2000 and JPEG-LS while the generated
presentation runtime remains independent of DICOM parsers and codecs.
"""
from __future__ import annotations

import argparse
import array
import base64
import gzip
import io
import json
import math
from pathlib import Path
import struct
import sys

LONG_VR = {b"OB", b"OD", b"OF", b"OL", b"OW", b"SQ", b"UC", b"UR", b"UT", b"UN", b"OV", b"SV", b"UV"}
TEXT_VR = {b"AE", b"AS", b"CS", b"DA", b"DS", b"DT", b"IS", b"LO", b"LT", b"PN", b"SH", b"ST", b"TM", b"UC", b"UI", b"UR", b"UT"}
TARGETS = {
    (0x0002, 0x0010): "transferSyntaxUID",
    (0x0008, 0x0005): "specificCharacterSet",
    (0x0008, 0x0060): "modality",
    (0x0008, 0x1030): "studyDescription",
    (0x0008, 0x103E): "seriesDescription",
    (0x0010, 0x0010): "patientName",
    (0x0010, 0x0020): "patientID",
    (0x0018, 0x0050): "sliceThickness",
    (0x0018, 0x0088): "spacingBetweenSlices",
    (0x0020, 0x000D): "studyInstanceUID",
    (0x0020, 0x000E): "seriesInstanceUID",
    (0x0020, 0x0011): "seriesNumber",
    (0x0020, 0x0013): "instanceNumber",
    (0x0020, 0x0032): "imagePositionPatient",
    (0x0020, 0x0037): "imageOrientationPatient",
    (0x0020, 0x1041): "sliceLocation",
    (0x0028, 0x0002): "samplesPerPixel",
    (0x0028, 0x0004): "photometricInterpretation",
    (0x0028, 0x0006): "planarConfiguration",
    (0x0028, 0x0008): "numberOfFrames",
    (0x0028, 0x0010): "rows",
    (0x0028, 0x0011): "columns",
    (0x0028, 0x0030): "pixelSpacing",
    (0x0028, 0x0100): "bitsAllocated",
    (0x0028, 0x0101): "bitsStored",
    (0x0028, 0x0102): "highBit",
    (0x0028, 0x0103): "pixelRepresentation",
    (0x0028, 0x1050): "windowCenter",
    (0x0028, 0x1051): "windowWidth",
    (0x0028, 0x1052): "rescaleIntercept",
    (0x0028, 0x1053): "rescaleSlope",
}

IMPLICIT_VR_BY_TAG = {
    (0x0028, 0x0002): b"US",
    (0x0028, 0x0006): b"US",
    (0x0028, 0x0010): b"US",
    (0x0028, 0x0011): b"US",
    (0x0028, 0x0100): b"US",
    (0x0028, 0x0101): b"US",
    (0x0028, 0x0102): b"US",
    (0x0028, 0x0103): b"US",
    (0x7FE0, 0x0010): b"OW",
}

DICOM_ENCODINGS = {
    "": "ascii",
    "ISO_IR 6": "ascii",
    "ISO_IR 100": "latin-1",
    "ISO_IR 101": "iso8859-2",
    "ISO_IR 109": "iso8859-3",
    "ISO_IR 110": "iso8859-4",
    "ISO_IR 144": "iso8859-5",
    "ISO_IR 127": "iso8859-6",
    "ISO_IR 126": "iso8859-7",
    "ISO_IR 138": "iso8859-8",
    "ISO_IR 148": "iso8859-9",
    "ISO_IR 166": "tis-620",
    "ISO_IR 13": "shift_jis",
    "ISO_IR 192": "utf-8",
    "GB18030": "gb18030",
    "GBK": "gbk",
}

GENERIC_CT_PRESETS = {
    "dicom": {"label": "DICOM", "center": 40.0, "width": 400.0},
    "soft": {"label": "Soft tissue", "center": 40.0, "width": 400.0},
    "lung": {"label": "Lung", "center": -600.0, "width": 1500.0},
    "bone": {"label": "Bone", "center": 500.0, "width": 2000.0},
}

JPEG2000_TRANSFER_SYNTAXES = {
    "1.2.840.10008.1.2.4.90",
    "1.2.840.10008.1.2.4.91",
}
JPEGLS_TRANSFER_SYNTAXES = {
    "1.2.840.10008.1.2.4.80",
    "1.2.840.10008.1.2.4.81",
}

IMPLICIT_VR_LITTLE_ENDIAN = "1.2.840.10008.1.2"
EXPLICIT_VR_LITTLE_ENDIAN = "1.2.840.10008.1.2.1"
EXPLICIT_VR_BIG_ENDIAN = "1.2.840.10008.1.2.2"
UNCOMPRESSED_TRANSFER_SYNTAXES = {
    IMPLICIT_VR_LITTLE_ENDIAN,
    EXPLICIT_VR_LITTLE_ENDIAN,
    EXPLICIT_VR_BIG_ENDIAN,
}


def split_numbers(value: str | None) -> list[float]:
    if not value:
        return []
    result = []
    for part in value.split("\\"):
        try:
            result.append(float(part.strip()))
        except ValueError:
            pass
    return result


def first_number(value, default: float) -> float:
    if value is None:
        return default
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).split("\\", 1)[0].strip()
    try:
        return float(text)
    except ValueError:
        return default


def dicom_text_encoding(specific_character_set: str | None) -> str:
    declared = [value.strip() for value in (specific_character_set or "").split("\\") if value.strip()]
    if len(declared) > 1:
        raise ValueError(
            f"Unsupported DICOM Specific Character Set code extension: {specific_character_set}"
        )
    primary = declared[0] if declared else ""
    if primary.startswith("ISO 2022 "):
        raise ValueError(f"Unsupported DICOM Specific Character Set code extension: {primary}")
    if primary not in DICOM_ENCODINGS:
        raise ValueError(f"Unsupported DICOM Specific Character Set: {primary}")
    return DICOM_ENCODINGS[primary]


def decode_value(vr: bytes, payload: bytes, encoding: str = "ascii", endian: str = "<"):
    if vr in TEXT_VR or vr == b"UN":
        return payload.rstrip(b"\0 ").decode(encoding, "strict")
    if vr == b"US" and len(payload) >= 2:
        values = struct.unpack(endian + "H" * (len(payload) // 2), payload)
        return values[0] if len(values) == 1 else list(values)
    if vr == b"SS" and len(payload) >= 2:
        values = struct.unpack(endian + "h" * (len(payload) // 2), payload)
        return values[0] if len(values) == 1 else list(values)
    if vr == b"UL" and len(payload) >= 4:
        values = struct.unpack(endian + "I" * (len(payload) // 4), payload)
        return values[0] if len(values) == 1 else list(values)
    if vr == b"SL" and len(payload) >= 4:
        values = struct.unpack(endian + "i" * (len(payload) // 4), payload)
        return values[0] if len(values) == 1 else list(values)
    return None


def skip_undefined_length(data: bytes, offset: int, endian: str = "<") -> int:
    # Sufficient for the simple metadata sequences encountered before PixelData.
    delimiter = struct.pack(f"{endian}HH", 0xFFFE, 0xE0DD)
    end = data.find(delimiter, offset)
    if end < 0 or end + 8 > len(data):
        return len(data)
    return end + 8


def parse_dicom(path: Path, require_pixels: bool = True) -> dict:
    data = path.read_bytes()
    offset = 132 if len(data) >= 132 and data[128:132] == b"DICM" else 0
    meta: dict = {"path": str(path)}
    explicit = True
    endian = "<"
    transfer_syntax = EXPLICIT_VR_LITTLE_ENDIAN
    text_encoding = "ascii"
    in_meta = True

    while offset + 8 <= len(data):
        is_file_meta = False
        if in_meta:
            little_group, little_element = struct.unpack_from("<HH", data, offset)
            if little_group == 0x0002:
                group, element = little_group, little_element
                is_file_meta = True
            else:
                in_meta = False
                explicit = transfer_syntax != IMPLICIT_VR_LITTLE_ENDIAN
                endian = ">" if transfer_syntax == EXPLICIT_VR_BIG_ENDIAN else "<"
                group, element = struct.unpack_from(f"{endian}HH", data, offset)
        else:
            group, element = struct.unpack_from(f"{endian}HH", data, offset)

        value_endian = "<" if is_file_meta else endian
        value_explicit = is_file_meta or explicit

        offset += 4
        if value_explicit:
            vr = data[offset : offset + 2]
            offset += 2
            if len(vr) < 2:
                break
            if vr in LONG_VR:
                offset += 2
                if offset + 4 > len(data):
                    break
                length = struct.unpack_from(f"{value_endian}I", data, offset)[0]
                offset += 4
            else:
                if offset + 2 > len(data):
                    break
                length = struct.unpack_from(f"{value_endian}H", data, offset)[0]
                offset += 2
        else:
            vr = b"UN"
            if offset + 4 > len(data):
                break
            length = struct.unpack_from(f"{value_endian}I", data, offset)[0]
            offset += 4

        tag = (group, element)
        if not value_explicit:
            vr = IMPLICIT_VR_BY_TAG.get(tag, b"UN")
        if tag == (0x7FE0, 0x0010):
            meta["pixelOffset"] = offset
            meta["pixelLength"] = length
            meta["pixelVR"] = vr.decode("ascii", "replace")
            break

        if length == 0xFFFFFFFF:
            offset = skip_undefined_length(data, offset, value_endian)
            continue
        if offset + length > len(data):
            break

        name = TARGETS.get(tag)
        if name:
            value_encoding = "ascii" if name == "specificCharacterSet" else text_encoding
            value = decode_value(vr, data[offset : offset + length], value_encoding, value_endian)
            if value is not None:
                meta[name] = value
                if name == "transferSyntaxUID":
                    transfer_syntax = str(value)
                elif name == "specificCharacterSet":
                    text_encoding = dicom_text_encoding(str(value))

        offset += length

    required = ["rows", "columns", "bitsAllocated", "pixelRepresentation"]
    if require_pixels:
        required += ["pixelOffset", "pixelLength"]
    missing = [key for key in required if key not in meta]
    if missing:
        raise ValueError(f"{path.name}: missing required DICOM fields: {', '.join(missing)}")
    return meta


def cross(a: list[float], b: list[float]) -> list[float]:
    return [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]


def dot(a: list[float], b: list[float]) -> float:
    return sum(x * y for x, y in zip(a, b))


def slice_coordinate(meta: dict) -> float:
    orientation = split_numbers(meta.get("imageOrientationPatient"))
    position = split_numbers(meta.get("imagePositionPatient"))
    if len(orientation) >= 6 and len(position) >= 3:
        normal = cross(orientation[:3], orientation[3:6])
        return dot(position[:3], normal)
    return first_number(meta.get("sliceLocation"), first_number(meta.get("instanceNumber"), 0.0))


def series_has_consistent_orientation(records: list[dict], tolerance: float = 1e-4) -> bool:
    reference = split_numbers(records[0].get("imageOrientationPatient")) if records else []
    if len(reference) < 6:
        return False
    for record in records[1:]:
        orientation = split_numbers(record.get("imageOrientationPatient"))
        if len(orientation) < 6:
            return False
        if any(abs(left - right) > tolerance for left, right in zip(reference[:6], orientation[:6])):
            return False
    return True


def sort_series_records(records: list[dict]) -> tuple[list[dict], str]:
    if series_has_consistent_orientation(records):
        return sorted(records, key=slice_coordinate), "spatial"
    return sorted(records, key=lambda item: first_number(item.get("instanceNumber"), 0.0)), "instance"


def stored_values_to_int16(values, meta: dict) -> array.array:
    bits = int(meta["bitsAllocated"])
    signed = int(meta.get("pixelRepresentation", 0)) == 1
    slope = first_number(meta.get("rescaleSlope"), 1.0)
    intercept = first_number(meta.get("rescaleIntercept"), 0.0)
    bits_stored = int(meta.get("bitsStored", bits))
    mask = (1 << bits_stored) - 1
    sign_bit = 1 << (bits_stored - 1)
    output = array.array("h")
    append = output.append
    for raw in values:
        raw = int(raw) & mask
        if signed and raw & sign_bit:
            raw -= 1 << bits_stored
        hu = int(round(raw * slope + intercept))
        append(max(-32768, min(32767, hu)))
    if sys.byteorder != "little":
        output.byteswap()
    return output


def extract_encapsulated_single_frame(meta: dict) -> bytes:
    if int(first_number(meta.get("numberOfFrames"), 1)) != 1:
        raise ValueError("Only single-frame encapsulated DICOM input is supported")
    data = Path(meta["path"]).read_bytes()
    offset = int(meta["pixelOffset"])
    item_index = 0
    fragments: list[bytes] = []

    while offset + 8 <= len(data):
        group, element, length = struct.unpack_from("<HHI", data, offset)
        offset += 8
        if (group, element) == (0xFFFE, 0xE0DD):
            if length != 0:
                raise ValueError("Encapsulated Pixel Data sequence delimiter has a non-zero length")
            if not fragments:
                raise ValueError("Encapsulated frame has no pixel fragments")
            return b"".join(fragments)
        if (group, element) != (0xFFFE, 0xE000):
            raise ValueError("Expected encapsulated fragment item")
        if length == 0xFFFFFFFF or offset + length > len(data):
            raise ValueError("Encapsulated pixel fragment is truncated")
        payload = data[offset : offset + length]
        offset += length
        if item_index > 0:
            fragments.append(payload)
        item_index += 1

    raise ValueError("Encapsulated frame is missing the Sequence Delimitation Item")


def jpeg2000_component_format(codestream: bytes) -> tuple[int, bool]:
    marker = codestream.find(b"\xff\x51")
    if marker < 0 or marker + 41 > len(codestream):
        raise ValueError("JPEG 2000 codestream has no complete SIZ marker")
    segment_length = int.from_bytes(codestream[marker + 2 : marker + 4], "big")
    if segment_length < 39 or marker + 2 + segment_length > len(codestream):
        raise ValueError("JPEG 2000 SIZ marker is truncated")
    component_count = int.from_bytes(codestream[marker + 38 : marker + 40], "big")
    if component_count != 1:
        raise ValueError(f"JPEG 2000 frame has {component_count} components; expected one")
    sample_format = codestream[marker + 40]
    return (sample_format & 0x7F) + 1, bool(sample_format & 0x80)


def decode_jpeg2000(meta: dict) -> array.array:
    try:
        from PIL import Image
    except ImportError as error:
        raise RuntimeError("JPEG 2000 decoding requires Pillow during offline conversion") from error

    codestream = extract_encapsulated_single_frame(meta)
    component_precision, component_signed = jpeg2000_component_format(codestream)
    dicom_signed = int(meta.get("pixelRepresentation", 0)) == 1
    if component_signed != dicom_signed:
        raise ValueError(
            f"JPEG 2000 signedness ({component_signed}) does not match DICOM Pixel Representation ({dicom_signed})"
        )
    try:
        with Image.open(io.BytesIO(codestream)) as image:
            image.load()
            expected_size = (int(meta["columns"]), int(meta["rows"]))
            if image.size != expected_size:
                raise ValueError(f"JPEG 2000 dimensions are {image.size}; expected {expected_size}")
            if len(image.getbands()) != 1:
                raise ValueError(f"JPEG 2000 frame is not monochrome: mode {image.mode}")
            flattened = getattr(image, "get_flattened_data", None)
            values = list(flattened() if flattened else image.getdata())
    except ValueError:
        raise
    except Exception as error:
        raise ValueError(f"Could not decode JPEG 2000 frame: {error}") from error

    expected_pixels = int(meta["rows"]) * int(meta["columns"])
    if len(values) != expected_pixels:
        raise ValueError(f"JPEG 2000 pixel count is {len(values)}; expected {expected_pixels}")
    if image.mode.startswith("I;16") and component_precision < 16:
        shift = 16 - component_precision
        values = [int(value) >> shift for value in values]
    return stored_values_to_int16(values, meta)




def decode_jpegls_array(meta: dict):
    try:
        import numpy
        import pydicom
        from pydicom.pixels import pixel_array
    except ImportError as error:
        raise RuntimeError(
            "JPEG-LS decoding requires pydicom, NumPy, and pyjpegls during offline conversion"
        ) from error

    try:
        decoded = numpy.asarray(pixel_array(meta["path"], raw=False))
    except Exception as error:
        raise ValueError(f"Could not decode JPEG-LS frame: {error}") from error

    rows = int(meta["rows"])
    columns = int(meta["columns"])
    samples = int(meta.get("samplesPerPixel", 1))
    expected_shape = (rows, columns) if samples == 1 else (rows, columns, samples)
    if decoded.shape != expected_shape:
        raise ValueError(f"JPEG-LS decoded shape is {decoded.shape}; expected {expected_shape}")
    return decoded


def decode_jpegls_monochrome(meta: dict) -> array.array:
    decoded = decode_jpegls_array(meta)
    return stored_values_to_int16(decoded.reshape(-1).tolist(), meta)


def decode_jpegls_rgb(meta: dict) -> bytes:
    decoded = decode_jpegls_array(meta)
    if int(meta.get("samplesPerPixel", 1)) != 3 or int(meta["bitsAllocated"]) != 8:
        raise ValueError("JPEG-LS RGB input must use three 8-bit allocated samples per pixel")
    if decoded.dtype.kind not in {"u", "i"} or decoded.min() < 0 or decoded.max() > 255:
        raise ValueError(f"JPEG-LS RGB decoder returned unsupported sample range {decoded.min()}..{decoded.max()}")
    return decoded.astype("uint8", copy=False).tobytes(order="C")


def read_hu(meta: dict) -> array.array:
    transfer_syntax = str(meta.get("transferSyntaxUID", "1.2.840.10008.1.2.1")).strip()
    if int(first_number(meta.get("numberOfFrames"), 1)) != 1:
        raise ValueError("Only single-frame DICOM input is supported")

    bits = int(meta["bitsAllocated"])
    if bits not in (8, 16):
        raise ValueError(f"Only 8/16-bit input is supported, found {bits}")
    if int(meta.get("samplesPerPixel", 1)) != 1:
        raise ValueError("Only monochrome input is supported")
    if transfer_syntax in JPEG2000_TRANSFER_SYNTAXES:
        return decode_jpeg2000(meta)
    if transfer_syntax in JPEGLS_TRANSFER_SYNTAXES:
        return decode_jpegls_monochrome(meta)
    if transfer_syntax not in UNCOMPRESSED_TRANSFER_SYNTAXES:
        raise ValueError(f"Compressed or unsupported transfer syntax: {transfer_syntax}")

    path = Path(meta["path"])
    with path.open("rb") as handle:
        handle.seek(int(meta["pixelOffset"]))
        payload = handle.read(int(meta["pixelLength"]))

    expected_pixels = int(meta["rows"]) * int(meta["columns"])
    expected_bytes = expected_pixels * (bits // 8)
    if len(payload) < expected_bytes:
        raise ValueError(f"Pixel payload is truncated: expected {expected_bytes} bytes, found {len(payload)}")
    payload = payload[:expected_bytes]

    signed = int(meta.get("pixelRepresentation", 0)) == 1
    if bits == 16:
        fmt = "h" if signed else "H"
        values = array.array(fmt)
        values.frombytes(payload)
        source_is_little_endian = transfer_syntax != EXPLICIT_VR_BIG_ENDIAN
        if source_is_little_endian != (sys.byteorder == "little"):
            values.byteswap()
    else:
        fmt = "b" if signed else "B"
        values = array.array(fmt, payload)
    return stored_values_to_int16(values, meta)


def read_rgb(meta: dict) -> bytes:
    transfer_syntax = str(meta.get("transferSyntaxUID", "1.2.840.10008.1.2.1")).strip()
    if transfer_syntax in JPEGLS_TRANSFER_SYNTAXES:
        return decode_jpegls_rgb(meta)
    if transfer_syntax not in UNCOMPRESSED_TRANSFER_SYNTAXES:
        raise ValueError(f"Compressed or unsupported transfer syntax: {transfer_syntax}")
    if int(first_number(meta.get("numberOfFrames"), 1)) != 1:
        raise ValueError("Only single-frame DICOM input is supported")
    if int(meta.get("samplesPerPixel", 1)) != 3 or int(meta["bitsAllocated"]) != 8:
        raise ValueError("RGB input must use three 8-bit samples per pixel")
    if safe_text(meta, "photometricInterpretation").upper() != "RGB":
        raise ValueError(f"Unsupported color space: {safe_text(meta, 'photometricInterpretation')}")

    expected_pixels = int(meta["rows"]) * int(meta["columns"])
    expected_bytes = expected_pixels * 3
    path = Path(meta["path"])
    with path.open("rb") as handle:
        handle.seek(int(meta["pixelOffset"]))
        payload = handle.read(int(meta["pixelLength"]))
    if len(payload) < expected_bytes:
        raise ValueError(f"Pixel payload is truncated: expected {expected_bytes} bytes, found {len(payload)}")
    payload = payload[:expected_bytes]

    if int(meta.get("planarConfiguration", 0)) == 0:
        return payload
    red = payload[:expected_pixels]
    green = payload[expected_pixels : expected_pixels * 2]
    blue = payload[expected_pixels * 2 :]
    interleaved = bytearray(expected_bytes)
    for index in range(expected_pixels):
        target = index * 3
        interleaved[target] = red[index]
        interleaved[target + 1] = green[index]
        interleaved[target + 2] = blue[index]
    return bytes(interleaved)


def js_registration(case_id: str, chunk_index: int, encoded: str) -> str:
    return (
        "(function(g){var p="
        + json.dumps([case_id, chunk_index, encoded], separators=(",", ":"))
        + ";if(g.DicomSlideData&&g.DicomSlideData.registerChunk){g.DicomSlideData.registerChunk.apply(null,p);}"
        + "else{(g.__DICOM_SLIDE_PENDING_CHUNKS__||(g.__DICOM_SLIDE_PENDING_CHUNKS__=[])).push(p);}})(window);\n"
    )


def manifest_registration(case_id: str, manifest: dict) -> str:
    payload = json.dumps(manifest, ensure_ascii=False, separators=(",", ":"))
    return f"""(function(g){{
var base=new URL('.',document.currentScript.src).href;
var m={payload};m.baseUrl=base;
var p=[{json.dumps(case_id)},m];
if(g.DicomSlideData&&g.DicomSlideData.registerManifest){{g.DicomSlideData.registerManifest.apply(null,p);}}
else{{(g.__DICOM_SLIDE_PENDING_MANIFESTS__||(g.__DICOM_SLIDE_PENDING_MANIFESTS__=[])).push(p);}}
}})(window);\n"""


def safe_text(meta: dict, key: str) -> str:
    value = meta.get(key)
    return "" if value is None else str(value).strip()


def presets_for_series(first: dict, minimum: int, maximum: int) -> tuple[dict, dict]:
    range_width = max(1.0, float(maximum - minimum))
    range_center = float(minimum) + range_width / 2.0
    dicom_center = first_number(first.get("windowCenter"), range_center)
    dicom_width = first_number(first.get("windowWidth"), range_width)
    if not math.isfinite(dicom_center) or not math.isfinite(dicom_width) or dicom_width < 1:
        dicom_center, dicom_width = range_center, range_width

    presets = {
        "dicom": {"label": "DICOM", "center": dicom_center, "width": dicom_width},
    }
    if safe_text(first, "modality").upper() == "CT":
        presets.update({key: dict(value) for key, value in GENERIC_CT_PRESETS.items() if key != "dicom"})
    else:
        presets["full"] = {"label": "Full range", "center": range_center, "width": range_width}
    return {"center": dicom_center, "width": dicom_width}, presets


def convert_records(
    records: list[dict],
    output_dir: Path,
    case_id: str,
    chunk_size: int,
    *,
    original_transfer_syntax: str | None = None,
) -> dict:
    if not records:
        raise ValueError("Cannot convert an empty DICOM series")
    records, sort_mode = sort_series_records(records)
    first = records[0]
    rows = int(first["rows"])
    columns = int(first["columns"])
    expected_pixels = rows * columns
    samples_per_pixel = int(first.get("samplesPerPixel", 1))
    is_rgb = samples_per_pixel == 3
    if samples_per_pixel not in (1, 3):
        raise ValueError(f"Unsupported Samples per Pixel: {samples_per_pixel}")
    orientation = split_numbers(first.get("imageOrientationPatient"))
    spacing = split_numbers(first.get("pixelSpacing"))
    positions = [slice_coordinate(record) for record in records]
    increments = [positions[i + 1] - positions[i] for i in range(len(positions) - 1)]
    slice_spacing = (
        sum(increments) / len(increments)
        if sort_mode == "spatial" and increments
        else first_number(first.get("sliceThickness"), 1.0)
    )

    output_dir.mkdir(parents=True, exist_ok=True)
    chunks_dir = output_dir / "chunks"
    chunks_dir.mkdir(exist_ok=True)

    chunk_specs = []
    chunk_buffer = bytearray()
    chunk_first = 0
    chunk_index = 0
    global_min = 32767
    global_max = -32768
    invert = not is_rgb and safe_text(first, "photometricInterpretation").upper() == "MONOCHROME1"

    for index, record in enumerate(records):
        if int(record["rows"]) != rows or int(record["columns"]) != columns:
            raise ValueError("Series dimensions are inconsistent")
        if int(record.get("samplesPerPixel", 1)) != samples_per_pixel:
            raise ValueError("Series samples per pixel are inconsistent")
        pixels = read_rgb(record) if is_rgb else read_hu(record)
        expected_values = expected_pixels * (3 if is_rgb else 1)
        if len(pixels) != expected_values:
            raise ValueError(f"{Path(record['path']).name}: unexpected pixel count")
        local_min = min(pixels)
        local_max = max(pixels)
        global_min = min(global_min, local_min)
        global_max = max(global_max, local_max)
        chunk_buffer.extend(pixels if is_rgb else pixels.tobytes())

        is_last = index == len(records) - 1
        if (index - chunk_first + 1) >= chunk_size or is_last:
            compressed = gzip.compress(bytes(chunk_buffer), compresslevel=9, mtime=0)
            encoded = base64.b64encode(compressed).decode("ascii")
            filename = f"chunk-{chunk_index:03d}.js"
            (chunks_dir / filename).write_text(js_registration(case_id, chunk_index, encoded), encoding="utf-8")
            count = index - chunk_first + 1
            chunk_specs.append(
                {
                    "index": chunk_index,
                    "firstSlice": chunk_first,
                    "sliceCount": count,
                    "script": f"chunks/{filename}",
                    "compressedBytes": len(compressed),
                    "uncompressedBytes": len(chunk_buffer),
                }
            )
            chunk_index += 1
            chunk_first = index + 1
            chunk_buffer = bytearray()

    default_window, presets = presets_for_series(first, global_min, global_max)
    if is_rgb:
        default_window = {"center": 127.5, "width": 255.0}
        presets = {}

    manifest = {
        "format": "dicom-slide-volume/1",
        "caseId": case_id,
        "title": safe_text(first, "seriesDescription") or "Anonymized DICOM series",
        "modality": safe_text(first, "modality"),
        "dimensions": {"columns": columns, "rows": rows, "slices": len(records)},
        "spacing": {
            "column": spacing[1] if len(spacing) > 1 else 1.0,
            "row": spacing[0] if spacing else 1.0,
            "slice": abs(slice_spacing) if slice_spacing else 1.0,
        },
        "orientationLPS": orientation[:6] if len(orientation) >= 6 else [1, 0, 0, 0, 1, 0],
        "sliceCoordinates": [round(value, 6) for value in positions] if sort_mode == "spatial" else None,
        "sortMode": sort_mode,
        "pixelType": "rgb8" if is_rgb else "int16-le",
        "samplesPerPixel": samples_per_pixel,
        "units": "RGB" if is_rgb else ("HU" if safe_text(first, "modality").upper() == "CT" else "stored units"),
        "invert": invert,
        "valueRange": {"minimum": global_min, "maximum": global_max},
        "initialSlice": len(records) // 2,
        "defaultWindow": default_window,
        "presets": presets,
        "chunks": chunk_specs,
        "source": {
            "studyDescription": safe_text(first, "studyDescription"),
            "seriesDescription": safe_text(first, "seriesDescription"),
            "seriesNumber": safe_text(first, "seriesNumber"),
            "transferSyntaxUID": original_transfer_syntax or safe_text(first, "transferSyntaxUID"),
        },
    }
    (output_dir / "manifest.js").write_text(manifest_registration(case_id, manifest), encoding="utf-8")
    (output_dir / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")

    total_compressed = sum(item["compressedBytes"] for item in chunk_specs)
    print(f"Converted {len(records)} slices: {columns}x{rows}, {len(chunk_specs)} chunks")
    print(f"Value range: {global_min}..{global_max}; compressed pixel payload: {total_compressed / 1024 / 1024:.1f} MiB")
    print(f"Output: {output_dir}")
    return manifest


def convert(input_dir: Path, output_dir: Path, case_id: str, chunk_size: int) -> None:
    files = sorted(path for path in input_dir.rglob("*") if path.is_file() and not path.name.startswith("._"))
    records = []
    errors = []
    for path in files:
        try:
            meta = parse_dicom(path)
            records.append(meta)
        except Exception as exc:
            errors.append(f"{path.name}: {exc}")
    if not records:
        raise SystemExit("No supported DICOM images found.\n" + "\n".join(errors[:10]))

    series_counts: dict[str, int] = {}
    for record in records:
        uid = safe_text(record, "seriesInstanceUID") or "unknown"
        series_counts[uid] = series_counts.get(uid, 0) + 1
    selected_uid = max(series_counts, key=series_counts.get)
    records = [record for record in records if (safe_text(record, "seriesInstanceUID") or "unknown") == selected_uid]
    convert_records(records, output_dir, case_id, chunk_size)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input_dir", type=Path)
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("--case-id", default="head-ct")
    parser.add_argument("--chunk-size", type=int, default=12)
    args = parser.parse_args()
    convert(args.input_dir, args.output_dir, args.case_id, max(1, args.chunk_size))


if __name__ == "__main__":
    main()
