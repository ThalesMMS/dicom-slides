#!/bin/bash

set -euo pipefail

readonly ADDIN_ID="3c8d5463-e606-4e35-86de-515114b31089"
readonly EXPECTED_SOURCE_URL="https://thalesmms.github.io/dicom-slides/powerpoint/content.html"
readonly EXPECTED_MANIFEST_SHA256="0ba89340b76f46a83edc3704ac1a389362a9b9cd9fab093d3678fba17657a280"
readonly DEFAULT_MANIFEST_SOURCE="https://raw.githubusercontent.com/ThalesMMS/dicom-slides/main/powerpoint/manifest.xml"

manifest_source="$DEFAULT_MANIFEST_SOURCE"
wef_dir="${HOME}/Library/Containers/com.microsoft.Powerpoint/Data/Documents/wef"
open_powerpoint=true
uninstall=false
staged_manifest=""
temporary_dir=""

usage() {
  cat <<'EOF'
Install, update, or remove the DICOM Slides PowerPoint add-in on macOS.

Usage:
  install-powerpoint-macos.sh [options]

Options:
  --manifest-source URL_OR_PATH  Manifest to install (HTTPS URL or local file).
  --wef-dir PATH                 Override the PowerPoint WEF directory.
  --no-open                      Do not open PowerPoint after installation.
  --uninstall                    Remove only the DICOM Slides manifest.
  --help                         Show this help.
EOF
}

fail() {
  printf 'DICOM Slides installer: %s\n' "$1" >&2
  exit 1
}

cleanup() {
  if [[ -n "$staged_manifest" && -f "$staged_manifest" && ! -L "$staged_manifest" ]]; then
    /bin/rm -f -- "$staged_manifest"
  fi
  if [[ -n "$temporary_dir" && -d "$temporary_dir" && ! -L "$temporary_dir" ]]; then
    local temporary_manifest="$temporary_dir/manifest.xml"
    if [[ -f "$temporary_manifest" && ! -L "$temporary_manifest" ]]; then
      /bin/rm -f -- "$temporary_manifest"
    fi
    /bin/rmdir -- "$temporary_dir" 2>/dev/null || true
  fi
}

trap cleanup EXIT HUP INT TERM

