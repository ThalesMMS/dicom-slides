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
  -> decode stored pixels
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
- one frame per DICOM file;
- monochrome images with 8- or 16-bit allocated samples;
- signed and unsigned stored values;
- Bits Stored and Pixel Representation handling;
- Rescale Slope and Rescale Intercept;
- MONOCHROME1 inversion;
- RGB with three 8-bit samples, interleaved or planar;
- ZIP method 0 (stored) and method 8 (deflate), when the webview provides
  `DecompressionStream('deflate-raw')`.

Compressed DICOM transfer syntaxes, encapsulated Pixel Data, multiframe
objects, palettes, YBR, RLE, JPEG, JPEG-LS, and JPEG 2000 are not decoded by the
browser importer. Such series are skipped with a visible warning. Use the
repository's offline `tools/convert_study.py` pipeline when codec support is
required; it can use `gdcmconv`, and single-frame JPEG 2000 can use Pillow.

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
It also reports `Burned In Annotation = YES` when present.

This is not an anonymization certificate. Study/series descriptions may still
contain identifiers, private tags are not exhaustively analyzed, and text may
be burned directly into the pixels. Review every imported exam before sharing
a presentation or publishing a package.

## Install from GitHub Pages

The production manifest expects this repository to be published at:

```text
https://thalesmms.github.io/dicom-slides/
```

After the files are present on GitHub Pages, download
`powerpoint/manifest.xml` and sideload it using the procedure for the PowerPoint
client in which you will test the add-in.

### PowerPoint on the web

1. Open a presentation and choose **Home > Add-ins > More Settings**.
2. Choose **Upload My Add-in** and select `manifest.xml`.
3. Insert **DICOM Slides** into the current slide.
4. Open the gear menu and choose **Files**, **Folder**, or **ZIP**.

### PowerPoint for macOS

1. Close PowerPoint.
2. In Finder, choose **Go > Go to Folder** and open:

   ```text
   ~/Library/Containers/com.microsoft.Powerpoint/Data/Documents/wef
   ```

3. Create the `wef` directory when it does not exist, then copy
   `manifest.xml` into it.
4. Reopen PowerPoint and choose **Home > Add-ins > DICOM Slides**.

For managed or broader Windows deployment, use the Microsoft 365 admin center
or an Office trusted add-in catalog. Uploading the XML manifest in PowerPoint
on the web is the simplest cross-platform development check.

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
trusted host. The same attribution and redistribution terms documented in
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
