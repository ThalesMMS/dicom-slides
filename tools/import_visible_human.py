#!/usr/bin/env python3
"""Build a compact two-series abdominal CT study from NLM Visible Human PNGs.

The offline importer downloads the normal and frozen male CT PNG slices, samples
every second in-plane pixel, converts the stored 12-bit values to Hounsfield
units (value - 1024), and writes the dependency-free DICOM Slide package.
Pillow is required only while importing; the browser viewer has no dependency.
"""
from __future__ import annotations

import argparse
import array
import base64
from concurrent.futures import ThreadPoolExecutor
import gzip
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import time
from statistics import median_low
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from PIL import Image

try:
    from .convert_dicom import GENERIC_CT_PRESETS, js_registration, manifest_registration
    from .convert_study import study_registration
except ImportError:
    from convert_dicom import GENERIC_CT_PRESETS, js_registration, manifest_registration
    from convert_study import study_registration


STUDY_ID = "visible-human-abdomen-ct"
NATIVE_PIXEL_SPACING_MM = 0.8984375
RAW_TO_HU_OFFSET = -1024
DOWNLOAD_BASE = (
    "https://data.lhncbc.nlm.nih.gov/public/Visible-Human/"
    "Male-Images/PNG_format/radiological"
)
VHP_HOMEPAGE = "https://www.nlm.nih.gov/research/visible/visible_human.html"
NLM_TERMS = "https://www.nlm.nih.gov/databases/download/terms_and_conditions.html"
NLM_ATTRIBUTION = "Courtesy of the U.S. National Library of Medicine"
NORMAL_CT_ACQUISITION_GAPS = {1557}
# The NLM GE headers store Superior coordinates that decrease as the PNG index
# increases: S = 1392 - index for normal CT and S = 986 - index for frozen CT.
VHP_S_COORDINATE_OFFSETS_MM = {
    "normalCT": 1392.0,
    "frozenCT": 986.0,
}


def sha256_images(source_images: list[tuple[int, Path]]) -> str:
    digest = hashlib.sha256()
    for index, path in source_images:
        digest.update(f"{index}:{path.name}\n".encode("ascii"))
        with path.open("rb") as handle:
            while block := handle.read(1024 * 1024):
                digest.update(block)
    return digest.hexdigest()


def read_downsampled_hu(path: Path, downsample: int) -> tuple[int, int, array.array]:
    if downsample < 1:
        raise ValueError("Downsample factor must be at least one")
    with Image.open(path) as image:
        image.load()
        if len(image.getbands()) != 1:
            raise ValueError(f"{path.name}: expected a grayscale PNG")
        width, height = image.size
        if width % downsample or height % downsample:
            raise ValueError(f"{path.name}: dimensions must be divisible by {downsample}")
        pixels = image.load()
        values = array.array(
            "h",
            (
                max(-32768, min(32767, int(pixels[x, y]) + RAW_TO_HU_OFFSET))
                for y in range(0, height, downsample)
                for x in range(0, width, downsample)
            ),
        )
    return width // downsample, height // downsample, values


def nominal_slice_spacing(coordinates: list[float]) -> float:
    differences = [abs(right - left) for left, right in zip(coordinates, coordinates[1:])]
    return float(median_low(differences)) if differences else 1.0


