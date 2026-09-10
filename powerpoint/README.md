# DICOM Slides for PowerPoint

This directory packages the existing DICOM Slides web component as a
**PowerPoint content add-in**. A content add-in is placed directly on a slide,
so the 2D stack, triplanar MPR, and WebGL2 3D viewer remain interactive instead
of being converted to a static screenshot.

The add-in now has two study-input paths:

1. import local DICOM files, a DICOM folder, or a ZIP and convert the study in
   the PowerPoint webview at import time; or
2. open a preconverted `dicom-slide-study/1` package hosted over HTTPS.

A newly inserted add-in opens with no study selected. The import panel is shown
immediately; bundled demonstration studies remain available as optional catalog
choices and are never loaded as a fallback.

> **Demonstration, education, and research use only. Not intended for diagnosis
> or clinical decision-making.**

## Files

```text
powerpoint/
  manifest.xml          production sideloading manifest
  content.html          content add-in entry point and import UI
  content.css           responsive slide UI
  content.js            Office.js integration and state persistence
  dicom-importer.js     browser-side DICOM/ZIP parser and chunk converter
  presentation-storage.js  embedded PPTX package storage and verification
  studies.js            built-in study catalog
  assets/               add-in icons
```

The add-in reuses `../runtime/dicom-slide.js`. The importer registers its
converted manifests and chunks through the same `DicomSlideData` API used by
static packages; it does not maintain a second viewer implementation.

## What happens during local import

Choose **Files**, **Folder**, or **ZIP** in the add-in settings. The conversion
runs entirely in the current browser/PowerPoint webview:

```text
selected DICOM files or ZIP
  -> parse DICOM headers
  -> require one Study Instance UID
  -> group by Series Instance UID
  -> spatially sort each series when orientation/position permit
  -> decode stored pixels, including JPEG 2000 through OpenJPEG/Wasm and JPEG-LS through CharLS/Wasm
  -> apply Rescale Slope/Intercept for monochrome images
  -> convert to Int16 little-endian or RGB8
  -> split each series into 12-slice chunks
  -> gzip each chunk with `CompressionStream('gzip')`
  -> encode the compressed payload as base64
  -> register study, manifests, and chunks in DICOM Slides
  -> embed the complete converted package in the PowerPoint presentation
  -> cache the converted package in IndexedDB when available
```

The viewer then uses the normal lazy-loading behavior:

- 2D loads and decompresses the chunk containing the requested image and
  prefetches adjacent chunks;
- MPR and 3D load all chunks in the active series and assemble a continuous
  volume only when one of those modes is opened.

### Supported browser-side DICOM input

The import-time converter intentionally has a bounded compatibility surface:

- DICOM Part 10 files, including extensionless files;
- Implicit VR Little Endian;
- Explicit VR Little Endian;
- Explicit VR Big Endian;
- JPEG 2000 Lossless (`1.2.840.10008.1.2.4.90`);
- JPEG 2000 (`1.2.840.10008.1.2.4.91`);
- JPEG-LS Lossless (`1.2.840.10008.1.2.4.80`);
- JPEG-LS Near-Lossless (`1.2.840.10008.1.2.4.81`);
- one frame per DICOM file;
- monochrome images with 8- or 16-bit allocated samples;
- signed and unsigned stored values;
- Bits Stored and Pixel Representation handling;
- Rescale Slope and Rescale Intercept;
- MONOCHROME1 inversion;
- RGB with three 8-bit samples, interleaved or planar;
- JPEG-LS RGB and YBR_FULL normalization across planar, line, and sample interleave modes;
- ZIP method 0 (stored) and method 8 (deflate), when the webview provides
  `DecompressionStream('deflate-raw')`.

