#!/usr/bin/env python3
"""Package every single-frame monochrome series in one DICOM study.

The input can be a directory or a ZIP archive. Compressed transfer syntaxes are
decoded in a temporary working directory through ``gdcmconv --raw`` when it is
available. Single-frame JPEG 2000 can also use Pillow as an offline fallback;
the source archive or directory is never modified.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import zipfile

try:
    from .convert_dicom import (
        JPEG2000_TRANSFER_SYNTAXES,
        UNCOMPRESSED_TRANSFER_SYNTAXES,
        convert_records,
        first_number,
        parse_dicom,
        safe_text,
    )
except ImportError:
    from convert_dicom import (
        JPEG2000_TRANSFER_SYNTAXES,
        UNCOMPRESSED_TRANSFER_SYNTAXES,
        convert_records,
        first_number,
        parse_dicom,
        safe_text,
    )


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while block := handle.read(1024 * 1024):
            digest.update(block)
    return digest.hexdigest()


def slugify(value: str, fallback: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "-", value.casefold()).strip("-")
    return normalized[:48] or fallback


def extract_zip_safely(archive: Path, destination: Path) -> None:
    root = destination.resolve()
    with zipfile.ZipFile(archive) as bundle:
        for item in bundle.infolist():
            path = Path(item.filename)
            if item.is_dir() or path.name.startswith("._") or path.name == ".DS_Store":
                continue
            target = (destination / path).resolve()
            if root not in target.parents:
                raise ValueError(f"Unsafe ZIP member: {item.filename}")
            target.parent.mkdir(parents=True, exist_ok=True)
            with bundle.open(item) as source, target.open("wb") as output:
                shutil.copyfileobj(source, output)


def discover_headers(root: Path) -> tuple[list[dict], list[str]]:
    records: list[dict] = []
    errors: list[str] = []
    for path in sorted(candidate for candidate in root.rglob("*") if candidate.is_file()):
        if path.name.startswith("._") or path.name == ".DS_Store":
            continue
        try:
            records.append(parse_dicom(path, require_pixels=False))
        except Exception as exc:
            errors.append(f"{path.name}: {exc}")
    return records, errors


def series_sort_key(item: tuple[str, list[dict]]) -> tuple[float, str, str]:
    _, records = item
    first = records[0]
    return (
        first_number(first.get("seriesNumber"), 1e12),
        safe_text(first, "seriesDescription").casefold(),
        safe_text(first, "seriesInstanceUID"),
    )


def prepare_pixels(records: list[dict], destination: Path, gdcmconv: str | None) -> list[dict]:
    prepared: list[dict] = []
    for index, header in enumerate(records):
        source = Path(header["path"])
        transfer_syntax = safe_text(header, "transferSyntaxUID") or "1.2.840.10008.1.2.1"
        if transfer_syntax in UNCOMPRESSED_TRANSFER_SYNTAXES:
            prepared.append(parse_dicom(source))
            continue
        if transfer_syntax in JPEG2000_TRANSFER_SYNTAXES and not gdcmconv:
            prepared.append(parse_dicom(source))
            continue
        if not gdcmconv:
            raise RuntimeError(
                f"Series uses compressed transfer syntax {transfer_syntax}, but gdcmconv was not found on PATH"
            )
        target = destination / f"{index:06d}.dcm"
        completed = subprocess.run(
            [gdcmconv, "--quiet", "--raw", str(source), str(target)],
            text=True,
            capture_output=True,
        )
        if completed.returncode != 0 or not target.is_file():
            detail = completed.stderr.strip() or completed.stdout.strip() or "unknown gdcmconv failure"
            raise RuntimeError(f"Could not decompress {source.name}: {detail}")
        prepared.append(parse_dicom(target))
    return prepared


def study_registration(study_id: str, manifest: dict) -> str:
    payload = json.dumps(manifest, ensure_ascii=False, separators=(",", ":"))
    return f"""(function(g){{
var base=new URL('.',document.currentScript.src).href;
var s={payload};s.baseUrl=base;
(g.__DICOM_SLIDE_STUDIES__||(g.__DICOM_SLIDE_STUDIES__={{}}))[{json.dumps(study_id)}]=s;
}})(window);\n"""


def package_study(input_path: Path, output_dir: Path, study_id: str, title: str | None, chunk_size: int) -> dict:
    input_path = input_path.resolve()
    if not input_path.exists():
        raise FileNotFoundError(input_path)
    if output_dir.exists():
        raise FileExistsError(f"Output already exists: {output_dir}")

    source_hash = sha256_file(input_path) if input_path.is_file() else None
    source_name = input_path.name
    output_parent = output_dir.resolve().parent
    output_parent.mkdir(parents=True, exist_ok=True)
    gdcmconv = shutil.which("gdcmconv")

    with tempfile.TemporaryDirectory(prefix="dicom-study-input-") as input_temp_name:
        input_temp = Path(input_temp_name)
        if input_path.is_file():
            if not zipfile.is_zipfile(input_path):
                raise ValueError("A file input must be a ZIP archive")
            extract_zip_safely(input_path, input_temp)
            scan_root = input_temp
        else:
            scan_root = input_path

        headers, errors = discover_headers(scan_root)
        if not headers:
            raise RuntimeError("No supported DICOM files found.\n" + "\n".join(errors[:10]))

        study_uids = {safe_text(item, "studyInstanceUID") or "unknown" for item in headers}
        if len(study_uids) != 1:
            counts = {uid: sum(1 for item in headers if (safe_text(item, "studyInstanceUID") or "unknown") == uid) for uid in study_uids}
            raise ValueError(f"Input contains multiple Study Instance UIDs: {counts}")

        grouped: dict[str, list[dict]] = {}
        for header in headers:
            uid = safe_text(header, "seriesInstanceUID") or "unknown"
            grouped.setdefault(uid, []).append(header)

        with tempfile.TemporaryDirectory(prefix=f".{output_dir.name}-", dir=output_parent) as package_temp_name:
            package_root = Path(package_temp_name)
            series_root = package_root / "series"
            series_root.mkdir()
            series_entries = []

            for position, (series_uid, series_headers) in enumerate(sorted(grouped.items(), key=series_sort_key), start=1):
                first_header = series_headers[0]
                number_text = safe_text(first_header, "seriesNumber") or str(position)
                description = safe_text(first_header, "seriesDescription") or f"Series {number_text}"
                uid_suffix = hashlib.sha1(series_uid.encode("utf-8")).hexdigest()[:7]
                series_id = f"series-{slugify(number_text, str(position))}-{slugify(description, 'no-description')}-{uid_suffix}"
                case_id = f"{study_id}--{series_id}"
                series_output = series_root / series_id

                print(f"[{position}/{len(grouped)}] Series {number_text}: {description} ({len(series_headers)} images)")
                with tempfile.TemporaryDirectory(prefix="dicom-series-pixels-") as pixel_temp_name:
                    prepared = prepare_pixels(series_headers, Path(pixel_temp_name), gdcmconv)
                    syntaxes = sorted({safe_text(item, "transferSyntaxUID") for item in series_headers})
                    manifest = convert_records(
                        prepared,
                        series_output,
                        case_id,
                        chunk_size,
                        original_transfer_syntax=", ".join(filter(None, syntaxes)),
                    )

                series_entries.append(
                    {
                        "id": series_id,
                        "caseId": case_id,
                        "number": number_text,
                        "title": description,
                        "modality": manifest["modality"],
                        "slices": manifest["dimensions"]["slices"],
                        "rows": manifest["dimensions"]["rows"],
                        "columns": manifest["dimensions"]["columns"],
                        "sortMode": manifest["sortMode"],
                        "manifest": f"series/{series_id}/manifest.js",
                    }
                )

            first = headers[0]
            study_manifest = {
                "format": "dicom-slide-study/1",
                "studyId": study_id,
                "title": title or safe_text(first, "studyDescription") or source_name,
                "studyInstanceUID": next(iter(study_uids)),
                "seriesCount": len(series_entries),
                "series": series_entries,
                "source": {
                    "fileName": source_name,
                    "sha256": source_hash,
                    "dicomFileCount": len(headers),
                },
            }
            (package_root / "study.json").write_text(
                json.dumps(study_manifest, indent=2, ensure_ascii=False), encoding="utf-8"
            )
            (package_root / "study.js").write_text(
                study_registration(study_id, study_manifest), encoding="utf-8"
            )
            package_root.replace(output_dir)

    return study_manifest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="DICOM directory or ZIP archive")
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("--study-id", required=True)
    parser.add_argument("--title")
    parser.add_argument("--chunk-size", type=int, default=12)
    args = parser.parse_args()
    manifest = package_study(
        args.input,
        args.output_dir,
        args.study_id,
        args.title,
        max(1, args.chunk_size),
    )
    print(f"Study {manifest['studyId']}: {manifest['seriesCount']} series, {manifest['source']['dicomFileCount']} DICOM files")
    print(f"Output: {args.output_dir}")


if __name__ == "__main__":
    main()
