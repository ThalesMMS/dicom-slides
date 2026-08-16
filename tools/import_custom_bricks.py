#!/usr/bin/env python3
"""Import dicom-volume custom gzip bricks into dicom-slide native JS chunks.

The target directory must already contain a dicom-slide ``manifest.json`` so
that DICOM geometry, orientation, slice coordinates, title, and identifiers are
preserved. Only the pixel payload/chunk table and value/window metadata are
updated.

Uses only Python's standard library.
"""
from __future__ import annotations

import argparse
from array import array
import base64
import gzip
import hashlib
import json
from pathlib import Path
import shutil
import sys


def js_registration(case_id: str, chunk_index: int, encoded: str) -> str:
    payload = json.dumps([case_id, chunk_index, encoded], separators=(",", ":"))
    return (
        "(function(g){var p=" + payload
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


def read_int16_le(raw: bytes) -> array:
    if len(raw) % 2:
        raise ValueError("Int16 payload has an odd byte count")
    values = array("h")
    values.frombytes(raw)
    if sys.byteorder != "little":
        values.byteswap()
    return values


def int16_le_bytes(values: array) -> bytes:
    if sys.byteorder == "little":
        return values.tobytes()
    copy = array("h", values)
    copy.byteswap()
    return copy.tobytes()


def assemble_bricks(root: Path, source: dict) -> array:
    if source.get("format") != "format-lab-bricks/1":
        raise ValueError("Unsupported custom manifest format")
    if source.get("datatype") != "int16-le" or source.get("order") != "x-fastest":
        raise ValueError("Importer requires int16-le in x-fastest order")
    dimensions = [int(value) for value in source["dimensions"]]
    if len(dimensions) != 3 or any(value <= 0 for value in dimensions):
        raise ValueError("Invalid source dimensions")
    size_x, size_y, size_z = dimensions
    voxels = array("h", [0]) * (size_x * size_y * size_z)

    for brick in source["bricks"]:
        path = root / brick["path"]
        compressed = path.read_bytes()
        if len(compressed) != int(brick["compressedBytes"]):
            raise ValueError(f"{path.name}: compressed length mismatch")
        raw = gzip.decompress(compressed)
        if len(raw) != int(brick["uncompressedBytes"]):
            raise ValueError(f"{path.name}: uncompressed length mismatch")
        digest = hashlib.sha256(raw).hexdigest()
        if brick.get("sha256") and digest != brick["sha256"]:
            raise ValueError(f"{path.name}: uncompressed SHA-256 mismatch")
        values = read_int16_le(raw)
        origin_x, origin_y, origin_z = map(int, brick["originXYZ"])
        brick_x, brick_y, brick_z = map(int, brick["shapeXYZ"])
        if len(values) != brick_x * brick_y * brick_z:
            raise ValueError(f"{path.name}: voxel count mismatch")
        copy_x = min(brick_x, size_x - origin_x)
        copy_y = min(brick_y, size_y - origin_y)
        copy_z = min(brick_z, size_z - origin_z)
        if min(copy_x, copy_y, copy_z) <= 0:
            raise ValueError(f"{path.name}: brick origin is outside the volume")
        for local_z in range(copy_z):
            for local_y in range(copy_y):
                source_offset = (local_z * brick_y + local_y) * brick_x
                target_offset = ((origin_z + local_z) * size_y + origin_y + local_y) * size_x + origin_x
                voxels[target_offset : target_offset + copy_x] = values[source_offset : source_offset + copy_x]
    return voxels


def reorient(voxels: array, dimensions: list[int], flips: set[str]) -> array:
    if not flips:
        return voxels
    size_x, size_y, size_z = dimensions
    output = array("h", [0]) * len(voxels)
    for z in range(size_z):
        source_z = size_z - 1 - z if "z" in flips else z
        for y in range(size_y):
            source_y = size_y - 1 - y if "y" in flips else y
            source_offset = (source_z * size_y + source_y) * size_x
            target_offset = (z * size_y + y) * size_x
            row = voxels[source_offset : source_offset + size_x]
            if "x" in flips:
                row = row[::-1]
            output[target_offset : target_offset + size_x] = row
    return output


def write_chunks(target: Path, manifest: dict, voxels: array, chunk_size: int) -> list[dict]:
    dimensions = manifest["dimensions"]
    columns = int(dimensions["columns"])
    rows = int(dimensions["rows"])
    slices = int(dimensions["slices"])
    plane_values = columns * rows
    chunks_dir = target / "chunks"
    if chunks_dir.exists():
        shutil.rmtree(chunks_dir)
    chunks_dir.mkdir(parents=True)
    specs: list[dict] = []
    case_id = manifest["caseId"]
    for chunk_index, first_slice in enumerate(range(0, slices, chunk_size)):
        slice_count = min(chunk_size, slices - first_slice)
        start = first_slice * plane_values
        end = (first_slice + slice_count) * plane_values
        raw = int16_le_bytes(voxels[start:end])
        compressed = gzip.compress(raw, compresslevel=9, mtime=0)
        encoded = base64.b64encode(compressed).decode("ascii")
        filename = f"chunk-{chunk_index:03d}.js"
        (chunks_dir / filename).write_text(js_registration(case_id, chunk_index, encoded), encoding="utf-8")
        specs.append({
            "index": chunk_index,
            "firstSlice": first_slice,
            "sliceCount": slice_count,
            "script": f"chunks/{filename}",
            "compressedBytes": len(compressed),
            "uncompressedBytes": len(raw),
        })
    return specs


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("custom_manifest", type=Path)
    parser.add_argument("target_series_dir", type=Path)
    parser.add_argument("--chunk-size", type=int, default=12)
    parser.add_argument("--flip", action="append", choices=("x", "y", "z"), default=[])
    parser.add_argument("--source-label", default="dicom-volume custom bricks")
    args = parser.parse_args()
    if args.chunk_size <= 0:
        parser.error("--chunk-size must be positive")

    source_path = args.custom_manifest.resolve()
    target = args.target_series_dir.resolve()
    source = json.loads(source_path.read_text(encoding="utf-8"))
    manifest_path = target / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    source_dimensions = list(map(int, source["dimensions"]))
    target_dimensions = [
        int(manifest["dimensions"]["columns"]),
        int(manifest["dimensions"]["rows"]),
        int(manifest["dimensions"]["slices"]),
    ]
    if source_dimensions != target_dimensions:
        raise ValueError(f"Dimension mismatch: source {source_dimensions}, target {target_dimensions}")

    voxels = assemble_bricks(source_path.parent, source)
    source_sha = hashlib.sha256(int16_le_bytes(voxels)).hexdigest()
    voxels = reorient(voxels, target_dimensions, set(args.flip))
    output_bytes = int16_le_bytes(voxels)
    output_sha = hashlib.sha256(output_bytes).hexdigest()
    minimum = min(voxels)
    maximum = max(voxels)
    manifest["chunks"] = write_chunks(target, manifest, voxels, args.chunk_size)
    manifest["valueRange"] = {"minimum": minimum, "maximum": maximum}

    window = source.get("windowing") or {}
    center = window.get("center")
    width = window.get("width")
    if isinstance(center, (int, float)) and isinstance(width, (int, float)) and width > 0:
        manifest["defaultWindow"] = {"center": float(center), "width": float(width)}
        presets = manifest.setdefault("presets", {})
        presets["dicom"] = {
            "label": presets.get("dicom", {}).get("label", "DICOM"),
            "center": float(center),
            "width": float(width),
        }
    full_width = max(1.0, float(maximum - minimum))
    manifest.setdefault("presets", {})["full"] = {
        "label": "Full range",
        "center": float(minimum) + full_width / 2.0,
        "width": full_width,
    }
    provenance = manifest.setdefault("source", {})
    provenance.update({
        "webPayload": args.source_label,
        "customManifest": source_path.name,
        "sourceVoxelSha256": source_sha,
        "dicomSlideVoxelSha256": output_sha,
        "voxelTransform": {"flips": sorted(set(args.flip))},
        "sourceAffine": source.get("affine"),
        "sourceCoordinateSystem": source.get("coordinateSystem"),
    })

    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (target / "manifest.js").write_text(manifest_registration(manifest["caseId"], manifest), encoding="utf-8")
    compressed = sum(spec["compressedBytes"] for spec in manifest["chunks"])
    print(
        f"Imported {target_dimensions[2]} slices into {len(manifest['chunks'])} chunks; "
        f"range {minimum}..{maximum}; {compressed / 1048576:.1f} MiB compressed"
    )
    print(f"Source voxel SHA-256: {source_sha}")
    print(f"Output voxel SHA-256: {output_sha}")


if __name__ == "__main__":
    main()
