#!/usr/bin/env python3
"""Validate the static PowerPoint content add-in package."""

from __future__ import annotations

import hashlib
import stat
import sys
import uuid
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

POWERPOINT = ROOT / "powerpoint"
MANIFEST = POWERPOINT / "manifest.xml"
NAMESPACE = "http://schemas.microsoft.com/office/appforoffice/1.1"
XSI = "http://www.w3.org/2001/XMLSchema-instance"
NS = {"o": NAMESPACE}
PRODUCTION_SOURCE_URL = "https://thalesmms.github.io/dicom-slides/powerpoint/content.html"
APPROVED_SOURCE_URLS = frozenset({PRODUCTION_SOURCE_URL})


class AddinHtmlParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.ids: set[str] = set()
        self.script_sources: list[str] = []
        self.attributes_by_id: dict[str, dict[str, str | None]] = {}

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = dict(attrs)
        element_id = attributes.get("id")
        if element_id:
            self.ids.add(element_id)
            self.attributes_by_id[element_id] = attributes
        if tag == "script" and attributes.get("src"):
            self.script_sources.append(attributes["src"] or "")


def javascript_tokens(source: str) -> list[tuple[str, str]]:
    """Return code tokens while excluding comments from integration checks."""
    tokens: list[tuple[str, str]] = []
    index = 0
    while index < len(source):
        character = source[index]
        if character.isspace():
            index += 1
            continue
        if source.startswith("//", index):
            newline = source.find("\n", index + 2)
            index = len(source) if newline < 0 else newline + 1
            continue
        if source.startswith("/*", index):
            end = source.find("*/", index + 2)
            index = len(source) if end < 0 else end + 2
            continue
        if character in {'"', "'", "`"}:
            quote = character
            index += 1
            value: list[str] = []
            while index < len(source):
                character = source[index]
                if character == "\\" and index + 1 < len(source):
                    value.append(source[index + 1])
                    index += 2
                    continue
                if character == quote:
                    index += 1
                    break
                value.append(character)
                index += 1
            tokens.append(("string", "".join(value)))
            continue
        if character.isalpha() or character in "_$":
            end = index + 1
            while end < len(source) and (source[end].isalnum() or source[end] in "_$"):
                end += 1
            tokens.append(("identifier", source[index:end]))
            index = end
            continue
        tokens.append(("punctuation", character))
        index += 1
    return tokens


def contains_token_sequence(tokens: list[tuple[str, str]], values: tuple[str, ...]) -> bool:
    token_values = [value for _, value in tokens]
    return any(token_values[index:index + len(values)] == list(values)
               for index in range(len(token_values) - len(values) + 1))


def has_string_call(tokens: list[tuple[str, str]], owner: str, method: str, argument: str) -> bool:
    for index in range(len(tokens) - 4):
        if ([value for _, value in tokens[index:index + 4]] == [owner, ".", method, "("]
                and tokens[index + 4] == ("string", argument)):
            return True
    return False