while [[ $# -gt 0 ]]; do
  case "$1" in
    --manifest-source)
      [[ $# -ge 2 && -n "$2" ]] || fail "--manifest-source requires a value."
      manifest_source="$2"
      shift 2
      ;;
    --wef-dir)
      [[ $# -ge 2 && -n "$2" ]] || fail "--wef-dir requires a value."
      wef_dir="$2"
      shift 2
      ;;
    --no-open)
      open_powerpoint=false
      shift
      ;;
    --uninstall)
      uninstall=true
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      fail "unknown option: $1"
      ;;
  esac
done

while [[ "$wef_dir" != "/" && "$wef_dir" == */ ]]; do
  wef_dir="${wef_dir%/}"
done
if [[ -z "$wef_dir" || "$wef_dir" == "/" || "${wef_dir##*/}" != "wef" || "$(/usr/bin/dirname -- "$wef_dir")" == "/" ]]; then
  fail "unsafe WEF directory: $wef_dir"
fi
if [[ -e "$wef_dir" && ! -d "$wef_dir" ]]; then
  fail "the WEF path exists but is not a directory: $wef_dir"
fi
if [[ -L "$wef_dir" ]]; then
  fail "refusing to use a symbolic-link WEF directory: $wef_dir"
fi

target_manifest="$wef_dir/dicom-slides.xml"
legacy_manifest="$wef_dir/manifest.xml"

manifest_id() {
  /usr/bin/xmllint --xpath \
    'string(/*[local-name()="OfficeApp"]/*[local-name()="Id"])' \
    "$1" 2>/dev/null
}

validate_manifest() {
  local candidate="$1"
  local candidate_hash candidate_id source_url host_name
  /usr/bin/xmllint --noout "$candidate" 2>/dev/null \
    || fail "the downloaded file is not a valid DICOM Slides manifest."
  candidate_hash="$(/usr/bin/shasum -a 256 "$candidate" | /usr/bin/awk '{print $1}')"
  [[ "$candidate_hash" == "$EXPECTED_MANIFEST_SHA256" ]] \
    || fail "the downloaded file is not a valid DICOM Slides manifest."
  candidate_id="$(manifest_id "$candidate")"
  source_url="$(/usr/bin/xmllint --xpath \
    'string(/*[local-name()="OfficeApp"]/*[local-name()="DefaultSettings"]/*[local-name()="SourceLocation"]/@DefaultValue)' \
    "$candidate" 2>/dev/null)"
  host_name="$(/usr/bin/xmllint --xpath \
    'string(/*[local-name()="OfficeApp"]/*[local-name()="Hosts"]/*[local-name()="Host"]/@Name)' \
    "$candidate" 2>/dev/null)"
  [[ "$candidate_id" == "$ADDIN_ID" \
      && "$source_url" == "$EXPECTED_SOURCE_URL" \
      && "$host_name" == "Presentation" ]] \
    || fail "the downloaded file is not a valid DICOM Slides manifest."
}

if $uninstall; then
  removed=false
  if [[ -e "$target_manifest" ]]; then
    [[ -f "$target_manifest" && ! -L "$target_manifest" ]] \
      || fail "refusing to remove an unexpected manifest path: $target_manifest"
    [[ "$(manifest_id "$target_manifest")" == "$ADDIN_ID" ]] \
      || fail "refusing to remove a manifest that does not belong to DICOM Slides."
    /bin/rm -f -- "$target_manifest"
    removed=true
  fi
  if [[ -f "$legacy_manifest" && ! -L "$legacy_manifest" \
      && "$(manifest_id "$legacy_manifest")" == "$ADDIN_ID" ]]; then
    /bin/rm -f -- "$legacy_manifest"
    removed=true
  fi
  if ! $removed; then
    printf 'DICOM Slides is not installed in %s.\n' "$wef_dir"
    exit 0
  fi
  printf 'Uninstalled DICOM Slides from PowerPoint. Other add-ins were preserved.\n'
  printf 'Close and reopen PowerPoint if it is currently running.\n'
  exit 0
fi

command -v /usr/bin/xmllint >/dev/null 2>&1 \
  || fail "xmllint is required but was not found."
temporary_dir="$(/usr/bin/mktemp -d "${TMPDIR:-/tmp}/dicom-slides-install.XXXXXX")" \
  || fail "could not create a temporary directory."
downloaded_manifest="$temporary_dir/manifest.xml"

if [[ "$manifest_source" == https://* ]]; then
  /usr/bin/curl --fail --location --silent --show-error \
    --proto '=https' --tlsv1.2 \
    "$manifest_source" -o "$downloaded_manifest" \
    || fail "could not download the manifest from $manifest_source"
elif [[ -f "$manifest_source" && ! -L "$manifest_source" ]]; then
  /bin/cp -- "$manifest_source" "$downloaded_manifest"
else
  fail "manifest source must be an HTTPS URL or a regular local file."
fi

validate_manifest "$downloaded_manifest"
/bin/mkdir -p -- "$wef_dir"
[[ -d "$wef_dir" && ! -L "$wef_dir" ]] \
  || fail "could not create a safe WEF directory: $wef_dir"

was_installed=false
if [[ -e "$target_manifest" ]]; then
  [[ -f "$target_manifest" && ! -L "$target_manifest" ]] \
    || fail "refusing to replace an unexpected manifest path: $target_manifest"
  was_installed=true
fi
legacy_installation=false
if [[ -f "$legacy_manifest" && ! -L "$legacy_manifest" \
    && "$(manifest_id "$legacy_manifest")" == "$ADDIN_ID" ]]; then
  was_installed=true
  legacy_installation=true
fi

staged_manifest="$wef_dir/.dicom-slides.xml.$$"
[[ ! -e "$staged_manifest" && ! -L "$staged_manifest" ]] \
  || fail "temporary destination already exists: $staged_manifest"
/usr/bin/install -m 0644 "$downloaded_manifest" "$staged_manifest"
/bin/mv -f -- "$staged_manifest" "$target_manifest"
staged_manifest=""

if $legacy_installation; then
  /bin/rm -f -- "$legacy_manifest"
  printf 'Migrated the previous manifest.xml installation to dicom-slides.xml.\n'
fi

if $was_installed; then
  printf 'Updated DICOM Slides in PowerPoint. Other add-ins were preserved.\n'
else
  printf 'Installed DICOM Slides in PowerPoint. Other add-ins were preserved.\n'
fi

if $open_powerpoint; then
  if /usr/bin/pgrep -x "Microsoft PowerPoint" >/dev/null 2>&1; then
    printf 'Close and reopen PowerPoint, then choose Home > Add-ins > DICOM Slides.\n'
  elif ! /usr/bin/open -a "Microsoft PowerPoint" >/dev/null 2>&1; then
    printf 'Open PowerPoint, then choose Home > Add-ins > DICOM Slides.\n'
  fi
else
  printf 'Open PowerPoint and choose Home > Add-ins > DICOM Slides.\n'
fi