def package_series(
    source_images: list[tuple[int, Path]],
    output_dir: Path,
    *,
    case_id: str,
    title: str,
    series_number: str,
    series_kind: str,
    downsample: int = 2,
    chunk_size: int = 12,
) -> dict:
    if not source_images:
        raise ValueError("Cannot package an empty Visible Human series")
    source_images_by_index = sorted(source_images)
    first_source_index = source_images_by_index[0][0]
    last_source_index = source_images_by_index[-1][0]
    source_images = list(reversed(source_images_by_index))
    output_dir.mkdir(parents=True, exist_ok=False)
    chunks_dir = output_dir / "chunks"
    chunks_dir.mkdir()

    coordinate_offset = VHP_S_COORDINATE_OFFSETS_MM[series_kind]
    coordinates = [coordinate_offset - float(index) for index, _ in source_images]
    slice_spacing = nominal_slice_spacing(coordinates)
    chunk_specs = []
    chunk_buffer = bytearray()
    chunk_first = 0
    chunk_index = 0
    columns = rows = None
    minimum = 32767
    maximum = -32768

    for position, (_, path) in enumerate(source_images):
        image_columns, image_rows, values = read_downsampled_hu(path, downsample)
        if columns is None:
            columns, rows = image_columns, image_rows
        elif (image_columns, image_rows) != (columns, rows):
            raise ValueError(f"{path.name}: inconsistent image dimensions")
        minimum = min(minimum, min(values))
        maximum = max(maximum, max(values))
        if sys.byteorder != "little":
            values.byteswap()
        chunk_buffer.extend(values.tobytes())

        is_last = position == len(source_images) - 1
        if position - chunk_first + 1 >= max(1, chunk_size) or is_last:
            compressed = gzip.compress(bytes(chunk_buffer), compresslevel=9, mtime=0)
            encoded = base64.b64encode(compressed).decode("ascii")
            filename = f"chunk-{chunk_index:03d}.js"
            (chunks_dir / filename).write_text(
                js_registration(case_id, chunk_index, encoded), encoding="utf-8"
            )
            slice_count = position - chunk_first + 1
            chunk_specs.append(
                {
                    "index": chunk_index,
                    "firstSlice": chunk_first,
                    "sliceCount": slice_count,
                    "script": f"chunks/{filename}",
                    "compressedBytes": len(compressed),
                    "uncompressedBytes": len(chunk_buffer),
                }
            )
            chunk_index += 1
            chunk_first = position + 1
            chunk_buffer = bytearray()

    manifest = {
        "format": "dicom-slide-volume/1",
        "caseId": case_id,
        "title": title,
        "modality": "CT",
        "dimensions": {"columns": columns, "rows": rows, "slices": len(source_images)},
        "spacing": {
            "column": NATIVE_PIXEL_SPACING_MM * downsample,
            "row": NATIVE_PIXEL_SPACING_MM * downsample,
            "slice": slice_spacing,
        },
        "orientationLPS": [1, 0, 0, 0, 1, 0],
        "sliceCoordinates": coordinates,
        "sortMode": "spatial",
        "pixelType": "int16-le",
        "samplesPerPixel": 1,
        "units": "HU",
        "invert": False,
        "valueRange": {"minimum": minimum, "maximum": maximum},
        "initialSlice": len(source_images) // 2,
        "defaultWindow": {"center": 40.0, "width": 400.0},
        "presets": GENERIC_CT_PRESETS,
        "chunks": chunk_specs,
        "source": {
            "dataset": "NLM Visible Human Project — Visible Male",
            "homepage": VHP_HOMEPAGE,
            "downloadBase": f"{DOWNLOAD_BASE}/{series_kind}/",
            "seriesKind": series_kind,
            "seriesNumber": series_number,
            "sourceImageCount": len(source_images),
            "firstSourceIndex": first_source_index,
            "lastSourceIndex": last_source_index,
            "omittedSourceIndices": sorted(
                index
                for index in NORMAL_CT_ACQUISITION_GAPS
                if series_kind == "normalCT" and first_source_index <= index <= last_source_index
            ),
            "sourceImagesSha256": sha256_images(source_images_by_index),
            "rawToHU": "stored value - 1024",
            "derivation": f"Nearest-neighbor {downsample}x in-plane downsampling; PNG values converted to Int16 HU.",
            "license": "Public domain; NLM download terms apply",
            "terms": NLM_TERMS,
            "attribution": NLM_ATTRIBUTION,
        },
    }
    (output_dir / "manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    (output_dir / "manifest.js").write_text(
        manifest_registration(case_id, manifest), encoding="utf-8"
    )
    return manifest


def write_poster(source: Path, destination: Path, downsample: int) -> None:
    columns, rows, values = read_downsampled_hu(source, downsample)
    lower, upper = -160.0, 240.0
    display = bytes(max(0, min(255, round((value - lower) * 255 / (upper - lower)))) for value in values)
    Image.frombytes("L", (columns, rows), display).save(destination, optimize=True)