def has_string_comparison(tokens: list[tuple[str, str]], owner: str, member: str, argument: str) -> bool:
    for index in range(len(tokens) - 6):
        if ([value for _, value in tokens[index:index + 6]] == [owner, ".", member, "=", "=", "="]
                and tokens[index + 6] == ("string", argument)):
            return True
    return False


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
    version_parts = element_text(root, "Version").split(".")
    require(
        len(version_parts) == 4 and all(part and part.isdigit() for part in version_parts),
        "Version must have four numeric parts",
    )

    host = root.find("o:Hosts/o:Host", NS)
    require(host is not None and host.attrib.get("Name") == "Presentation", "PowerPoint Presentation host is required")

    requirement = root.find("o:Requirements/o:Sets/o:Set", NS)
    require(
        requirement is not None
        and requirement.attrib.get("Name") == "PowerPointApi"
        and requirement.attrib.get("MinVersion") == "1.7",
        "PowerPointApi 1.7 is required for embedded presentation storage",
    )

    settings = root.find("o:DefaultSettings", NS)
    require(settings is not None, "manifest is missing DefaultSettings")
    source = settings.find("o:SourceLocation", NS)
    require(source is not None, "manifest is missing SourceLocation")
    source_url = source.attrib.get("DefaultValue", "")
    require(source_url.startswith("https://"), "SourceLocation must use HTTPS")
    require(source_url.endswith("/powerpoint/content.html"), "SourceLocation must target powerpoint/content.html")
    require(source_url in APPROVED_SOURCE_URLS, "SourceLocation must use an approved production URL")

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
    parser = AddinHtmlParser()
    parser.feed(html)
    required_scripts = (
        "https://appsforoffice.microsoft.com/lib/1/hosted/office.js",
        "../runtime/dicom-slide.js",
        "studies.js",
        "vendor/openjpeg/openjpegwasm_decode.js",
        "dicom-importer.js",
        "presentation-storage.js",
        "powerpoint-host.js",
        "content.js",
    )
    for script_source in required_scripts:
        require(script_source in parser.script_sources, f"content.html is missing script src {script_source!r}")
    for element_id in (
        "viewerMount", "settingsForm", "importFilesInput", "importFolderInput", "importZipInput", "importDropZone",
    ):
        require(element_id in parser.ids, f"content.html is missing id {element_id!r}")
    require(
        "webkitdirectory" in parser.attributes_by_id.get("importFolderInput", {}),
        "content.html importFolderInput is missing webkitdirectory",
    )

    for relative in (
        "content.css",
        "content.js",
        "studies.js",
        "dicom-importer.js",
        "presentation-storage.js",
        "powerpoint-host.js",
        "vendor/openjpeg/openjpegwasm_decode.js",
        "vendor/openjpeg/openjpegwasm_decode.wasm",
        "vendor/openjpeg/LICENSE",
        "vendor/openjpeg/LICENSE-OPENJPEG",
        "vendor/openjpeg/README.md",
    ):
        require((POWERPOINT / relative).is_file(), f"missing powerpoint/{relative}")
    require((ROOT / "runtime" / "dicom-slide.js").is_file(), "missing runtime/dicom-slide.js")

    javascript = (POWERPOINT / "content.js").read_text(encoding="utf-8")
    tokens = javascript_tokens(javascript)
    contracts = (
        ("Office.onReady", contains_token_sequence(tokens, ("Office", ".", "onReady", "("))),
        ("getActiveViewAsync call", contains_token_sequence(tokens, ("getActiveViewAsync", "("))),
        ("ActiveViewChanged event", contains_token_sequence(tokens, ("EventType", ".", "ActiveViewChanged"))),
        ("document.settings", contains_token_sequence(tokens, ("document", ".", "settings"))),
        ("dicom-study-viewer creation", has_string_call(tokens, "document", "createElement", "dicom-study-viewer")),
        ("importLocalFiles function", contains_token_sequence(tokens, ("function", "importLocalFiles", "("))),
        ("ensureRegistered call", contains_token_sequence(tokens, ("DicomSlidesImporter", ".", "ensureRegistered", "("))),
        ("PowerPoint add-in export", contains_token_sequence(tokens, ("global", ".", "DicomSlidesPowerPointAddin", "="))),
        ("local protocol handling", has_string_comparison(tokens, "resolved", "protocol", "dicom-slides-local:")),
        ("embedded storage marker", "PRESENTATION_STORAGE_MODE" in javascript),
        ("persistent cleanup journal", "PACKAGE_CLEANUP_KEY" in javascript),
    )
    for label, present in contracts:
        require(present, f"content.js is missing required integration {label!r}")
    require(not contains_token_sequence(tokens, ("eval", "(")), "content.js must not use eval")

    storage = (POWERPOINT / "presentation-storage.js").read_text(encoding="utf-8")
    for token in (
        "PowerPointApi",
        "1.7",
        "customXmlParts",
        "getByNamespace",
        "SHA-256",
        "writePackage",
        "readPackage",
        "deletePackage",
    ):
        require(token in storage, f"presentation-storage.js is missing {token!r}")
    require("eval(" not in storage, "presentation-storage.js must not use eval")
    require("Function(" not in storage, "presentation-storage.js must not construct dynamic functions")


