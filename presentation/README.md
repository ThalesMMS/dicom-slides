# Presentation authoring

The deck contains no slide markup. `slides.js` is the ordered catalog, and each entry points to one independent HTML document under `slides/`.

## Add a slide

1. Copy an existing numbered slide folder to a new descriptive folder such as `slides/04-new-study/`.
2. Edit that folder's `index.html`. Keep asset paths relative so double-click/`file://` use continues to work.
3. Add one catalog entry to `slides.js`:

   ```js
   { id: "04-new-study", title: "New study", src: "slides/04-new-study/index.html" }
   ```

4. Open the slide HTML directly to test it in isolation, then open the root `index.html` to test deck navigation.

To embed an exam, load `../../../runtime/dicom-slide.js` and point `<dicom-study-viewer>` to a processed `../../../exams/library/<study-id>/study.js` package. Use `shared/slide.css` for the presentation layout and `shared/slide-bridge.js` for deck navigation and viewer expansion.

Reorder slides only by reordering entries in `slides.js`; folders do not need to move.
