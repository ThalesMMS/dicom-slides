(function (global) {
  "use strict";

  const FRAME_SETTINGS_KEY = "dicomSlides.powerPoint.frame.v1";

  function documentSettings() {
    return global.Office?.context?.document?.settings || null;
  }

  function saveSettings(settings) {
    if (!settings || typeof settings.saveAsync !== "function") return Promise.resolve(false);
    return new Promise((resolve, reject) => {
      settings.saveAsync((result) => {
        if (result.status === global.Office?.AsyncResultStatus?.Failed) {
          reject(new Error(result.error?.message || "PowerPoint could not save the add-in frame state."));
        } else {
          resolve(true);
        }
      });
    });
  }

  async function writeFrameRecord(record) {
    const settings = documentSettings();
    if (!settings) return false;
    settings.set(FRAME_SETTINGS_KEY, record);
    return saveSettings(settings);
  }

  function readFrameRecord() {
    try {
      const value = documentSettings()?.get(FRAME_SETTINGS_KEY);
      return value && typeof value === "object" ? value : null;
    } catch (_) {
      return null;
    }
  }

  function isContentApp(shape) {
    return String(shape?.type || "").toLowerCase() === "contentapp";
  }

  function supportsNativeExpansion() {
    try {
      return typeof global.PowerPoint?.run === "function"
        && global.Office?.context?.requirements?.isSetSupported?.("PowerPointApi", "1.10") === true;
    } catch (_) {
      return false;
    }
  }

  async function resolveSelectedContentApp(context) {
    const presentation = context.presentation;
    const selectedShapes = presentation.getSelectedShapes();
    const selectedSlides = presentation.getSelectedSlides();
    const pageSetup = presentation.pageSetup;
    selectedShapes.load("items/id,items/type,items/left,items/top,items/width,items/height");
    selectedSlides.load("items/id,items/shapes/items/id,items/shapes/items/type,items/shapes/items/left,items/shapes/items/top,items/shapes/items/width,items/shapes/items/height");
    pageSetup.load("slideWidth,slideHeight");
    await context.sync();

    let candidates = selectedShapes.items.filter(isContentApp);
    if (candidates.length !== 1) {
      candidates = selectedSlides.items.flatMap((slide) => slide.shapes.items.filter(isContentApp));
    }
    if (candidates.length !== 1) {
      throw new Error("PowerPoint could not identify one content add-in on the selected slide.");
    }

    const shape = candidates[0];
    const slide = selectedSlides.items.find((entry) => entry.shapes.items.some((item) => item.id === shape.id));
    if (!slide) throw new Error("PowerPoint could not identify the slide containing this add-in.");
    return { pageSetup, shape, slide };
  }

  async function expandNative() {
    return global.PowerPoint.run(async (context) => {
      const { pageSetup, shape, slide } = await resolveSelectedContentApp(context);
      const record = {
        expanded: true,
        native: true,
        slideId: slide.id,
        shapeId: shape.id,
        left: shape.left,
        top: shape.top,
        width: shape.width,
        height: shape.height,
      };
      await writeFrameRecord(record);
      shape.left = 0;
      shape.top = 0;
      shape.width = pageSetup.slideWidth;
      shape.height = pageSetup.slideHeight;
      try {
        await context.sync();
      } catch (error) {
        await writeFrameRecord(null).catch(() => {});
        throw error;
      }
      return record;
    });
  }

  async function restoreNative(record) {
    return global.PowerPoint.run(async (context) => {
      const slide = context.presentation.slides.getItem(record.slideId);
      const shape = slide.shapes.getItem(record.shapeId);
      shape.left = record.left;
      shape.top = record.top;
      shape.width = record.width;
      shape.height = record.height;
      await context.sync();
    });
  }

  function createExpansionController(options = {}) {
    const getViewer = typeof options.getViewer === "function" ? options.getViewer : () => null;
    const onExpandedChange = typeof options.onExpandedChange === "function" ? options.onExpandedChange : () => {};
    const onStatus = typeof options.onStatus === "function" ? options.onStatus : () => {};
    let expanded = Boolean(readFrameRecord()?.expanded);

    async function applyExpandedState(value) {
      expanded = Boolean(value);
      const viewer = getViewer();
      if (viewer?.setExpanded) await viewer.setExpanded(expanded);
      onExpandedChange(expanded);
      return expanded;
    }

    async function useInternalFallback() {
      await writeFrameRecord({ expanded: true, native: false }).catch(() => {});
      onStatus("Expanded within the current add-in frame because slide resizing is unavailable.");
      return applyExpandedState(true);
    }

    async function setExpanded(value) {
      const requested = Boolean(value);
      const record = readFrameRecord();
      if (requested) {
        if (!supportsNativeExpansion()) return useInternalFallback();
        try {
          await expandNative();
          return applyExpandedState(true);
        } catch (_) {
          return useInternalFallback();
        }
      }

      if (record?.native) {
        try {
          await restoreNative(record);
        } catch (error) {
          onStatus(`Could not restore the add-in size: ${error?.message || String(error)}`);
          return applyExpandedState(true);
        }
      }
      await writeFrameRecord(null).catch(() => {});
      onStatus(record?.native ? "Viewer size restored on the slide." : "Viewer size restored.");
      return applyExpandedState(false);
    }

    async function initialize() {
      const record = readFrameRecord();
      return applyExpandedState(Boolean(record?.expanded));
    }

    return Object.freeze({
      initialize,
      isExpanded: () => expanded,
      setExpanded,
      toggle: () => setExpanded(!expanded),
    });
  }

  global.DicomSlidesPowerPointHost = Object.freeze({
    FRAME_SETTINGS_KEY,
    createExpansionController,
  });
})(window);