def package_study(
    normal_images: list[tuple[int, Path]],
    frozen_images: list[tuple[int, Path]],
    output_dir: Path,
    *,
    downsample: int = 2,
    chunk_size: int = 12,
) -> dict:
    if output_dir.exists():
        raise FileExistsError(f"Output already exists: {output_dir}")
    output_dir.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=f".{output_dir.name}-", dir=output_dir.parent) as temporary:
        package_root = Path(temporary) / "package"
        series_root = package_root / "series"
        series_root.mkdir(parents=True)
        specifications = [
            ("normal-ct", "TC normal (pré-congelamento)", "1", "normalCT", normal_images),
            ("frozen-ct", "TC após congelamento", "2", "frozenCT", frozen_images),
        ]
        entries = []
        for series_id, title, number, kind, images in specifications:
            case_id = f"{STUDY_ID}--{series_id}"
            manifest = package_series(
                images,
                series_root / series_id,
                case_id=case_id,
                title=title,
                series_number=number,
                series_kind=kind,
                downsample=downsample,
                chunk_size=chunk_size,
            )
            entries.append(
                {
                    "id": series_id,
                    "caseId": case_id,
                    "number": number,
                    "title": title,
                    "modality": "CT",
                    "slices": manifest["dimensions"]["slices"],
                    "rows": manifest["dimensions"]["rows"],
                    "columns": manifest["dimensions"]["columns"],
                    "sortMode": "spatial",
                    "manifest": f"series/{series_id}/manifest.js",
                }
            )
        study = {
            "format": "dicom-slide-study/1",
            "studyId": STUDY_ID,
            "title": "Visible Human Male — TC abdominal",
            "seriesCount": len(entries),
            "series": entries,
            "source": {
                "dataset": "NLM Visible Human Project — Visible Male",
                "homepage": VHP_HOMEPAGE,
                "imageFileCount": len(normal_images) + len(frozen_images),
                "sourceIndexRange": [min(normal_images)[0], max(frozen_images)[0]],
                "license": "Public domain; NLM download terms apply",
                "terms": NLM_TERMS,
                "attribution": NLM_ATTRIBUTION,
                "nonEndorsement": "Attribution does not imply endorsement by NLM.",
            },
        }
        (package_root / "study.json").write_text(
            json.dumps(study, indent=2, ensure_ascii=False), encoding="utf-8"
        )
        (package_root / "study.js").write_text(
            study_registration(STUDY_ID, study), encoding="utf-8"
        )
        write_poster(frozen_images[len(frozen_images) // 2][1], package_root / "poster.png", downsample)
        package_root.replace(output_dir)
    return study


def source_indices(start: int, end: int) -> tuple[list[int], list[int]]:
    if start > end:
        raise ValueError("Start index must not be greater than end index")
    normal = [
        index
        for index in range(start, end + 1)
        if index % 3 == 0 and index not in NORMAL_CT_ACQUISITION_GAPS
    ]
    frozen = list(range(start, end + 1))
    return normal, frozen


def download_one(
    kind: str,
    index: int,
    destination: Path,
    *,
    retries: int = 3,
    retry_delay: float = 0.5,
) -> tuple[int, Path]:
    destination.mkdir(parents=True, exist_ok=True)
    target = destination / f"cvm{index:04d}f.png"
    if target.is_file():
        return index, target
    url = f"{DOWNLOAD_BASE}/{kind}/{target.name}"
    request = Request(url, headers={"User-Agent": "dicom-slide-importer/1.0"})
    attempts = max(1, retries)
    for attempt in range(attempts):
        try:
            with urlopen(request, timeout=60) as response:
                payload = response.read()
            break
        except HTTPError as error:
            if error.code not in {408, 429, 500, 502, 503, 504}:
                raise
            last_error = error
        except (TimeoutError, ConnectionError, URLError) as error:
            last_error = error
        if attempt + 1 == attempts:
            raise RuntimeError(f"Could not download {url} after {attempts} attempts") from last_error
        time.sleep(max(0.0, retry_delay) * (attempt + 1))
    if not payload.startswith(b"\x89PNG\r\n\x1a\n"):
        raise ValueError(f"Unexpected response for {url}")
    partial = target.with_suffix(".png.part")
    partial.write_bytes(payload)
    partial.replace(target)
    return index, target


def download_series(kind: str, indices: list[int], cache_root: Path, workers: int) -> list[tuple[int, Path]]:
    destination = cache_root / kind
    with ThreadPoolExecutor(max_workers=max(1, workers)) as executor:
        images = list(executor.map(lambda index: download_one(kind, index, destination), indices))
    return sorted(images)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("--start", type=int, default=1500)
    parser.add_argument("--end", type=int, default=1800)
    parser.add_argument("--downsample", type=int, default=2)
    parser.add_argument("--chunk-size", type=int, default=12)
    parser.add_argument("--workers", type=int, default=12)
    parser.add_argument("--cache-dir", type=Path)
    args = parser.parse_args()
    normal_indices, frozen_indices = source_indices(args.start, args.end)

    temporary = None
    if args.cache_dir:
        cache_root = args.cache_dir.resolve()
        cache_root.mkdir(parents=True, exist_ok=True)
    else:
        temporary = tempfile.TemporaryDirectory(prefix="visible-human-download-")
        cache_root = Path(temporary.name)
    try:
        normal = download_series("normalCT", normal_indices, cache_root, args.workers)
        frozen = download_series("frozenCT", frozen_indices, cache_root, args.workers)
        study = package_study(
            normal,
            frozen,
            args.output_dir,
            downsample=max(1, args.downsample),
            chunk_size=max(1, args.chunk_size),
        )
    finally:
        if temporary:
            temporary.cleanup()
    print(f"Study {study['studyId']}: {study['seriesCount']} series, {study['source']['imageFileCount']} PNG images")
    print(f"Output: {args.output_dir}")


if __name__ == "__main__":
    main()