def validate_importer() -> None:
    path = POWERPOINT / "dicom-importer.js"
    require(path.is_file(), "missing powerpoint/dicom-importer.js")
    javascript = path.read_text(encoding="utf-8")
    required_tokens = (
        "parseDicomBuffer",
        "CompressionStream",
        "DecompressionStream",
        "indexedDB",
        "registerManifest",
        "registerChunk",
        "dicom-slide-study/1",
        "dicom-slide-volume/1",
        "dicom-slides-local:",
        "rescaleSlope",
        "rescaleIntercept",
        "patientName",
        "patientID",
        "JPEG2000_TRANSFER_SYNTAXES",
        "OpenJPEGWASM",
    )
    for token in required_tokens:
        require(token in javascript, f"dicom-importer.js is missing {token!r}")
    require("eval(" not in javascript, "dicom-importer.js must not use eval")
    require("Function(" not in javascript, "dicom-importer.js must not construct dynamic functions")


def validate_documentation() -> None:
    readme = (POWERPOINT / "README.md").read_text(encoding="utf-8")
    for token in (
        "manifest.xml",
        "GitHub Pages",
        "Office.context.document.settings",
        "PowerPoint.presentation.customXmlParts",
        "embedded in the `.pptx`",
        "PowerPointApi 1.7",
        "IndexedDB",
        "cache only",
        "Implicit VR Little Endian",
        "CompressionStream",
        "JPEG 2000",
        "OpenJPEG",
        PRODUCTION_SOURCE_URL,
    ):
        require(token in readme, f"powerpoint/README.md is missing {token!r}")


def validate_installers() -> None:
    scripts = ROOT / "scripts"
    macos = scripts / "install-powerpoint-macos.sh"
    windows = scripts / "install-powerpoint-windows.ps1"
    require(macos.is_file(), "missing scripts/install-powerpoint-macos.sh")
    require(windows.is_file(), "missing scripts/install-powerpoint-windows.ps1")
    require(bool(macos.stat().st_mode & stat.S_IXUSR), "scripts/install-powerpoint-macos.sh is not executable")
    require(macos.stat().st_size > 0, "scripts/install-powerpoint-macos.sh is empty")
    require(windows.stat().st_size > 0, "scripts/install-powerpoint-windows.ps1 is empty")

    attributes_path = ROOT / ".gitattributes"
    require(attributes_path.is_file(), "missing .gitattributes")
    attributes = {
        line.strip()
        for line in attributes_path.read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    }
    for rule in (
        "powerpoint/manifest.xml text eol=lf",
        "scripts/*.sh text eol=lf",
        "scripts/*.ps1 text eol=lf",
    ):
        require(rule in attributes, f".gitattributes must enforce LF line endings with: {rule}")

    checksums = {
        macos.name: hashlib.sha256(macos.read_bytes()).hexdigest(),
        windows.name: hashlib.sha256(windows.read_bytes()).hexdigest(),
    }
    for readme in (ROOT / "README.md", ROOT / "powerpoint" / "README.md"):
        require(readme.is_file(), f"missing {readme.relative_to(ROOT)}")
        documentation = readme.read_text(encoding="utf-8")
        for script_name, checksum in checksums.items():
            require(
                checksum in documentation,
                f"{readme.relative_to(ROOT)} is missing the current installer SHA-256 for {script_name}",
            )


def main() -> int:
    try:
        validate_manifest()
        validate_html_and_scripts()
        validate_importer()
        validate_documentation()
        validate_installers()
    except (ET.ParseError, OSError, ValueError) as error:
        print(f"PowerPoint add-in validation failed: {error}", file=sys.stderr)
        return 1
    print("PowerPoint add-in validation passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
