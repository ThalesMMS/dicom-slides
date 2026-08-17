#!/usr/bin/env python3
"""Validate the static PowerPoint content add-in package."""

from __future__ import annotations

import sys
import uuid
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

POWERPOINT = ROOT / "powerpoint"
MANIFEST = POWERPOINT / "manifest.xml"
NAMESPACE = "http://schemas.microsoft.com/office/appforoffice/1.1"
XSI = "http://www.w3.org/2001/XMLSchema-instance"
NS = {"o": NAMESPACE}


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def element_text(root: ET.Element, name: str) -> str:
    element = root.find(f"o:{name}", NS)
    require(element is not None, f"manifest is missing <{name}>")
    return (element.text or "").strip()


def default_value(root: ET.Element, name: str) -> str:
    element = root.find(f"o:{name}", NS)
    require(element is not None, f"manifest is missing <{name}>")
    value = element.attrib.get("DefaultValue", "").strip()
    require(value, f"manifest <{name}> has no DefaultValue")
    return value


def validate_manifest() -> None:
    require(MANIFEST.is_file(), "powerpoint/manifest.xml does not exist")
    root = ET.parse(MANIFEST).getroot()
    require(root.tag == f"{{{NAMESPACE}}}OfficeApp", "unexpected OfficeApp namespace")
    require(root.attrib.get(f"{{{XSI}}}type") == "ContentApp", "manifest must use ContentApp")

    uuid.UUID(element_text(root, "Id"))
    require(element_text(root, "Version").count(".") == 3, "Version must have four numeric parts")

    host = root.find("o:Hosts/o:Host", NS)
    require(host is not None and host.attrib.get("Name") == "Presentation", "PowerPoint Presentation host is required")

    settings = root.find("o:DefaultSettings", NS)
    require(settings is not None, "manifest is missing DefaultSettings")
    source = settings.find("o:SourceLocation", NS)
    require(source is not None, "manifest is missing SourceLocation")
    source_url = source.attrib.get("DefaultValue", "")
    require(source_url.startswith("https://"), "SourceLocation must use HTTPS")
    require(source_url.endswith("/powerpoint/content.html"), "SourceLocation must target powerpoint/content.html")

    width = int(element_text(settings, "RequestedWidth"))
    height = int(element_text(settings, "RequestedHeight"))
    require(32 <= width <= 1000 and 32 <= height <= 1000, "requested dimensions must be 32-1000 pixels")
    require(element_text(root, "Permissions") == "ReadWriteDocument", "ReadWriteDocument permission is required")
    require(element_text(root, "AllowSnapshot").lower() == "true", "AllowSnapshot must be true")

    for element_name, local_name in (("IconUrl", "icon-32.png"), ("HighResolutionIconUrl", "icon-80.png")):
        url = default_value(root, element_name)
        require(url.startswith("https://"), f"{element_name} must use HTTPS")
        require(url.endswith(local_name), f"{element_name} must reference {local_name}")
        require((POWERPOINT / "assets" / local_name).is_file(), f"missing powerpoint/assets/{local_name}")


def validate_html_and_scripts() -> None:
    html_path = POWERPOINT / "content.html"
    require(html_path.is_file(), "missing powerpoint/content.html")
    html = html_path.read_text(encoding="utf-8")
    required_fragments = (
        "https://appsforoffice.microsoft.com/lib/1/hosted/office.js",
        "../runtime/dicom-slide.js",
        "studies.js",
        "content.js",
        'id="viewerMount"',
        'id="settingsForm"',
    )
    for fragment in required_fragments:
        require(fragment in html, f"content.html is missing {fragment!r}")

    for relative in ("content.css", "content.js", "studies.js"):
        require((POWERPOINT / relative).is_file(), f"missing powerpoint/{relative}")

    javascript = (POWERPOINT / "content.js").read_text(encoding="utf-8")
    for token in ("Office.onReady", "getActiveViewAsync", "ActiveViewChanged", "document.settings", "dicom-study-viewer"):
        require(token in javascript, f"content.js is missing required integration token {token!r}")
    require("eval(" not in javascript, "content.js must not use eval")


def main() -> int:
    try:
        validate_manifest()
        validate_html_and_scripts()
    except (ET.ParseError, OSError, ValueError) as error:
        print(f"PowerPoint add-in validation failed: {error}", file=sys.stderr)
        return 1
    print("PowerPoint add-in validation passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
