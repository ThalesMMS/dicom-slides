# Reusable viewer runtime

`dicom-slide.js` is the only script an external HTML page needs to load. It resolves and loads the internal classic-script modules sequentially, so it works without a build step, server, or native ES modules.

```html
<script src="path/to/dicom-slide/runtime/dicom-slide.js"></script>
<dicom-study-viewer
  study-id="my-study"
  src="path/to/exams/library/my-study/study.js"
  series="1"
  mode="mpr">
</dicom-study-viewer>
```

Give the element an explicit height through its own style or a containing layout. The Shadow DOM contains the complete study viewer: series selection, the complete 2D toolbar, MPR, 3D, presets, sliders, transfer functions, quality, reset, and expansion.

## Attributes

- Required: `study-id`, `src`.
- Optional initial or live state: `series`, `mode`, `preset`, `slice`, `tool`.

Changing `study-id` or `src` cleanly reloads the component. Other observed attributes are forwarded after readiness.

## JavaScript API

Await `element.ready` before reading initial state. Public methods are `setSeries(value)`, `setMode(value)`, `setSlice(value)`, `setPreset(value)`, `setWindow(center, width)`, `setTool(value)`, `setExpanded(value)`, `reset()`, and `getState()`.

Events bubble and cross the Shadow DOM boundary: `dicom-ready`, `dicom-series-change`, `dicom-state-change`, `dicom-mode-change`, `dicom-volume-progress`, `dicom-expand-request`, and `dicom-error`.

## Optional iframe adapter

`iframe/index.html` accepts `study-id`, `study`, `series`, `mode`, `preset`, `slice`, and `tool` query parameters. It maps the same viewer to `postMessage` commands for hosts that prefer an iframe boundary; no viewer implementation is duplicated there.

Pass the optional `origin` query parameter (for example, `origin=https%3A%2F%2Fslides.example`) to restrict both directions of `postMessage` traffic to that HTTP(S) origin. Omit it for a `file://` host. Incoming commands are always accepted only from the iframe's parent window. Rejected asynchronous commands are reported to the parent as `error` messages.

The files under `core/`, `study/`, and `volume/` are runtime internals. External pages should not import them directly.
