#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..", "..");
const contentSource = fs.readFileSync(path.join(root, "powerpoint", "content.js"), "utf8");
const settingsKey = "dicomSlides.powerPoint.config.v1";
const packageReferenceKey = "dicomSlides.powerPoint.packageRef.v1";
const packageCleanupKey = "dicomSlides.powerPoint.packageCleanup.v1";

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

async function createPowerPointHarness(savedConfig, options = {}) {
  let officeReadyCallback = null;
  let resolveImporterReady;
  let resolveRuntimeReady = () => {};
  let context;
  const initialPackageReference = options.savedPackageReference === undefined
    && savedConfig?.sourceType === "local" && options.legacyCacheOnly !== true
    ? packageReference(savedConfig.studyId)
    : options.savedPackageReference;

  const importerReady = new Promise((resolve) => {
    resolveImporterReady = resolve;
  });
  const runtimeReady = options.deferRuntimeReady
    ? new Promise((resolve) => { resolveRuntimeReady = resolve; })
    : Promise.resolve();
  const renderedStudyIds = [];
  const ensuredStudyIds = [];
  const cacheDeletedStudyIds = [];
  const cacheLoadedStudyIds = [];
  const cacheStoredStudyIds = [];
  const embeddedPackages = new Map();
  const packageReferencesRead = [];
  const packageReferencesDeleted = [];
  const packagesRegistered = [];
  const importOptionsSeen = [];
  const operationLog = [];
  const viewerActions = [];
  const storageValues = new Map([
    ["dicomSlides.powerPoint.preview.v1", JSON.stringify({
      sourceType: "catalog",
      catalogId: "template-study",
      studyId: "template-study",
      studyUrl: "https://example.test/template-study/study.js",
    })],
  ]);
  const localStorage = {
    reads: 0,
    getItem(key) {
      if (key === "dicomSlides.powerPoint.preview.v1") this.reads += 1;
      return storageValues.get(key) || null;
    },
    setItem(key, value) {
      storageValues.set(key, value);
    },
  };

  const settings = {
    saveCalls: 0,
    stored: Object.assign(
      {},
      savedConfig ? { [settingsKey]: savedConfig } : {},
      initialPackageReference ? { [packageReferenceKey]: initialPackageReference } : {},
      options.savedPackageCleanup ? { [packageCleanupKey]: options.savedPackageCleanup } : {},
    ),
    persisted: Object.assign(
      {},
      savedConfig ? { [settingsKey]: savedConfig } : {},
      initialPackageReference ? { [packageReferenceKey]: initialPackageReference } : {},
      options.savedPackageCleanup ? { [packageCleanupKey]: options.savedPackageCleanup } : {},
    ),
    get(key) {
      return this.stored[key] || null;
    },
    set(key, value) {
      this.stored[key] = value;
    },
    remove(key) {
      delete this.stored[key];
    },
    saveAsync(callback) {
      this.saveCalls += 1;
      operationLog.push(["settings.save"]);
      setImmediate(() => {
        if (options.settingsSaveFails) {
          callback({ status: "failed", error: { message: "PowerPoint settings save failed." } });
          return;
        }
        this.persisted = JSON.parse(JSON.stringify(this.stored));
        callback({ status: "succeeded" });
      });
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
      operationLog.push(["viewer.render", children[0].attributes["study-id"]]);
    }
  };

  const timeoutCallbacks = new Map();
  let nextTimeoutId = 1;
  const importer = {
    ready: importerReady,
    async ensureRegistered(studyId) {
      if (context.__DICOM_SLIDE_STUDIES__[studyId]) return context.__DICOM_SLIDE_STUDIES__[studyId];
      ensuredStudyIds.push(studyId);
      throw new Error("IndexedDB lookup was required unexpectedly.");
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
    async importFiles(...args) {
      importOptionsSeen.push(args[1] || {});
      if (options.importFiles) return options.importFiles(...args);
      const study = {
        studyId: "local-study-x",
        title: "Study X",
        seriesCount: 1,
        series: [{ id: "series-x", slices: 12 }],
      };
      return {
        persisted: true,
        package: importedPackage(study.studyId),
        study,
        totalCompressedBytes: 2048,
        warnings: [],
      };
    },
    async registerPackage(packageRecord) {
      packagesRegistered.push(packageRecord);
      operationLog.push(["runtime.register", packageRecord.study.studyId]);
      context.__DICOM_SLIDE_STUDIES__[packageRecord.study.studyId] = packageRecord.study;
      return packageRecord.study;
    },
    async storePackage(packageRecord) {
      cacheStoredStudyIds.push(packageRecord.study.studyId);
      operationLog.push(["cache.store", packageRecord.study.studyId]);
      return true;
    },
    async loadPackage(studyId) {
      cacheLoadedStudyIds.push(studyId);
      if (typeof options.loadPackage === "function") return options.loadPackage(studyId);
      return options.cachedPackage || null;
    },
    async deletePackage(studyId) {
      cacheDeletedStudyIds.push(studyId);
      return true;
    },
  };

  if (initialPackageReference) {
    embeddedPackages.set(
      initialPackageReference.namespaceUri,
      options.embeddedPackage || importedPackage(initialPackageReference.studyId),
    );
  }
  for (const cleanupReference of options.savedPackageCleanup || []) {
    embeddedPackages.set(
      cleanupReference.namespaceUri,
      importedPackage(cleanupReference.studyId),
    );
  }

  let nextPackageGeneration = 1;
  const presentationStorage = {
    isSupported() {
      return options.presentationStorageSupported !== false;
    },
    async writePackage(packageRecord, storageOptions = {}) {
      operationLog.push(["presentation.write.start", packageRecord.study.studyId]);
      if (typeof options.writePackage === "function") {
        return options.writePackage(packageRecord, storageOptions);
      }
      const generationId = `00000000-0000-4000-8000-${String(nextPackageGeneration).padStart(12, "0")}`;
      nextPackageGeneration += 1;
      const reference = packageReference(packageRecord.study.studyId, generationId);
      embeddedPackages.set(reference.namespaceUri, packageRecord);
      storageOptions.onProgress?.({ phase: "embed", progress: 1, message: "Study embedded in presentation." });
      operationLog.push(["presentation.write.complete", packageRecord.study.studyId]);
      return reference;
    },
    async readPackage(reference, storageOptions = {}) {
      packageReferencesRead.push(reference);
      operationLog.push(["presentation.read", reference.studyId]);
      if (typeof options.readPackage === "function") return options.readPackage(reference, storageOptions);
      const packageRecord = embeddedPackages.get(reference.namespaceUri);
      if (!packageRecord) throw new Error("Embedded package is missing.");
      return packageRecord;
    },
    async deletePackage(reference) {
      packageReferencesDeleted.push(reference);
      operationLog.push(["presentation.delete", reference.studyId]);
      if (typeof options.deleteEmbeddedPackage === "function") {
        return options.deleteEmbeddedPackage(reference);
      }
      return embeddedPackages.delete(reference.namespaceUri);
    },
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
    confirm: options.confirm || (() => false),
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
    DicomSlidesPresentationStorage: presentationStorage,
    DicomSlide: { ready: runtimeReady },
    DicomSlidesPowerPoint: {
      trustedStudyOrigins: options.trustedStudyOrigins || [],
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
    cacheDeletedStudyIds,
    cacheLoadedStudyIds,
    cacheStoredStudyIds,
    elements,
    embeddedPackages,
    ensuredStudyIds,
    localStorage,
    importOptionsSeen,
    pendingTimeoutCount: () => timeoutCallbacks.size,
    packageReferencesDeleted,
    packageReferencesRead,
    packagesRegistered,
    operationLog,
    renderedStudyIds,
    resolveImporterReady,
    resolveRuntimeReady,
    settings,
    viewerActions,
  };
}

function localConfig() {
  return {
    schemaVersion: 3,
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
    storageMode: "presentation-custom-xml",
  };
}

function legacyLocalConfig() {
  const config = localConfig();
  config.schemaVersion = 2;
  delete config.storageMode;
  return config;
}

function packageReference(studyId = "local-study-x", generationId = "00000000-0000-4000-8000-000000000001") {
  return {
    schemaVersion: 1,
    studyId,
    generationId,
    namespaceUri: `https://thalesmms.github.io/dicom-slides/powerpoint/package/1/${generationId}`,
    partCount: 1,
    packageSha256: "a".repeat(64),
  };
}

function importedPackage(studyId = "local-study-x") {
  const study = {
    studyId,
    title: "Study X",
    seriesCount: 1,
    series: [{ id: "series-x", slices: 12 }],
  };
  return {
    id: studyId,
    schemaVersion: 1,
    createdAt: "2026-08-18T12:00:00.000Z",
    study,
    manifests: { "series-x": { dimensions: { slices: 12, rows: 2, columns: 2 } } },
    chunks: { "series-x": ["H4sIAAAAAAAA"] },
    warnings: [],
    totalCompressedBytes: 2048,
    totalPixelBytes: 4096,
  };
}

function importedStudyResult(studyId = "local-study-x") {
  const packageRecord = importedPackage(studyId);
  return {
    persisted: true,
    package: packageRecord,
    study: packageRecord.study,
    totalCompressedBytes: 2048,
    warnings: [],
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
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

async function testSavedLocalStudyRestoresFromThePresentationWithoutIndexedDb() {
  const savedConfig = localConfig();
  const reference = packageReference();
  const packageRecord = importedPackage();
  const harness = await createPowerPointHarness(savedConfig, {
    savedPackageReference: reference,
    embeddedPackage: packageRecord,
  });
  await finishBoot(harness);

  assert.equal(harness.elements.viewerMount.children.length, 1, "the saved study must be restored");
  assert.equal(
    harness.elements.viewerMount.children[0].attributes["study-id"],
    "local-study-x",
    "the saved study must remain visible after startup settles",
  );
  assert.deepEqual(harness.renderedStudyIds, ["local-study-x"], "startup must not render a competing template");
  assert.equal(harness.packageReferencesRead.length, 1, "startup must read the package embedded in the presentation");
  assert.deepEqual(harness.packagesRegistered.map((entry) => entry.study.studyId), ["local-study-x"]);
  assert.deepEqual(harness.cacheLoadedStudyIds, [], "a referenced presentation package must not fall back to IndexedDB");
  assert.deepEqual(harness.cacheStoredStudyIds, ["local-study-x"], "restored presentation data should refresh the cache best-effort");
  assert.deepEqual(harness.ensuredStudyIds, [], "the viewer must already be registered before rendering");
  assert.equal(harness.localStorage.reads, 0, "PowerPoint must ignore stale preview state");
}

async function testViewerWaitsForTheRuntimeModules() {
  const harness = await createPowerPointHarness(localConfig(), { deferRuntimeReady: true });
  harness.resolveImporterReady();
  await flush();
  await flush();

  assert.deepEqual(harness.renderedStudyIds, [], "the viewer must not render before its custom element is registered");

  harness.resolveRuntimeReady();
  await flush();
  await flush();
  await flush();
  assert.deepEqual(harness.renderedStudyIds, ["local-study-x"]);
}

async function testImportEmbedsPackageBeforeSlideSettingsSave() {
  const harness = await createPowerPointHarness(null);
  await finishBoot(harness);

  await harness.api.importLocalFiles([{ name: "study-x.dcm" }]);

  assert.equal(harness.settings.saveCalls, 1, "import completion must save the slide settings immediately");
  assert.equal(
    harness.settings.stored[settingsKey].studyId,
    "local-study-x",
    "the saved slide settings must reference the imported study",
  );
  assert.equal(
    harness.settings.stored[settingsKey].storageMode,
    "presentation-custom-xml",
    "new presentations must be distinguishable from legacy cache-only slides",
  );
  assert.equal(
    harness.settings.stored[packageReferenceKey].studyId,
    "local-study-x",
    "the settings must reference the complete package embedded in the presentation",
  );
  assert.equal(harness.embeddedPackages.size, 1, "the converted package must be inside the presentation");
  assert.ok(
    harness.operationLog.findIndex(([name]) => name === "presentation.write.complete")
      < harness.operationLog.findIndex(([name]) => name === "settings.save"),
    "the complete package must be embedded before settings can make it authoritative",
  );
  assert.ok(
    harness.operationLog.findIndex(([name]) => name === "settings.save")
      < harness.operationLog.findIndex(([name]) => name === "runtime.register"),
    "runtime registration and cache refresh must happen only after the presentation commit",
  );
}

async function testEmbeddingFailureDoesNotSaveLocalSlideState() {
  const harness = await createPowerPointHarness(null, {
    async writePackage() {
      throw new Error("PowerPoint rejected the custom XML package.");
    },
  });
  await finishBoot(harness);

  await harness.api.importLocalFiles([{ name: "study-x.dcm" }]);

  assert.equal(harness.settings.saveCalls, 0, "a cache-only import must never be saved as a valid slide case");
  assert.equal(harness.settings.stored[settingsKey], undefined);
  assert.equal(harness.settings.stored[packageReferenceKey], undefined);
  assert.equal(harness.importOptionsSeen[0].persist, false, "PowerPoint must not cache before the PPTX transaction commits");
  assert.equal(harness.importOptionsSeen[0].register, false, "PowerPoint must not register pixels before the PPTX transaction commits");
  assert.deepEqual(harness.packagesRegistered, []);
  assert.deepEqual(harness.cacheStoredStudyIds, []);
  assert.match(harness.elements.importProgressText.textContent, /rejected the custom XML package/i);
}

async function testSettingsFailureRollsBackNewEmbeddedGeneration() {
  const harness = await createPowerPointHarness(null, { settingsSaveFails: true });
  await finishBoot(harness);

  await harness.api.importLocalFiles([{ name: "study-x.dcm" }]);

  assert.equal(harness.embeddedPackages.size, 0, "a package without a saved reference must be removed");
  assert.deepEqual(harness.packageReferencesDeleted.map((entry) => entry.studyId), ["local-study-x"]);
  assert.equal(harness.settings.persisted[settingsKey], undefined);
  assert.equal(harness.settings.persisted[packageReferenceKey], undefined);
  assert.equal(harness.api.getState().sourceType, "empty", "a failed transaction must restore the prior slide state");
  assert.deepEqual(harness.renderedStudyIds, [], "the unsaved case must never replace the visible slide viewer");
}

async function testLegacyCacheOnlySlideIsEmbeddedBeforeRendering() {
  const packageRecord = importedPackage();
  const harness = await createPowerPointHarness(legacyLocalConfig(), { legacyCacheOnly: true, cachedPackage: packageRecord });
  await finishBoot(harness);

  assert.deepEqual(harness.cacheLoadedStudyIds, ["local-study-x"]);
  assert.equal(harness.embeddedPackages.size, 1, "an old cache-only slide must be upgraded in place");
  assert.equal(harness.settings.stored[packageReferenceKey].studyId, "local-study-x");
  assert.deepEqual(harness.renderedStudyIds, ["local-study-x"]);
  assert.ok(
    harness.operationLog.findIndex(([name]) => name === "settings.save")
      < harness.operationLog.findIndex(([name]) => name === "viewer.render"),
    "legacy migration must become persistent before the viewer claims the case is available",
  );
}

async function testCorruptEmbeddedReferenceNeverFallsBackToIndexedDb() {
  const reference = packageReference();
  const harness = await createPowerPointHarness(localConfig(), {
    savedPackageReference: reference,
    cachedPackage: importedPackage(),
    async readPackage() {
      throw new Error("Embedded DICOM fragment 0 failed its digest check.");
    },
  });
  await finishBoot(harness);

  assert.deepEqual(harness.cacheLoadedStudyIds, [], "corruption in the authoritative presentation must remain visible");
  assert.deepEqual(harness.renderedStudyIds, []);
  assert.match(harness.elements.emptyStateMessage.textContent, /digest check/i);
}

async function testMalformedEmbeddedReferenceNeverFallsBackToIndexedDb() {
  const harness = await createPowerPointHarness(localConfig(), {
    savedPackageReference: "{not-json",
    cachedPackage: importedPackage(),
  });
  await finishBoot(harness);

  assert.deepEqual(harness.cacheLoadedStudyIds, [], "a malformed authoritative reference must not look legacy");
  assert.deepEqual(harness.renderedStudyIds, []);
  assert.match(harness.elements.emptyStateMessage.textContent, /reference.*invalid|invalid.*reference/i);
}

async function testEmbeddedStorageMarkerWithoutReferenceNeverFallsBackToIndexedDb() {
  const harness = await createPowerPointHarness({
    ...localConfig(),
    schemaVersion: 3,
    storageMode: "presentation-custom-xml",
  }, {
    savedPackageReference: null,
    cachedPackage: importedPackage(),
  });
  await finishBoot(harness);

  assert.deepEqual(harness.cacheLoadedStudyIds, [], "a new embedded slide with a missing reference must not look legacy");
  assert.deepEqual(harness.renderedStudyIds, []);
  assert.match(harness.elements.emptyStateMessage.textContent, /reference.*missing|missing.*reference/i);
}

async function testSchemaThreeWithoutMarkerOrReferenceNeverFallsBackToIndexedDb() {
  const config = localConfig();
  delete config.storageMode;
  const harness = await createPowerPointHarness(config, {
    savedPackageReference: null,
    cachedPackage: importedPackage(),
  });
  await finishBoot(harness);

  assert.deepEqual(harness.cacheLoadedStudyIds, [], "schema 3 alone must disable the legacy cache fallback");
  assert.deepEqual(harness.renderedStudyIds, []);
  assert.match(harness.elements.emptyStateMessage.textContent, /reference.*missing|missing.*reference/i);
}

async function testRemovingLocalStudyDeletesPresentationAndCacheCopies() {
  const reference = packageReference();
  const harness = await createPowerPointHarness(localConfig(), {
    savedPackageReference: reference,
    embeddedPackage: importedPackage(),
  });
  await finishBoot(harness);

  harness.elements.removeLocalSourceButton.click();
  await flush();
  await flush();

  assert.deepEqual(harness.packageReferencesDeleted.map((entry) => entry.studyId), ["local-study-x"]);
  assert.deepEqual(harness.cacheDeletedStudyIds, ["local-study-x"]);
  assert.equal(harness.embeddedPackages.size, 0);
  assert.equal(harness.settings.stored[packageReferenceKey], undefined);
  assert.equal(harness.settings.stored[settingsKey].sourceType, "empty");
}

async function testApplyingRemoteSourceRemovesHiddenEmbeddedStudy() {
  const reference = packageReference();
  const harness = await createPowerPointHarness(localConfig(), {
    savedPackageReference: reference,
    embeddedPackage: importedPackage(),
    trustedStudyOrigins: ["https://remote.example"],
  });
  await finishBoot(harness);

  harness.elements.useRemoteSourceButton.click();
  harness.elements.studyId.value = "remote-study";
  harness.elements.studyUrl.value = "https://remote.example/study.js";
  harness.elements.settingsForm.dispatchEvent({ type: "submit" });
  await flush();
  await flush();
  await flush();

  assert.deepEqual(harness.packageReferencesDeleted.map((entry) => entry.studyId), ["local-study-x"]);
  assert.deepEqual(harness.cacheDeletedStudyIds, ["local-study-x"]);
  assert.equal(harness.embeddedPackages.size, 0, "a discarded local case must not remain hidden in the PPTX");
  assert.equal(harness.settings.stored[packageReferenceKey], undefined);
}

async function testRemoteSettingsFailureKeepsTheEmbeddedLocalStudy() {
  const reference = packageReference();
  const harness = await createPowerPointHarness(localConfig(), {
    savedPackageReference: reference,
    embeddedPackage: importedPackage(),
    trustedStudyOrigins: ["https://remote.example"],
    settingsSaveFails: true,
  });
  await finishBoot(harness);

  harness.elements.useRemoteSourceButton.click();
  harness.elements.studyId.value = "remote-study";
  harness.elements.studyUrl.value = "https://remote.example/study.js";
  harness.elements.settingsForm.dispatchEvent({ type: "submit" });
  await flush();
  await flush();
  await flush();

  assert.equal(harness.embeddedPackages.size, 1, "failed remote settings must not delete the authoritative package");
  assert.deepEqual(harness.packageReferencesDeleted, []);
  assert.equal(harness.settings.persisted[settingsKey].sourceType, "local");
  assert.equal(harness.settings.persisted[packageReferenceKey].namespaceUri, reference.namespaceUri);
  assert.equal(harness.api.getState().sourceType, "local", "the visible runtime must roll back to the local case");
}

async function testRemovalSettingsFailureKeepsTheEmbeddedLocalStudy() {
  const reference = packageReference();
  const harness = await createPowerPointHarness(localConfig(), {
    savedPackageReference: reference,
    embeddedPackage: importedPackage(),
    settingsSaveFails: true,
  });
  await finishBoot(harness);

  harness.elements.removeLocalSourceButton.click();
  await flush();
  await flush();
  await flush();

  assert.equal(harness.embeddedPackages.size, 1, "failed empty-state settings must preserve the authoritative package");
  assert.deepEqual(harness.packageReferencesDeleted, []);
  assert.equal(harness.settings.persisted[settingsKey].sourceType, "local");
  assert.equal(harness.settings.persisted[packageReferenceKey].namespaceUri, reference.namespaceUri);
  assert.equal(harness.api.getState().sourceType, "local");
}

async function testFailedCleanupRemainsPersistedForRetry() {
  const reference = packageReference();
  const harness = await createPowerPointHarness(localConfig(), {
    savedPackageReference: reference,
    embeddedPackage: importedPackage(),
    trustedStudyOrigins: ["https://remote.example"],
    deleteEmbeddedPackage() {
      throw new Error("PowerPoint package deletion failed.");
    },
  });
  await finishBoot(harness);

  harness.elements.useRemoteSourceButton.click();
  harness.elements.studyId.value = "remote-study";
  harness.elements.studyUrl.value = "https://remote.example/study.js";
  harness.elements.settingsForm.dispatchEvent({ type: "submit" });
  await flush();
  await flush();
  await flush();

  assert.equal(harness.settings.persisted[settingsKey].sourceType, "remote");
  assert.equal(harness.settings.persisted[packageReferenceKey], undefined);
  assert.deepEqual(
    harness.settings.persisted[packageCleanupKey].map((entry) => entry.namespaceUri),
    [reference.namespaceUri],
    "an undeleted package must retain a persistent cleanup reference instead of becoming undiscoverable",
  );
  assert.match(harness.elements.loadingText.textContent, /could not remove.*embedded DICOM package/i);
  assert.equal(harness.elements.statusText.textContent, "Embedded DICOM package removal is pending.");
}

async function testPersistedCleanupJournalRetriesOnNextOpen() {
  const retiredReference = packageReference("retired-study");
  const harness = await createPowerPointHarness({
    schemaVersion: 3,
    sourceType: "remote",
    catalogId: "template-study",
    studyId: "template-study",
    studyUrl: "https://example.test/template-study/study.js",
  }, {
    savedPackageReference: null,
    savedPackageCleanup: [retiredReference],
  });
  await finishBoot(harness);

  assert.deepEqual(harness.packageReferencesDeleted.map((entry) => entry.namespaceUri), [retiredReference.namespaceUri]);
  assert.equal(harness.embeddedPackages.size, 0);
  assert.equal(harness.settings.persisted[packageCleanupKey], undefined, "successful retry must clear the journal");
}

async function testPersistedCleanupFailureIsVisibleOnNextOpen() {
  const retiredReference = packageReference("retired-study");
  const harness = await createPowerPointHarness({
    schemaVersion: 3,
    sourceType: "remote",
    catalogId: "template-study",
    studyId: "template-study",
    studyUrl: "https://example.test/template-study/study.js",
  }, {
    savedPackageReference: null,
    savedPackageCleanup: [retiredReference],
    deleteEmbeddedPackage() {
      throw new Error("PowerPoint package deletion failed.");
    },
  });
  await finishBoot(harness);

  assert.match(harness.elements.loadingText.textContent, /could not remove.*embedded DICOM package/i);
  assert.equal(harness.elements.loadingPanel.hidden, false);
  assert.equal(harness.settings.persisted[packageCleanupKey][0].namespaceUri, retiredReference.namespaceUri);
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

async function testCustomHttpsRequiresRecipientLocalTrust() {
  let confirmationCount = 0;
  const harness = await createPowerPointHarness(null, {
    confirm() {
      confirmationCount += 1;
      return false;
    },
  });
  await finishBoot(harness);
  const custom = {
    sourceType: "remote",
    catalogId: "custom",
    studyId: "outside-study",
    studyUrl: "https://untrusted.example/study.js",
  };

  assert.throws(
    () => harness.api.validateStudySource(custom),
    /not trusted|not approved/i,
    "HTTPS alone must not authorize executable study data",
  );
  assert.equal(confirmationCount, 1, "an untrusted origin must require an explicit local decision");
}

async function testApprovedCustomOriginIsRememberedOnThisDevice() {
  let confirmationCount = 0;
  const harness = await createPowerPointHarness(null, {
    confirm() {
      confirmationCount += 1;
      return true;
    },
  });
  await finishBoot(harness);
  const custom = {
    sourceType: "remote",
    catalogId: "custom",
    studyId: "approved-study",
    studyUrl: "https://approved.example/cases/study.js",
  };

  assert.equal(harness.api.validateStudySource(custom), custom.studyUrl);
  assert.equal(harness.api.validateStudySource(custom), custom.studyUrl);
  assert.equal(confirmationCount, 1, "the same approved origin must not prompt twice");
}

async function testCatalogAndManagedOriginsDoNotPrompt() {
  let confirmationCount = 0;
  const harness = await createPowerPointHarness(null, {
    confirm() {
      confirmationCount += 1;
      return false;
    },
    trustedStudyOrigins: ["https://managed.example"],
  });
  await finishBoot(harness);

  assert.equal(harness.api.validateStudySource({
    sourceType: "catalog",
    catalogId: "template-study",
    studyId: "template-study",
    studyUrl: "https://example.test/template-study/study.js",
  }), "https://example.test/template-study/study.js");
  assert.equal(harness.api.validateStudySource({
    sourceType: "remote",
    catalogId: "custom",
    studyId: "managed-study",
    studyUrl: "https://managed.example/cases/study.js",
  }), "https://managed.example/cases/study.js");
  assert.equal(confirmationCount, 0, "catalog and managed origins must not require recipient approval");
}

async function testReplacedViewerCannotMutateCurrentUi() {
  const config = localConfig();
  const harness = await createPowerPointHarness(config);
  await finishBoot(harness);
  const replacedViewer = harness.elements.viewerMount.children[0];
  await harness.api.renderViewer(config, { persist: false });
  const currentViewer = harness.elements.viewerMount.children[0];
  assert.notEqual(currentViewer, replacedViewer);

  harness.elements.statusText.textContent = "Current viewer ready.";
  harness.elements.loadingPanel.hidden = true;
  const actionCount = harness.viewerActions.length;
  const timeoutCount = harness.pendingTimeoutCount();
  replacedViewer.dispatchEvent({ type: "dicom-state-change", detail: { activeTool: "zoom" } });
  replacedViewer.dispatchEvent({ type: "dicom-volume-progress", detail: { progress: 0.5 } });
  replacedViewer.dispatchEvent({ type: "dicom-error", detail: { message: "stale failure" } });
  replacedViewer.dispatchEvent({ type: "dicom-expand-request", detail: { expanded: true } });
  await flush();

  assert.equal(harness.elements.statusText.textContent, "Current viewer ready.");
  assert.equal(harness.elements.loadingPanel.hidden, true);
  assert.equal(harness.viewerActions.length, actionCount, "a stale expand event must not target the current viewer");
  assert.equal(harness.pendingTimeoutCount(), timeoutCount, "stale state events must not schedule a save");
}

async function testOnlyCurrentImportCanUpdateOrUnlockTheUi() {
  const imports = [];
  const harness = await createPowerPointHarness(null, {
    importFiles(_files, importOptions) {
      const operation = deferred();
      imports.push({ operation, options: importOptions });
      return operation.promise;
    },
  });
  await finishBoot(harness);

  const first = harness.api.importLocalFiles([{ name: "first.dcm" }]);
  await flush();
  const second = harness.api.importLocalFiles([{ name: "second.dcm" }]);
  await flush();
  imports[1].options.onProgress({ phase: "scan", progress: 0.2, message: "Second import" });
  imports[0].options.onProgress({ phase: "scan", progress: 0.8, message: "Stale import" });
  imports[0].operation.reject(new DOMException("Import canceled.", "AbortError"));
  await first;

  assert.equal(harness.elements.statusText.textContent, "Second import");
  assert.equal(harness.elements.importFilesButton.disabled, true, "the active import must remain locked");
  assert.equal(harness.elements.cancelImportButton.hidden, false, "the active import must remain cancelable");

  imports[1].operation.resolve(importedStudyResult());
  await second;
  assert.equal(harness.elements.importFilesButton.disabled, false);
  assert.equal(harness.elements.cancelImportButton.hidden, true);
}

async function testCustomSelectionRestoresLocalConfigUntilItIsDiscarded() {
  const harness = await createPowerPointHarness(localConfig());
  await finishBoot(harness);
  const viewer = harness.elements.viewerMount.children[0];
  viewer.state.seriesId = "series-2";
  viewer.state.seriesNumber = "2";
  viewer.dispatchEvent({ type: "dicom-state-change", detail: viewer.getState() });

  harness.elements.catalogId.value = "template-study";
  harness.elements.catalogId.dispatchEvent({ type: "change" });
  harness.elements.catalogId.value = "custom";
  harness.elements.catalogId.dispatchEvent({ type: "change" });
  assert.equal(harness.elements.studyId.value, "local-study-x");
  assert.equal(harness.elements.series.value, "series-2", "custom must restore the latest local viewer state");
  assert.equal(harness.elements.localSource.hidden, false, "custom must restore the active local study");

  harness.elements.useRemoteSourceButton.click();
  harness.elements.catalogId.value = "template-study";
  harness.elements.catalogId.dispatchEvent({ type: "change" });
  harness.elements.catalogId.value = "custom";
  harness.elements.catalogId.dispatchEvent({ type: "change" });
  assert.equal(harness.elements.studyId.value, "");
  assert.equal(harness.elements.customSource.hidden, false, "explicitly choosing HTTPS must discard the local fallback");
}

(async () => {
  const tests = {
    empty: testNewSlideStartsEmpty,
    restore: testSavedLocalStudyRestoresFromThePresentationWithoutIndexedDb,
    runtime_ready: testViewerWaitsForTheRuntimeModules,
    save: testImportEmbedsPackageBeforeSlideSettingsSave,
    embed_failure: testEmbeddingFailureDoesNotSaveLocalSlideState,
    settings_failure: testSettingsFailureRollsBackNewEmbeddedGeneration,
    legacy_migration: testLegacyCacheOnlySlideIsEmbeddedBeforeRendering,
    corrupt_embedded: testCorruptEmbeddedReferenceNeverFallsBackToIndexedDb,
    malformed_embedded: testMalformedEmbeddedReferenceNeverFallsBackToIndexedDb,
    missing_embedded: testEmbeddedStorageMarkerWithoutReferenceNeverFallsBackToIndexedDb,
    schema3_missing_embedded: testSchemaThreeWithoutMarkerOrReferenceNeverFallsBackToIndexedDb,
    remove_embedded: testRemovingLocalStudyDeletesPresentationAndCacheCopies,
    remote_removes_embedded: testApplyingRemoteSourceRemovesHiddenEmbeddedStudy,
    remote_settings_rollback: testRemoteSettingsFailureKeepsTheEmbeddedLocalStudy,
    removal_settings_rollback: testRemovalSettingsFailureKeepsTheEmbeddedLocalStudy,
    cleanup_retry: testFailedCleanupRemainsPersistedForRetry,
    cleanup_reopen: testPersistedCleanupJournalRetriesOnNextOpen,
    cleanup_reopen_failure: testPersistedCleanupFailureIsVisibleOnNextOpen,
    toolbar: testCompactToolbarControlsThePublicViewerApi,
    trust_reject: testCustomHttpsRequiresRecipientLocalTrust,
    trust_remember: testApprovedCustomOriginIsRememberedOnThisDevice,
    trust_managed: testCatalogAndManagedOriginsDoNotPrompt,
    stale_viewer: testReplacedViewerCannotMutateCurrentUi,
    stale_import: testOnlyCurrentImportCanUpdateOrUnlockTheUi,
    local_restore: testCustomSelectionRestoresLocalConfigUntilItIsDiscarded,
  };
  const selected = process.argv[2] ? { [process.argv[2]]: tests[process.argv[2]] } : tests;
  assert.ok(Object.values(selected).every((test) => typeof test === "function"), "unknown test name");
  for (const test of Object.values(selected)) await test();
  console.log("PowerPoint empty-state and persistence tests passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
