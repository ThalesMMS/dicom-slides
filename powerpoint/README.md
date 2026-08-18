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
  -> decode stored pixels, including JPEG 2000 through local OpenJPEG/Wasm
  -> apply Rescale Slope/Intercept for monochrome images
  -> convert to Int16 little-endian or RGB8
  -> split each series into 12-slice chunks
  -> gzip each chunk with `CompressionStream('gzip')`
  -> encode the compressed payload as base64
  -> register study, manifests, and chunks in DICOM Slides
  -> store the converted package in IndexedDB when available
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
- one frame per DICOM file;
- monochrome images with 8- or 16-bit allocated samples;
- signed and unsigned stored values;
- Bits Stored and Pixel Representation handling;
- Rescale Slope and Rescale Intercept;
- MONOCHROME1 inversion;
- RGB with three 8-bit samples, interleaved or planar;
- ZIP method 0 (stored) and method 8 (deflate), when the webview provides
  `DecompressionStream('deflate-raw')`.

JPEG 2000 decoding uses the vendored `@cornerstonejs/codec-openjpeg` WebAssembly
build under its MIT license. The JavaScript, Wasm binary, and license are served
from `powerpoint/vendor/openjpeg/`; pixel data never leaves the local WebView.
The vendored decoder cannot preserve negative signed 8-bit JPEG 2000 samples,
so that specific representation is rejected with an explicit technical reason.
Unsigned 8-bit and signed/unsigned 16-bit-allocated JPEG 2000 remain supported.

Other compressed DICOM transfer syntaxes, multiframe objects, palettes, YBR,
RLE, JPEG, and JPEG-LS are not decoded by the browser importer. Such series are
skipped with a codec-specific reason. Use the repository's offline
`tools/convert_study.py` pipeline when another codec is required; it can use
`gdcmconv`.

## Persistence model

The converted pixel package is **not embedded into the `.pptx` in this
version**.

The content-add-in instance stores the following small configuration through
`Office.context.document.settings`:

- source type;
- study ID and local package reference;
- active series;
- current image;
- 2D/MPR/3D mode;
- active tool;
- window center and width.

The converted manifests and gzip/base64 chunks are stored in **IndexedDB** for
the add-in origin. Consequently:

- reopening the presentation on the same device, Office profile, and add-in
  origin can restore the imported exam without reconversion;
- clearing browser/Office webview storage removes the local exam cache;
- opening the `.pptx` on another computer does not transfer the pixels;
- when the cache is missing, the add-in asks the user to import the DICOM files
  again;
- if IndexedDB is unavailable or its quota is exceeded, the imported exam
  remains usable for the current session but is not restorable later.

Inside PowerPoint, `Office.context.document.settings` is the only authority for
the study assigned to the slide. The add-in waits for Office initialization
before restoring that state, and it awaits `settings.saveAsync` after a local
import. Origin-wide `localStorage` is used only by the standalone browser
preview, never as a PowerPoint fallback. If the slide references a local study
whose IndexedDB package is missing, the add-in asks for a new import instead of
silently displaying a demonstration study.

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

1. [Download `manifest.xml`](https://github.com/ThalesMMS/dicom-slides/raw/refs/heads/main/powerpoint/manifest.xml) (Right click -> (Right click -> Download Linked File As...) -> save as `manifest.xml`.
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
installer="$(mktemp -t dicom-slides-install)" && curl --proto '=https' --tlsv1.2 -fsSLo "$installer" https://raw.githubusercontent.com/ThalesMMS/dicom-slides/main/scripts/install-powerpoint-macos.sh && printf '%s  %s\n' '2cdc6a3dadc12ce0374439608978d2cf4c768e87a47390e1dcc51d462bd3b942' "$installer" | shasum -a 256 -c - && bash "$installer"
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
installer="$(mktemp -t dicom-slides-install)" && curl --proto '=https' --tlsv1.2 -fsSLo "$installer" https://raw.githubusercontent.com/ThalesMMS/dicom-slides/main/scripts/install-powerpoint-macos.sh && printf '%s  %s\n' '2cdc6a3dadc12ce0374439608978d2cf4c768e87a47390e1dcc51d462bd3b942' "$installer" | shasum -a 256 -c - && bash "$installer" --uninstall
```

### PowerPoint for macOS: manual installation

1. Close PowerPoint.
2. [Download `manifest.xml`](https://github.com/ThalesMMS/dicom-slides/raw/refs/heads/main/powerpoint/manifest.xml)
   and make sure the file is named `manifest.xml`.
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
$installer = Join-Path $env:TEMP ("dicom-slides-install-" + [guid]::NewGuid().ToString("N") + ".ps1"); $expected = "7bbe39aef6a7ebfc2a03eda8bc47d1db7ad2b6e74c27328bbff3e2905006101b"; Invoke-WebRequest "https://raw.githubusercontent.com/ThalesMMS/dicom-slides/main/scripts/install-powerpoint-windows.ps1" -OutFile $installer; if ((Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) { Remove-Item -LiteralPath $installer -Force; throw "DICOM Slides installer checksum mismatch" }; powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installer
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
- **A locally imported exam disappeared:** imported packages live in the
  Office webview's IndexedDB. Clearing the web cache removes those packages;
  import the original DICOM files or ZIP again.
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
node tests/javascript/test_powerpoint_dicom_importer.js
python -m unittest tests.python.test_powerpoint_addin -v
```

The validator checks the content-add-in manifest, production HTTPS URLs,
snapshot configuration, import controls, script references, local-protocol
handling, IndexedDB persistence, browser compression APIs, and the absence of
`eval`.

## Deployment notes

The production manifest deliberately points to the stable GitHub Pages URL on
the default branch. A pull-request branch cannot be used by that manifest until
the branch is merged and GitHub Pages publishes the new files. For local Office
sideloading before deployment, serve the repository through a trusted HTTPS
origin and temporarily change `SourceLocation`, `IconUrl`, and
`HighResolutionIconUrl` in a private copy of the manifest.
