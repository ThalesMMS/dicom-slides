#!/usr/bin/env bash
set -euo pipefail

version="${CHARLS_CODEC_VERSION:-1.2.5}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
destination="$root/powerpoint/vendor/charls"
temporary="$(mktemp -d)"
trap 'rm -rf "$temporary"' EXIT

npm pack "@cornerstonejs/codec-charls@$version" --pack-destination "$temporary" >/dev/null
tar -xzf "$temporary"/*.tgz -C "$temporary"
install -d "$destination"
install -m 0644 "$temporary/package/dist/charlswasm_decode.js" "$destination/charlswasm_decode.js"
install -m 0644 "$temporary/package/dist/charlswasm_decode.wasm" "$destination/charlswasm_decode.wasm"

printf 'Vendored @cornerstonejs/codec-charls %s\n' "$version"
printf '%s  %s\n%s  %s\n' \
    'c8ef100ac02552c692d59e60f61ab9dc84f355a62386d571e3db2c1046aa1f5a' "$destination/charlswasm_decode.js" \
    'a8b192966b58218713ac09750a6bf6560d22fe12906600b88fcd49ff0d001e04' "$destination/charlswasm_decode.wasm" \
    | sha256sum --check -
sha256sum "$destination/charlswasm_decode.js" "$destination/charlswasm_decode.wasm"
