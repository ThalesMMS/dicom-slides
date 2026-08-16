#!/usr/bin/env python3
"""Validate the generated static case using only Python's standard library."""
from __future__ import annotations

import argparse
import base64
import gzip
import json
from pathlib import Path
import re
import sys

PAYLOAD_RE = re.compile(r"var p=(\[.*?\]);if\(")


def validate_case(case_dir: Path, *, print_result: bool = True) -> dict:
    manifest = json.loads((case_dir / "manifest.json").read_text(encoding="utf-8"))
    dimensions = manifest["dimensions"]
    pixels_per_slice = dimensions["rows"] * dimensions["columns"]
    total_slices = 0
    compressed_bytes = 0
    uncompressed_bytes = 0

    for expected_index, spec in enumerate(manifest["chunks"]):
        assert spec["index"] == expected_index, f"Unexpected chunk index: {spec['index']}"
        script_path = case_dir / spec["script"]
        text = script_path.read_text(encoding="utf-8")
        match = PAYLOAD_RE.search(text)
        assert match, f"Payload not found in {script_path}"
        case_id, index, encoded = json.loads(match.group(1))
        assert case_id == manifest["caseId"]
        assert index == spec["index"]
        compressed = base64.b64decode(encoded)
        raw = gzip.decompress(compressed)
        bytes_per_pixel = 3 if manifest.get("pixelType") == "rgb8" else 2
        expected = spec["sliceCount"] * pixels_per_slice * bytes_per_pixel
        assert len(raw) == expected == spec["uncompressedBytes"]
        total_slices += spec["sliceCount"]
        compressed_bytes += len(compressed)
        uncompressed_bytes += len(raw)

    assert total_slices == dimensions["slices"]
    result = {
        "caseId": manifest["caseId"],
        "slices": dimensions["slices"],
        "chunks": len(manifest["chunks"]),
        "compressedBytes": compressed_bytes,
        "uncompressedBytes": uncompressed_bytes,
    }
    if print_result:
        print(
            f"OK: {result['caseId']} — {result['slices']} slices, "
            f"{result['chunks']} chunks, "
            f"{compressed_bytes / 1048576:.1f} MiB compressed / "
            f"{uncompressed_bytes / 1048576:.1f} MiB raw"
        )
    return result


def validate_study(study_dir: Path) -> None:
    study = json.loads((study_dir / "study.json").read_text(encoding="utf-8"))
    assert study["format"] == "dicom-slide-study/1"
    assert study["seriesCount"] == len(study["series"])
    assert len({item["id"] for item in study["series"]}) == study["seriesCount"]
    study_script = (study_dir / "study.js").read_text(encoding="utf-8")
    assert json.dumps(study["studyId"]) in study_script

    total_images = 0
    total_compressed = 0
    unavailable_series = 0
    for series in study["series"]:
        manifest_path = study_dir / series["manifest"]
        assert manifest_path.is_file(), f"Missing series manifest: {manifest_path}"
        if series.get("available") is False:
            assert series.get("unavailableReason"), f"Unavailable series needs a reason: {series['id']}"
            manifest = json.loads(manifest_path.with_suffix(".json").read_text(encoding="utf-8"))
            assert manifest["caseId"] == series["caseId"]
            assert manifest["dimensions"]["slices"] == series["slices"]
            total_images += series["slices"]
            unavailable_series += 1
            continue
        result = validate_case(manifest_path.parent, print_result=False)
        assert result["caseId"] == series["caseId"]
        assert result["slices"] == series["slices"]
        total_images += result["slices"]
        total_compressed += result["compressedBytes"]

    source_count = study["source"].get("dicomFileCount", study["source"].get("imageFileCount"))
    assert source_count is not None, "Study source must declare dicomFileCount or imageFileCount"
    assert total_images == source_count
    print(
        f"OK: study {study['studyId']} — {study['seriesCount']} series, "
        f"{total_images} images, {total_compressed / 1048576:.1f} MiB compressed, "
        f"{unavailable_series} metadata-only"
    )


def validate(path: Path) -> None:
    if (path / "study.json").is_file():
        validate_study(path)
    else:
        validate_case(path)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("case_dir", nargs="?", type=Path, default=Path("exams/library/visible-human-abdomen-ct"))
    args = parser.parse_args()
    validate(args.case_dir)


if __name__ == "__main__":
    main()