JPEG 2000 decoding uses the vendored `@cornerstonejs/codec-openjpeg` WebAssembly
build. JPEG-LS decoding uses the vendored `@cornerstonejs/codec-charls`/CharLS
WebAssembly build. JavaScript, Wasm binaries, provenance, hashes, and license
texts are stored under `powerpoint/vendor/`; pixel data never leaves the local
WebView. The JPEG-LS path validates codestream dimensions, component count,
precision, transfer-syntax/NEAR consistency, DICOM signedness, fragment
padding, and color interleave before creating the normal Int16/RGB8 package.

The OpenJPEG decoder cannot preserve negative signed 8-bit JPEG 2000 samples,
so that specific representation is rejected with an explicit technical reason.
JPEG-LS color above 8-bit precision and PALETTE COLOR are also rejected because
the current package format is RGB8 and does not carry palette lookup tables.
Other compressed transfer syntaxes, multiframe objects, RLE, and classic JPEG
remain outside the browser importer; `tools/convert_study.py` can use `gdcmconv`
for those formats.

## Persistence model

The complete converted pixel package is **embedded in the `.pptx`**. Downloading,
copying, or reopening the presentation carries the interactive study with it.

The content-add-in instance stores the following small configuration through
`Office.context.document.settings`:

- source type;
- study ID and local package reference;
- active series;
- current image;
- 2D/MPR/3D mode;
- active tool;
- window center and width.

The converted study, manifests, gzip/base64 chunks, warnings, and byte counts
are split across presentation-level `PowerPoint.presentation.customXmlParts`.
Every part and the reconstructed package have SHA-256 digests. The add-in reads
the newly stored XML back from PowerPoint and verifies every digest before it
saves the active reference. Import succeeds only after that verification and
the settings transaction complete. PowerPointApi 1.7 is declared as a manifest
requirement because custom XML presentation storage is mandatory for this
add-in.

Replacement and removal are commit-first operations: the new slide state is
saved before an old package is deleted. A small cleanup journal retains any
generation that PowerPoint could not delete and retries it the next time the
add-in opens, so hidden pixel packages do not lose their last reference. Until
that deletion succeeds, the add-in visibly reports that removal is pending.

**IndexedDB is cache only.** Clearing the Office web cache may make the next
open slower, but it does not remove an exam from a saved presentation. On any
supported computer, the add-in reconstructs the package from the `.pptx`,
verifies it, registers it with the viewer, and then refreshes the cache when
available. A missing, incomplete, or corrupt embedded generation is reported
instead of being hidden by recipient-local browser data.

Presentations saved by the older cache-only implementation are upgraded
automatically when opened on the original device while that old IndexedDB copy
still exists. This fallback is enabled only for configurations without the new
embedded-storage marker; a new-format presentation with a missing or malformed
reference is treated as corrupt. Otherwise the original DICOM study must be
imported once more so the `.pptx` can receive it.

Origin-wide `localStorage` is used only by the standalone browser preview,
never as a PowerPoint fallback.

`AllowSnapshot` remains enabled in the manifest so compatible PowerPoint
clients can preserve a static visual fallback. The snapshot is not a
replacement for the interactive pixel package.

## Privacy behavior

During local conversion, the package does not retain the values of:

- Patient Name;
- Patient ID;
- Accession Number;
- Institution Name.

The importer reports that such tags were detected without saving their values.
Their presence never blocks local conversion. It also reports
`Burned In Annotation = YES` when present.

This is not an anonymization certificate. Study/series descriptions may still
contain identifiers, private tags are not exhaustively analyzed, and text may
be burned directly into the pixels. Review every imported exam before sharing
a presentation or publishing a package.

## Installation

The production manifest loads the add-in from this exact GitHub Pages URL:

```text
https://thalesmms.github.io/dicom-slides/powerpoint/content.html
```

No DICOM files are uploaded during installation or local import. The helper
scripts are plain text and can be inspected before they are run:

- [`../scripts/install-powerpoint-macos.sh`](../scripts/install-powerpoint-macos.sh)
- [`../scripts/install-powerpoint-windows.ps1`](../scripts/install-powerpoint-windows.ps1)

### PowerPoint on the web (recommended for macOS and Windows)

