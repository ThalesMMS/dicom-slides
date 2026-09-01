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

            printf 'Vendored @cornerstonejs/codec-charls %s
' "$version"
            sha256sum "$destination/charlswasm_decode.js" "$destination/charlswasm_decode.wasm"
