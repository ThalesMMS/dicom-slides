(function (global) {
  "use strict";

  const FRAME_SETTINGS_KEY = "dicomSlides.powerPoint.frame.v1";
  const FRAME_TARGET_SETTINGS_KEY = "dicomSlides.powerPoint.frameTarget.v1";

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

  async function writeFrameTarget(record) {
    const settings = documentSettings();
    if (!settings) return false;
    settings.set(FRAME_TARGET_SETTINGS_KEY, record);
    return saveSettings(settings);
  }

  function readFrameTarget() {
    try {
      const value = documentSettings()?.get(FRAME_TARGET_SETTINGS_KEY);
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

  function isPowerPointHost() {
    const host = global.Office?.context?.host;
    const powerPoint = global.Office?.HostType?.PowerPoint || "PowerPoint";
    return host === powerPoint || String(host || "").toLowerCase() === "powerpoint";
  }

  async function resolveSelectedContentApp(context) {
    const presentation = context.presentation;
    const selectedSlides = presentation.getSelectedSlides();
    selectedSlides.load("items/id");
    await context.sync();

    if (selectedSlides.items.length !== 1) {
      throw new Error("PowerPoint could not identify the active slide.");
    }

    const slide = selectedSlides.items[0];
    const selectedShapes = presentation.getSelectedShapes();
    const pageSetup = presentation.pageSetup;
    selectedShapes.load("items/id,items/type,items/left,items/top,items/width,items/height");
    slide.shapes.load("items/id,items/type,items/left,items/top,items/width,items/height");
    pageSetup.load("slideWidth,slideHeight");
    await context.sync();

    let candidates = selectedShapes.items.filter(isContentApp);
    if (candidates.length !== 1) {
      candidates = slide.shapes.items.filter(isContentApp);
    }
    if (candidates.length !== 1) {
      throw new Error("PowerPoint could not identify one content add-in on the selected slide.");
    }

    const shape = candidates[0];
    return { pageSetup, shape, slide };
  }

  async function resolveKnownContentApp(context, target) {
    const presentation = context.presentation;
    const slide = presentation.slides.getItem(target.slideId);
    const shape = slide.shapes.getItem(target.shapeId);
    const pageSetup = presentation.pageSetup;
    shape.load("id,type,left,top,width,height");
    pageSetup.load("slideWidth,slideHeight");
    await context.sync();
    if (!isContentApp(shape)) {
      throw new Error("PowerPoint could not find this content add-in on the active slide.");
    }
    return { pageSetup, shape, slide };
  }

  async function expandNative(target = null) {
    return global.PowerPoint.run(async (context) => {
      const { pageSetup, shape, slide } = target
        ? await resolveKnownContentApp(context, target)
        : await resolveSelectedContentApp(context);
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
      await writeFrameTarget({ slideId: slide.id, shapeId: shape.id });
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
    const getActiveView = typeof options.getActiveView === "function" ? options.getActiveView : () => "edit";
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

    async function reportNativeFailure(message, error = null) {
      await writeFrameRecord(null).catch(() => {});
      if (error) global.console?.warn?.("DICOM Slides could not resize its PowerPoint content add-in.", error);
      onStatus(message);
      return applyExpandedState(false);
    }

    async function setExpanded(value) {
      const requested = Boolean(value);
      const record = readFrameRecord();
      if (requested) {
        if (!supportsNativeExpansion()) {
          if (!isPowerPointHost()) return useInternalFallback();
          return reportNativeFailure("Slide fullscreen requires PowerPoint 16.105 or later.");
        }
        try {
          const readView = String(getActiveView() || "").toLowerCase() === "read";
          const target = readView ? readFrameTarget() : null;
          if (readView && !target) {
            return reportNativeFailure(
              "Open this slide once in edit mode before using fullscreen in Slide Show.",
            );
          }
          await expandNative(target);
          return applyExpandedState(true);
        } catch (error) {
          if (!isPowerPointHost()) return useInternalFallback();
          return reportNativeFailure(
            `Could not expand the add-in to fill the slide: ${error?.message || String(error)}`,
            error,
          );
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

    async function prepare() {
      if (String(getActiveView() || "").toLowerCase() === "read") return false;
      if (!isPowerPointHost() || !supportsNativeExpansion()) return false;
      try {
        return await global.PowerPoint.run(async (context) => {
          const { shape, slide } = await resolveSelectedContentApp(context);
          await writeFrameTarget({ slideId: slide.id, shapeId: shape.id });
          return true;
        });
      } catch (error) {
        global.console?.warn?.("DICOM Slides could not prepare its PowerPoint slide target.", error);
        return false;
      }
    }

    return Object.freeze({
      initialize,
      isExpanded: () => expanded,
      prepare,
      setExpanded,
      toggle: () => setExpanded(!expanded),
    });
  }

  global.DicomSlidesPowerPointHost = Object.freeze({
    FRAME_SETTINGS_KEY,
    FRAME_TARGET_SETTINGS_KEY,
    createExpansionController,
  });
})(window);