1. Right-click [Download `manifest.xml`](https://github.com/ThalesMMS/dicom-slides/raw/refs/heads/main/powerpoint/manifest.xml), choose **Download Linked File As...** (or **Save link as...**), and save the file as `manifest.xml`.
2. Open [PowerPoint for the web](https://powerpoint.cloud.microsoft/) and open
   a presentation.
3. Choose **Home > Add-ins > More Settings**. Some versions label the same
   option **Advanced**.

   <p><img src="../docs/images/powerpoint-addins-advanced.png" alt="PowerPoint Add-ins pane with the Advanced option" width="49%" align="middle"> <img src="../docs/images/powerpoint-upload-addin-manifest.png" alt="Office Add-ins dialog for uploading the manifest" width="49%" align="middle"></p>

4. Choose **Upload My Add-in** and select the downloaded `manifest.xml`.
5. Insert **DICOM Slides**, open its gear menu, and choose **Files**,
   **Folder**, or **ZIP**.

The sideloaded manifest is associated with that browser. Clearing its cache or
using another browser may require uploading the manifest again. If **Upload My
Add-in** is absent, the Microsoft 365 organization may have disabled custom
add-ins.

### PowerPoint for macOS: one-command installation

Close PowerPoint, open Terminal, and run:

```console
installer="$(mktemp -t dicom-slides-install)" && curl --proto '=https' --tlsv1.2 -fsSLo "$installer" https://raw.githubusercontent.com/ThalesMMS/dicom-slides/main/scripts/install-powerpoint-macos.sh && printf '%s  %s\n' '5a881a92167e025c430021c735de4221274c93431e1abc9acb8faa0fc86c0319' "$installer" | shasum -a 256 -c - && bash "$installer"
```

The command verifies the downloaded installer against its published SHA-256.
The script then requires the exact published manifest SHA-256 and validates its
ID, host, and production URL before writing `dicom-slides.xml`. It creates the
official PowerPoint `wef` directory when needed, replaces only the DICOM Slides
manifest on update, migrates an earlier DICOM Slides installation named
`manifest.xml`, preserves other add-ins, and opens PowerPoint. It does not use
`sudo`.

To update, run the installation command again. To remove only DICOM Slides:

```console
installer="$(mktemp -t dicom-slides-install)" && curl --proto '=https' --tlsv1.2 -fsSLo "$installer" https://raw.githubusercontent.com/ThalesMMS/dicom-slides/main/scripts/install-powerpoint-macos.sh && printf '%s  %s\n' '5a881a92167e025c430021c735de4221274c93431e1abc9acb8faa0fc86c0319' "$installer" | shasum -a 256 -c - && bash "$installer" --uninstall
```

### PowerPoint for macOS: manual installation

1. Close PowerPoint.
2. Right-click [Download `manifest.xml`](https://github.com/ThalesMMS/dicom-slides/raw/refs/heads/main/powerpoint/manifest.xml), choose **Download Linked File As...** (or **Save link as...**), and save the file as `manifest.xml`.
3. Open Terminal and run:

   ```console
   mkdir -p "$HOME/Library/Containers/com.microsoft.Powerpoint/Data/Documents/wef" && open "$HOME/Library/Containers/com.microsoft.Powerpoint/Data/Documents/wef"
   ```

   This creates the official PowerPoint `wef` directory when it does not exist
   and opens it in Finder.
4. Move `manifest.xml` into the opened folder and rename it to
   `dicom-slides.xml`. If that file already exists, replace it to update DICOM
   Slides; leave every other XML file untouched.
5. Reopen PowerPoint and choose **Home > Add-ins > DICOM Slides**.

### Windows helper

Paste the following command into PowerShell:

```powershell
$installer = Join-Path $env:TEMP ("dicom-slides-install-" + [guid]::NewGuid().ToString("N") + ".ps1"); $expected = "2292cdf066e961a48745db03affa80a2485271701bc745367b5da23b40c135a3"; Invoke-WebRequest "https://raw.githubusercontent.com/ThalesMMS/dicom-slides/main/scripts/install-powerpoint-windows.ps1" -OutFile $installer; if ((Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) { Remove-Item -LiteralPath $installer -Force; throw "DICOM Slides installer checksum mismatch" }; powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installer
```

The command verifies the downloaded helper against its published SHA-256 and
runs it in a child PowerShell process whose execution-policy override applies
only to that process. The helper requires the exact published manifest SHA-256,
places `dicom-slides-manifest.xml` in the user's Downloads directory, opens
PowerPoint for the web, and prints the exact upload steps. It cannot silently
upload the manifest because Office requires that user action. It does not
require administrator rights.

Windows desktop sideloading uses a trusted add-in catalog and may require
administrator or organizational approval. Run the already-downloaded helper
with
`powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installer -Mode DesktopGuide`
to prepare the manifest and open the official Microsoft instructions. An
organizational policy can still block scripts. For managed deployment, use the
Microsoft 365 admin center instead of a per-user script.

### Troubleshooting installation

- **The add-in does not appear:** close every PowerPoint window, reopen the
  application, and check **Home > Add-ins** again.
- **An old version still loads:** clear the Office add-in web cache, then
  reopen PowerPoint. On macOS, the task pane's personality menu provides
  **Clear Web Cache**.
- **The upload option is missing:** custom add-ins may be blocked by the
  Microsoft 365 account or organization.
- **An older imported exam is unavailable:** presentations created before
  embedded storage contained only a cache reference. Open it once on the
  original device to migrate the existing cache, or import the DICOM files/ZIP
  again. New presentations carry the complete study in the `.pptx`.
- **Corporate installation:** ask the Microsoft 365 administrator to deploy
  the manifest through **Settings > Integrated apps**.

## Preconverted and remote studies

The optional built-in catalog contains:

- MRI-DIR synthetic T1 MR: four series;
- Visible Human abdominal CT: normal and post-freezing series.

The settings panel also accepts a custom HTTPS `study.js` URL. The package must
use the existing `dicom-slide-study/1` layout. For example:

```text
https://cases.example.org/anonymized-case/study.js
```

A remote `study.js` is executable JavaScript, not passive JSON. Only use a
trusted host. Catalog and managed origins load automatically; any other HTTPS
origin requires recipient-local approval before it can load and is remembered
only on that device. The same attribution and redistribution terms documented in
[`../DATA_LICENSES.md`](../DATA_LICENSES.md) and
[`../CITING.md`](../CITING.md) apply to the bundled examples.

## Browser preview

Open this page from the repository root:

```text
powerpoint/content.html
```

For the included studies, either open it directly through `file://` or run the
repository's static server. Office-specific persistence and active-view
handling are enabled only when the page is hosted inside PowerPoint. Local
DICOM import still works in an ordinary compatible browser; state falls back
to local storage and pixels use IndexedDB.

## Validation

Run the static validator and JavaScript tests:

```console
python tools/validate_powerpoint_addin.py
node --check powerpoint/content.js
node --check powerpoint/studies.js
node --check powerpoint/dicom-importer.js
node --check powerpoint/presentation-storage.js
node tests/javascript/test_powerpoint_dicom_importer.js
node tests/javascript/test_powerpoint_presentation_storage.js
python -m unittest tests.python.test_powerpoint_addin -v
```

The validator checks the content-add-in manifest, production HTTPS URLs,
snapshot configuration, PowerPointApi 1.7, import controls, script references,
local-protocol handling, embedded custom XML persistence, IndexedDB caching,
browser compression APIs, and the absence of `eval`.

## Deployment notes

The production manifest deliberately points to the stable GitHub Pages URL on
the default branch. A pull-request branch cannot be used by that manifest until
the branch is merged and GitHub Pages publishes the new files. For local Office
sideloading before deployment, serve the repository through a trusted HTTPS
origin and temporarily change `SourceLocation`, `IconUrl`, and
`HighResolutionIconUrl` in a private copy of the manifest.
