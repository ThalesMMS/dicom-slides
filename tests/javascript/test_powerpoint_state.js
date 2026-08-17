#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..", "..");
const contentSource = fs.readFileSync(path.join(root, "powerpoint", "content.js"), "utf8");
const settingsKey = "dicomSlides.powerPoint.config.v1";

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  add(...values) {
    values.forEach((value) => this.values.add(value));
  }

  remove(...values) {
    values.forEach((value) => this.values.delete(value));
  }

  toggle(value, force) {
    if (force === undefined ? !this.values.has(value) : force) this.values.add(value);
    else this.values.delete(value);
    return this.values.has(value);
  }
}

class FakeElement {
  constructor(id = "", tagName = "div") {
    this.id = id;
    this.tagName = tagName;
    this.attributes = {};
    this.children = [];
    this.listeners = new Map();
    this.classList = new FakeClassList();
    this.dataset = {};
    this.disabled = false;
    this.files = [];
    this.hidden = false;
    this.required = false;
    this.textContent = "";
    this.value = "";
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatchEvent(event) {
    event.target = event.target || this;
    event.currentTarget = this;
    event.preventDefault = event.preventDefault || (() => {});
    for (const listener of this.listeners.get(event.type) || []) listener(event);
    return true;
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  click() {
    this.dispatchEvent({ type: "click" });
  }

  focus() {}

  querySelector(selector) {
    const match = selector.match(/^option\[value="([^"]+)"\]$/);
    if (!match) return null;
    return this.children.find((child) => child.tagName === "option" && child.value === match[1]) || null;
  }

  replaceChildren(...children) {
    this.children = children;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return this.attributes[name] ?? null;
  }
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function createPowerPointHarness(savedConfig) {
  let officeReadyCallback = null;
  let resolveImporterReady;
  let context;

  const importerReady = new Promise((resolve) => {
    resolveImporterReady = resolve;
  });
  const renderedStudyIds = [];
  const ensuredStudyIds = [];
  const viewerActions = [];
  const localStorage = {
    reads: 0,
    value: JSON.stringify({
      sourceType: "catalog",
      catalogId: "template-study",
      studyId: "template-study",
      studyUrl: "https://example.test/template-study/study.js",
    }),
    getItem() {
      this.reads += 1;
      return this.value;
    },
    setItem(_key, value) {
      this.value = value;
    },
  };

  const settings = {
    saveCalls: 0,
    stored: savedConfig ? { [settingsKey]: savedConfig } : {},
    get(key) {
      return this.stored[key] || null;
    },
    set(key, value) {
      this.stored[key] = value;
    },
    saveAsync(callback) {
      this.saveCalls += 1;
      setImmediate(() => callback({ status: "succeeded" }));
    },
  };

  const ids = [
    "authoringBar", "settingsButton", "settingsPanel", "closeSettingsButton", "settingsForm",
    "catalogId", "customSource", "localSource", "localSourceSummary", "useRemoteSourceButton",
    "removeLocalSourceButton", "studyId", "studyUrl", "series", "slice", "mode", "preset", "tool",
    "restoreButton", "importFilesButton", "importFolderButton", "importZipButton", "importFilesInput",
    "importFolderInput", "importZipInput", "importDropZone", "importProgress", "importProgressBar",
    "importProgressText", "cancelImportButton", "viewerMount", "emptyState", "emptyImportButton",
    "emptyStateTitle", "emptyStateMessage", "loadingPanel", "loadingText", "statusText", "studyLabel",
    "modeBadge", "seriesBadge", "sliceBadge",
    "viewerToolbar", "importButton", "toolWindowButton", "toolPanButton", "toolZoomButton",
    "toolScrollButton", "windowPresetSelect", "seriesSelect", "mode2dButton", "modeMprButton",
    "mode3dButton", "resetViewButton", "expandViewButton",
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, new FakeElement(id)]));
  Object.assign(elements.toolWindowButton.dataset, { tool: "window" });
  Object.assign(elements.toolPanButton.dataset, { tool: "pan" });
  Object.assign(elements.toolZoomButton.dataset, { tool: "zoom" });
  Object.assign(elements.toolScrollButton.dataset, { tool: "scroll" });
  Object.assign(elements.mode2dButton.dataset, { mode: "stack" });
  Object.assign(elements.modeMprButton.dataset, { mode: "mpr" });
  Object.assign(elements.mode3dButton.dataset, { mode: "volume" });
  [
    "settingsPanel", "customSource", "localSource", "importProgress", "cancelImportButton", "emptyState",
  ].forEach((id) => { elements[id].hidden = true; });

  const body = new FakeElement("body", "body");
  const document = {
    body,
    readyState: "complete",
    createElement(tagName) {
      if (tagName !== "dicom-study-viewer") return new FakeElement("", tagName);
      const viewer = new FakeElement("", tagName);
      viewer.ready = Promise.resolve();
      viewer.state = {
        activeTool: viewer.attributes.tool || "window",
        mode: viewer.attributes.mode || "stack",
        seriesId: viewer.attributes.series || "1",
        seriesNumber: viewer.attributes.series || "1",
        seriesTitle: "T1Post1",
        seriesOptions: [
          { id: "series-1", number: "1", title: "T1Post1", slices: 14, available: true },
          { id: "series-2", number: "2", title: "T1Post2", slices: 14, available: true },
        ],
        volumeSupported: true,
        slice: Number(viewer.attributes.slice || 0),
        studyTitle: viewer.attributes["study-id"] || "Study",
      };
      viewer.getState = () => ({ ...viewer.state });
      viewer.setWindow = async (center, width) => {
        viewerActions.push(["setWindow", center, width]);
        viewer.state.center = center;
        viewer.state.width = width;
      };
      viewer.setSeries = async (value) => {
        viewerActions.push(["setSeries", value]);
        viewer.state.activeTool = "window";
        const option = viewer.state.seriesOptions.find((entry) => entry.id === value);
        if (option) Object.assign(viewer.state, {
          seriesId: option.id,
          seriesNumber: option.number,
          seriesTitle: option.title,
        });
        viewer.dispatchEvent({ type: "dicom-series-change", detail: viewer.getState() });
      };
      viewer.setMode = async (value) => {
        viewerActions.push(["setMode", value]);
        viewer.state.mode = value;
        viewer.dispatchEvent({ type: "dicom-mode-change", detail: viewer.getState() });
      };
      viewer.setPreset = async (value) => {
        viewerActions.push(["setPreset", value]);
      };
      viewer.setTool = async (value) => {
        viewerActions.push(["setTool", value]);
        viewer.state.activeTool = value;
        viewer.dispatchEvent({ type: "dicom-state-change", detail: viewer.getState() });
      };
      viewer.reset = async () => {
        viewerActions.push(["reset"]);
      };
      viewer.setExpanded = async (value) => {
        viewerActions.push(["setExpanded", Boolean(value)]);
        viewer.state.expanded = Boolean(value);
      };
      return viewer;
    },
    getElementById(id) {
      return elements[id] || null;
    },
  };

  const originalReplaceChildren = elements.viewerMount.replaceChildren.bind(elements.viewerMount);
  elements.viewerMount.replaceChildren = (...children) => {
    originalReplaceChildren(...children);
    if (children[0]?.tagName === "dicom-study-viewer") {
      renderedStudyIds.push(children[0].attributes["study-id"]);
    }
  };

  const timeoutCallbacks = new Map();
  let nextTimeoutId = 1;
  const importer = {
    ready: importerReady,
    async ensureRegistered(studyId) {
      ensuredStudyIds.push(studyId);
    },
    isLocalStudyUrl(url) {
      return String(url || "").startsWith("dicom-slides-local:");
    },
    studyIdFromLocalUrl(url) {
      return String(url || "").replace("dicom-slides-local:", "").toLowerCase();
    },
    localStudyUrl(studyId) {
      return `dicom-slides-local:${studyId}`;
    },
    async importFiles() {
      const study = {
        studyId: "local-study-x",
        title: "Study X",
        seriesCount: 1,
        series: [{ id: "series-x", slices: 12 }],
      };
      context.__DICOM_SLIDE_STUDIES__[study.studyId] = study;
      return {
        persisted: true,
        study,
        totalCompressedBytes: 2048,
        warnings: [],
      };
    },
    async deletePackage() {},
  };

  context = vm.createContext({
    AbortController,
    URL,
    __DICOM_SLIDE_STUDIES__: {},
    addEventListener() {},
    clearTimeout(id) {
      timeoutCallbacks.delete(id);
    },
    console,
    document,
    location: { href: "https://example.test/powerpoint/content.html", protocol: "https:" },
    localStorage,
    setTimeout(callback) {
      const id = nextTimeoutId;
      nextTimeoutId += 1;
      timeoutCallbacks.set(id, callback);
      return id;
    },
    DicomSlidesImporter: importer,
    DicomSlidesPowerPoint: {
      studies: [{
        id: "template-study",
        label: "Template study",
        studyId: "template-study",
        studyUrl: "https://example.test/template-study/study.js",
        defaultSeries: "1",
        defaultMode: "stack",
        defaultPreset: "default",
        defaultSlice: 3,
      }],
    },
    Office: {
      ActiveView: { Read: "read" },
      AsyncResultStatus: { Failed: "failed", Succeeded: "succeeded" },
      EventType: { ActiveViewChanged: "active-view-changed" },
      HostType: { PowerPoint: "PowerPoint" },
      context: {
        document: {
          addHandlerAsync(_event, _handler, callback) {
            callback({ status: "succeeded" });
          },
          getActiveViewAsync(callback) {
            callback({ status: "succeeded", value: "edit" });
          },
          settings,
        },
      },
      onReady(callback) {
        officeReadyCallback = callback;
        return Promise.resolve();
      },
    },
  });
  context.window = context;
  context.globalThis = context;

  vm.runInContext(contentSource, context, { filename: "powerpoint/content.js" });
  await flush();
  assert.equal(typeof officeReadyCallback, "function", "Office.onReady callback must be registered");
  officeReadyCallback({ host: "PowerPoint" });
  await flush();

  return {
    api: context.DicomSlidesPowerPointAddin,
    elements,
    ensuredStudyIds,
    localStorage,
    renderedStudyIds,
    resolveImporterReady,
    settings,
    viewerActions,
  };
}

async function finishBoot(harness) {
  harness.resolveImporterReady();
  await flush();
  await flush();
  await flush();
}

async function testNewSlideStartsEmpty() {
  const harness = await createPowerPointHarness(null);
  await finishBoot(harness);

  assert.equal(harness.elements.viewerMount.children.length, 0, "a new slide must not render a template study");
  assert.equal(harness.elements.emptyState.hidden, false, "a new slide must show the empty state");
  assert.equal(harness.elements.settingsPanel.hidden, false, "a new slide must open the import settings");
  assert.deepEqual(harness.renderedStudyIds, [], "a new slide must never fetch a template study");
  assert.equal(harness.localStorage.reads, 0, "PowerPoint must not use origin-wide localStorage as slide state");
}

async function testSavedLocalStudyWinsTheOnlyBootRace() {
  const savedConfig = {
    schemaVersion: 2,
    sourceType: "local",
    catalogId: "custom",
    studyId: "local-study-x",
    studyUrl: "dicom-slides-local:local-study-x",
    series: "series-x",
    mode: "stack",
    preset: "default",
    slice: 5,
    tool: "window",
    center: null,
    width: null,
  };
  const harness = await createPowerPointHarness(savedConfig);
  await finishBoot(harness);

  assert.equal(harness.elements.viewerMount.children.length, 1, "the saved study must be restored");
  assert.equal(
    harness.elements.viewerMount.children[0].attributes["study-id"],
    "local-study-x",
    "the saved study must remain visible after startup settles",
  );
  assert.deepEqual(harness.renderedStudyIds, ["local-study-x"], "startup must not render a competing template");
  assert.deepEqual(harness.ensuredStudyIds, ["local-study-x"], "the saved local package must be restored from IndexedDB");
  assert.equal(harness.localStorage.reads, 0, "PowerPoint must ignore stale preview state");
}

async function testImportWaitsForSlideSettingsSave() {
  const harness = await createPowerPointHarness(null);
  await finishBoot(harness);

  await harness.api.importLocalFiles([{ name: "study-x.dcm" }]);

  assert.equal(harness.settings.saveCalls, 1, "import completion must save the slide settings immediately");
  assert.equal(
    harness.settings.stored[settingsKey].studyId,
    "local-study-x",
    "the saved slide settings must reference the imported study",
  );
}

async function testCompactToolbarControlsThePublicViewerApi() {
  const savedConfig = {
    schemaVersion: 2,
    sourceType: "local",
    catalogId: "custom",
    studyId: "local-study-x",
    studyUrl: "dicom-slides-local:local-study-x",
    series: "series-1",
    mode: "stack",
    preset: "default",
    slice: 5,
    tool: "window",
    center: null,
    width: null,
  };
  const harness = await createPowerPointHarness(savedConfig);
  await finishBoot(harness);
  const viewer = harness.elements.viewerMount.children[0];

  assert.equal(viewer.attributes.controls, "external", "PowerPoint must own the only visible toolbar");
  assert.deepEqual(
    harness.elements.seriesSelect.children.map((option) => option.textContent),
    ["1 · T1Post1", "2 · T1Post2"],
    "the compact series dropdown must be populated from viewer state",
  );

  harness.elements.toolPanButton.click();
  await flush();
  harness.elements.windowPresetSelect.value = "bone";
  harness.elements.windowPresetSelect.dispatchEvent({ type: "change" });
  await flush();
  harness.elements.seriesSelect.value = "series-2";
  harness.elements.seriesSelect.dispatchEvent({ type: "change" });
  await flush();
  harness.elements.modeMprButton.click();
  await flush();
  harness.elements.resetViewButton.click();
  await flush();

  assert.deepEqual(harness.viewerActions.slice(-8), [
    ["setTool", "pan"],
    ["setPreset", "bone"],
    ["setSeries", "series-2"],
    ["setPreset", "bone"],
    ["setTool", "pan"],
    ["setMode", "stack"],
    ["setMode", "mpr"],
    ["reset"],
  ]);
  assert.equal(harness.elements.toolPanButton.attributes["aria-pressed"], "true");
  assert.equal(harness.elements.modeMprButton.attributes["aria-pressed"], "true");
}

(async () => {
  const tests = {
    empty: testNewSlideStartsEmpty,
    restore: testSavedLocalStudyWinsTheOnlyBootRace,
    save: testImportWaitsForSlideSettingsSave,
    toolbar: testCompactToolbarControlsThePublicViewerApi,
  };
  const selected = process.argv[2] ? { [process.argv[2]]: tests[process.argv[2]] } : tests;
  assert.ok(Object.values(selected).every((test) => typeof test === "function"), "unknown test name");
  for (const test of Object.values(selected)) await test();
  console.log("PowerPoint empty-state and persistence tests passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
