# DICOM Slides for PowerPoint

This directory packages the existing DICOM Slides web component as a
**PowerPoint content add-in**. A content add-in is placed directly on a slide,
so the 2D stack, triplanar MPR, and WebGL2 3D viewer remain interactive instead
of being converted to a static screenshot.

> **Demonstration, education, and research use only. Not intended for diagnosis
> or clinical decision-making.**

## Files

```text
powerpoint/
  manifest.xml       production sideloading manifest
  content.html       content add-in entry point
  content.css        responsive slide UI
  content.js         Office.js integration and state persistence
  studies.js         built-in study catalog
  assets/            add-in icons
```

The add-in reuses the repository's existing `runtime/dicom-slide.js` and the
static study packages under `exams/library/`. It does not duplicate the viewer,
DICOM conversion pipeline, or pixel payload.

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

After insertion, select the gear button to choose a study, series, initial
image, mode, window preset, and 2D tool. Resize the content add-in like any
other slide object.

## Behavior

- The viewer is interactive in the slide object.
- Authoring controls are hidden when PowerPoint reports the presentation as
  being in read or slide-show view.
- The current study, series, mode, slice, active tool, and window/level are
  stored with that specific content-add-in instance by using
  `Office.context.document.settings`.
- `AllowSnapshot` is enabled in the manifest so compatible desktop clients can
  preserve a saved image representation with the presentation.
- When opened outside PowerPoint, `content.html` works as a normal browser
  preview and uses local storage only for that preview.

## Built-in studies

- MRI-DIR synthetic T1 MR: four series.
- Visible Human abdominal CT: normal and post-freezing series.

The same attribution and redistribution terms documented in
[`../DATA_LICENSES.md`](../DATA_LICENSES.md) and [`../CITING.md`](../CITING.md)
apply when these studies are used in PowerPoint.

## Custom studies

The settings panel also accepts a custom `study.js` URL. The package must use
the existing `dicom-slide-study/1` layout and be hosted over HTTPS. For example:

```text
https://cases.example.org/anonymized-case/study.js
```

A custom `study.js` is executable JavaScript, not passive JSON. Only use a
trusted host. The converter does not certify anonymization; inspect all DICOM
metadata and derived labels before publishing a case. Do not place protected
health information in a public GitHub Pages deployment.

## Browser preview

Open this page from the repository root:

```text
powerpoint/content.html
```

For the included studies, either open it directly through `file://` or run the
repository's existing static server. Office-specific persistence and active-view
handling are enabled only when the page is hosted inside PowerPoint.

## Validation

Run the static validator and JavaScript syntax checks:

```console
python tools/validate_powerpoint_addin.py
node --check powerpoint/content.js
node --check powerpoint/studies.js
python -m unittest tests.python.test_powerpoint_addin -v
```

The validator checks the manifest type, PowerPoint host, production HTTPS URLs,
requested dimensions, snapshot configuration, referenced assets, and required
HTML scripts.

## Deployment notes

The production manifest deliberately points to the stable GitHub Pages URL on
the default branch. A pull-request branch cannot be used by that manifest until
the branch is merged and GitHub Pages publishes the new files. For local Office
sideloading before deployment, serve the repository through a trusted HTTPS
origin and temporarily change `SourceLocation`, `IconUrl`, and
`HighResolutionIconUrl` in a private copy of the manifest.
