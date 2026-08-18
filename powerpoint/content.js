(function (global) {
  "use strict";

  const SETTINGS_KEY = "dicomSlides.powerPoint.config.v1";
  const PACKAGE_REFERENCE_KEY = "dicomSlides.powerPoint.packageRef.v1";
  const PACKAGE_CLEANUP_KEY = "dicomSlides.powerPoint.packageCleanup.v1";
  const LOCAL_STORAGE_KEY = "dicomSlides.powerPoint.preview.v1";
  const TRUSTED_ORIGINS_KEY = "dicomSlides.powerPoint.trustedStudyOrigins.v1";
  const SCHEMA_VERSION = 3;
  const PRESENTATION_STORAGE_MODE = "presentation-custom-xml";
  const VALID_MODES = new Set(["stack", "mpr", "volume"]);
  const VALID_PRESETS = new Set(["default", "abdomen", "lung", "bone", "brain"]);
  const VALID_TOOLS = new Set(["window", "pan", "zoom", "scroll"]);
  const catalog = Array.isArray(global.DicomSlidesPowerPoint?.studies)
    ? global.DicomSlidesPowerPoint.studies
    : [];

  const runtime = {
    elements: {},
    config: null,
    viewer: null,
    generation: 0,
    saveTimer: null,
    officeConnected: false,
    officeView: "edit",
    bootPromise: null,
    importAbortController: null,
    packageReference: null,
    pendingPackageCleanup: [],
    lastLocalConfig: null,
    approvedStudyOrigins: null,
    expansionController: null,
    expanded: false,
    suspendAutoSave: false,
    cleanupPending: false,
  };

  function byId(id) {
    return document.getElementById(id);
  }

  function asFiniteNumber(value, fallback = null) {
    if (value === "" || value == null) return fallback;
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function findCatalogItem(id) {
    return catalog.find((entry) => entry.id === id) || null;
  }

  function emptyConfig() {
    return {
      schemaVersion: SCHEMA_VERSION,
      sourceType: "empty",
      catalogId: "",
      studyId: "",
      studyUrl: "",
      series: "1",
      mode: "stack",
      preset: "default",
      slice: 0,
      tool: "window",
      center: null,
      width: null,
      storageMode: null,
    };
  }

  function defaultConfig(catalogId) {
    const entry = findCatalogItem(catalogId);
    if (!entry) return emptyConfig();
    return {
      schemaVersion: SCHEMA_VERSION,
      sourceType: "catalog",
      catalogId: entry.id,
      studyId: entry.studyId,
      studyUrl: entry.studyUrl,
      series: String(entry.defaultSeries || "1"),
      mode: entry.defaultMode || "stack",
      preset: entry.defaultPreset || "default",
      slice: Number.isFinite(entry.defaultSlice) ? entry.defaultSlice : 0,
      tool: "window",
      center: null,
      width: null,
      storageMode: null,
    };
  }

  function normalizeConfig(input) {
    const candidate = input && typeof input === "object" ? input : {};
    if (candidate.sourceType === "empty") return emptyConfig();
    const requestedCatalog = findCatalogItem(candidate.catalogId);
    const base = requestedCatalog ? defaultConfig(requestedCatalog.id) : emptyConfig();
    const localByUrl = Boolean(global.DicomSlidesImporter?.isLocalStudyUrl(candidate.studyUrl));
    const sourceType = candidate.sourceType === "local" || localByUrl
      ? "local"
      : requestedCatalog ? "catalog" : "remote";
    const catalogId = sourceType === "catalog" && requestedCatalog ? requestedCatalog.id : "custom";

    const result = {
      schemaVersion: SCHEMA_VERSION,
      sourceType,
      catalogId,
      studyId: String(candidate.studyId ?? base.studyId).trim(),
      studyUrl: String(candidate.studyUrl ?? base.studyUrl).trim(),
      series: String(candidate.series ?? base.series).trim() || "1",
      mode: VALID_MODES.has(candidate.mode) ? candidate.mode : base.mode,
      preset: VALID_PRESETS.has(candidate.preset) ? candidate.preset : base.preset,
      slice: Math.max(0, Math.round(asFiniteNumber(candidate.slice, base.slice) || 0)),
      tool: VALID_TOOLS.has(candidate.tool) ? candidate.tool : "window",
      center: asFiniteNumber(candidate.center),
      width: asFiniteNumber(candidate.width),
      storageMode: sourceType === "local" && candidate.storageMode === PRESENTATION_STORAGE_MODE
        ? PRESENTATION_STORAGE_MODE
        : null,
      legacyCacheOnly: sourceType === "local"
        && candidate.storageMode !== PRESENTATION_STORAGE_MODE
        && (candidate.legacyCacheOnly === true || Number(candidate.schemaVersion || 0) < SCHEMA_VERSION),
    };

    if (result.width != null) result.width = Math.max(1, result.width);
    return result;
  }

  function normalizedOrigin(value) {
    try {
      const origin = new URL(String(value), global.location.href).origin;
      return origin === "null" ? null : origin;
    } catch (_) {
      return null;
    }
  }

  function approvedStudyOrigins() {
    if (runtime.approvedStudyOrigins) return runtime.approvedStudyOrigins;
    let stored = [];
    try {
      const parsed = JSON.parse(global.localStorage.getItem(TRUSTED_ORIGINS_KEY) || "[]");
      if (Array.isArray(parsed)) stored = parsed;
    } catch (_) {
      // Recipient-local approval remains available for this session when storage is unavailable.
    }
    runtime.approvedStudyOrigins = new Set(stored.map(normalizedOrigin).filter(Boolean));
    return runtime.approvedStudyOrigins;
  }

  function rememberApprovedStudyOrigin(origin) {
    const approved = approvedStudyOrigins();
    approved.add(origin);
    try {
      global.localStorage.setItem(TRUSTED_ORIGINS_KEY, JSON.stringify(Array.from(approved).sort()));
    } catch (_) {
      // Keep the approval in memory for this session when local storage is unavailable.
    }
  }

  function isCatalogStudySource(config, resolved) {
    if (config.sourceType !== "catalog") return false;
    const entry = findCatalogItem(config.catalogId);
    if (!entry || entry.studyId !== config.studyId) return false;
    try {
      return new URL(entry.studyUrl, global.location.href).href === resolved.href;
    } catch (_) {
      return false;
    }
  }

  function isManagedStudyOrigin(origin) {
    const managed = Array.isArray(global.DicomSlidesPowerPoint?.trustedStudyOrigins)
      ? global.DicomSlidesPowerPoint.trustedStudyOrigins
      : [];
    return managed.map(normalizedOrigin).filter(Boolean).includes(origin);
  }

  function validateStudySource(config) {
    if (!config.studyId) throw new Error("Enter the study ID.");
    if (!config.studyUrl) throw new Error("Enter the study.js URL.");

    let resolved;
    try {
      resolved = new URL(config.studyUrl, global.location.href);
    } catch (_) {
      throw new Error("The study.js URL is invalid.");
    }

    if (resolved.protocol === "dicom-slides-local:") {
      if (config.sourceType !== "local" || !global.DicomSlidesImporter) {
        throw new Error("The local study reference is invalid.");
      }
      const urlStudyId = global.DicomSlidesImporter.studyIdFromLocalUrl(resolved.href);
      if (urlStudyId && urlStudyId !== config.studyId.toLowerCase()) {
        throw new Error("The study ID does not match the local package.");
      }
      return resolved.href;
    }

    const localHosts = ["localhost", "127.0.0.1", "[::1]"];
    const isLocalDevelopment = localHosts.includes(resolved.hostname);
    const pageUrl = new URL(global.location.href);
    const isLocalPage = pageUrl.protocol === "file:" || localHosts.includes(pageUrl.hostname);
    if ((resolved.protocol === "http:" && isLocalDevelopment && isLocalPage)
        || (resolved.protocol === "file:" && pageUrl.protocol === "file:")) {
      return resolved.href;
    }
    if (resolved.protocol !== "https:") {
      throw new Error("The study package must use HTTPS. HTTP is allowed only on localhost.");
    }

    if (isCatalogStudySource(config, resolved)) return resolved.href;
    const origin = resolved.origin;
    if (isManagedStudyOrigin(origin) || approvedStudyOrigins().has(origin)) return resolved.href;
    const approved = typeof global.confirm === "function" && global.confirm(
      `This slide wants to load executable study data from ${origin}. Allow this origin on this device?`,
    );
    if (!approved) throw new Error(`The study origin ${origin} is not trusted or approved on this device.`);
    rememberApprovedStudyOrigin(origin);
    return resolved.href;
  }

  function setLoading(message, isError = false) {
    runtime.elements.loadingText.textContent = message;
    runtime.elements.loadingPanel.hidden = false;
    document.body.classList.toggle("error-state", isError);
  }

  function clearLoading() {
    runtime.elements.loadingPanel.hidden = true;
    document.body.classList.remove("error-state");
  }

  function setStatus(message) {
    runtime.elements.statusText.textContent = message;
  }

  function formatBytes(value) {
    const bytes = Number(value || 0);
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
  }

  function registeredStudy(studyId) {
    return global.__DICOM_SLIDE_STUDIES__?.[studyId] || null;
  }

  function toolButtons() {
    return [
      runtime.elements.toolWindowButton,
      runtime.elements.toolPanButton,
      runtime.elements.toolZoomButton,
      runtime.elements.toolScrollButton,
    ];
  }

  function modeButtons() {
    return [runtime.elements.mode2dButton, runtime.elements.modeMprButton, runtime.elements.mode3dButton];
  }

  function setViewerControlsEnabled(enabled, state = {}) {
    const active = Boolean(enabled);
    const stackMode = (state.mode || runtime.config?.mode || "stack") === "stack";
    toolButtons().forEach((button) => {
      button.disabled = !active || !stackMode || (button.dataset.tool === "window" && Boolean(state.isColor));
    });
    runtime.elements.windowPresetSelect.disabled = !active || Boolean(state.isColor);
    runtime.elements.seriesSelect.disabled = !active || runtime.elements.seriesSelect.children.length === 0;
    runtime.elements.mode2dButton.disabled = !active;
    runtime.elements.modeMprButton.disabled = !active || state.volumeSupported !== true;
    runtime.elements.mode3dButton.disabled = !active || state.volumeSupported !== true;
    runtime.elements.resetViewButton.disabled = !active;
    runtime.elements.expandViewButton.disabled = !active && !runtime.expanded;
  }

  function updateSeriesSelect(state) {
    const entries = Array.isArray(state.seriesOptions) ? state.seriesOptions : [];
    const signature = entries.map((entry) => `${entry.id}:${entry.number}:${entry.title}:${entry.available}`).join("|");
    if (runtime.elements.seriesSelect.dataset.signature !== signature) {
      runtime.elements.seriesSelect.replaceChildren();
      entries.forEach((entry, index) => {
        const option = document.createElement("option");
        option.value = entry.id;
        option.textContent = `${entry.number || index + 1} · ${entry.title}`;
        option.disabled = entry.available === false;
        runtime.elements.seriesSelect.appendChild(option);
      });
      runtime.elements.seriesSelect.dataset.signature = signature;
    }
    if (entries.length) runtime.elements.seriesSelect.value = state.seriesId || runtime.config?.series || entries[0].id;
  }

  function updateToolbar(state = {}) {
    if (!runtime.elements.viewerToolbar) return;
    const loaded = Boolean(runtime.viewer);
    const activeTool = state.activeTool || runtime.config?.tool || "window";
    const activeMode = state.mode || runtime.config?.mode || "stack";
    updateSeriesSelect(state);
    toolButtons().forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.tool === activeTool));
    });
    modeButtons().forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.mode === activeMode));
    });
    runtime.elements.windowPresetSelect.value = runtime.config?.preset || "default";
    setViewerControlsEnabled(loaded, state);
  }

  function captureViewerState() {
    if (!runtime.viewer || typeof runtime.viewer.getState !== "function") return runtime.config;
    const state = runtime.viewer.getState() || {};
    runtime.config = normalizeConfig(Object.assign({}, runtime.config, {
      series: state.seriesId || state.seriesNumber || runtime.config.series,
      mode: VALID_MODES.has(state.mode) ? state.mode : runtime.config.mode,
      slice: Number.isFinite(state.slice) ? state.slice : runtime.config.slice,
      tool: VALID_TOOLS.has(state.activeTool) ? state.activeTool : runtime.config.tool,
      center: Number.isFinite(state.center) ? state.center : runtime.config.center,
      width: Number.isFinite(state.width) ? state.width : runtime.config.width,
    }));
    if (runtime.config.sourceType === "local") runtime.lastLocalConfig = normalizeConfig(runtime.config);
    updateToolbar(state);
    return runtime.config;
  }

  function serializeConfig() {
    const config = captureViewerState();
    return {
      schemaVersion: SCHEMA_VERSION,
      sourceType: config.sourceType,
      catalogId: config.catalogId,
      studyId: config.studyId,
      studyUrl: config.studyUrl,
      series: config.series,
      mode: config.mode,
      preset: config.preset,
      slice: config.slice,
      tool: config.tool,
      center: config.center,
      width: config.width,
      storageMode: config.storageMode,
    };
  }

  function saveLocalPreview(config) {
    try {
      global.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(config));
    } catch (_) {
      // Storage can be disabled in Office webviews; document settings remain authoritative.
    }
  }

  function loadLocalPreview() {
    try {
      const raw = global.localStorage.getItem(LOCAL_STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function hasOfficeRuntime() {
    return Boolean(global.Office && typeof global.Office.onReady === "function");
  }

  function setOfficeSetting(settings, key, value, removeWhenEmpty = false) {
    const empty = value == null || (removeWhenEmpty && Array.isArray(value) && value.length === 0);
    if (!empty) settings.set(key, value);
    else if (typeof settings.remove === "function") settings.remove(key);
    else settings.set(key, null);
  }

  function saveNow(options = {}) {
    const config = options.config ? normalizeConfig(options.config) : serializeConfig();
    const packageReference = Object.prototype.hasOwnProperty.call(options, "packageReference")
      ? options.packageReference
      : runtime.packageReference;
    const pendingPackageCleanup = Object.prototype.hasOwnProperty.call(options, "pendingPackageCleanup")
      ? options.pendingPackageCleanup
      : runtime.pendingPackageCleanup;
    if (!runtime.officeConnected || !global.Office?.context?.document?.settings) {
      if (!hasOfficeRuntime()) saveLocalPreview(config);
      return Promise.resolve(!hasOfficeRuntime());
    }

    return new Promise((resolve) => {
      let settings = null;
      let previous = null;
      try {
        settings = global.Office.context.document.settings;
        previous = new Map([
          [SETTINGS_KEY, settings.get(SETTINGS_KEY)],
          [PACKAGE_REFERENCE_KEY, settings.get(PACKAGE_REFERENCE_KEY)],
          [PACKAGE_CLEANUP_KEY, settings.get(PACKAGE_CLEANUP_KEY)],
        ]);
        settings.set(SETTINGS_KEY, config);
        setOfficeSetting(settings, PACKAGE_REFERENCE_KEY, packageReference);
        setOfficeSetting(settings, PACKAGE_CLEANUP_KEY, pendingPackageCleanup, true);
        settings.saveAsync((result) => {
          if (result.status === global.Office.AsyncResultStatus.Failed) {
            previous.forEach((value, key) => setOfficeSetting(settings, key, value));
            setStatus(`Could not save the slide state: ${result.error.message}`);
            resolve(false);
          } else {
            if (options.announce !== false) {
              setStatus(config.sourceType === "local"
                ? "Study and viewer state saved in this presentation."
                : "State saved to the slide.");
            }
            resolve(true);
          }
        });
      } catch (error) {
        previous?.forEach((value, key) => setOfficeSetting(settings, key, value));
        setStatus(`Could not save the slide state: ${error.message}`);
        resolve(false);
      }
    });
  }

  function scheduleSave() {
    if (runtime.suspendAutoSave) return;
    global.clearTimeout(runtime.saveTimer);
    runtime.saveTimer = global.setTimeout(() => { saveNow(); }, 250);
  }

  function loadOfficeConfig() {
    try {
      const settings = global.Office?.context?.document?.settings;
      if (!settings) return null;
      const value = settings.get(SETTINGS_KEY);
      if (typeof value === "string") return JSON.parse(value);
      return value && typeof value === "object" ? value : null;
    } catch (_) {
      return null;
    }
  }

  function loadOfficePackageReference() {
    const settings = global.Office?.context?.document?.settings;
    if (!settings) return null;
    const stored = settings.get(PACKAGE_REFERENCE_KEY);
    if (stored == null || stored === "") return null;
    let value;
    try {
      value = typeof stored === "string" ? JSON.parse(stored) : stored;
    } catch (_) {
      throw new Error("The embedded DICOM package reference is invalid.");
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("The embedded DICOM package reference is invalid.");
    }
    return value;
  }

  function loadOfficeCleanupReferences() {
    const settings = global.Office?.context?.document?.settings;
    if (!settings) return [];
    const stored = settings.get(PACKAGE_CLEANUP_KEY);
    if (stored == null || stored === "") return [];
    let value;
    try {
      value = typeof stored === "string" ? JSON.parse(stored) : stored;
    } catch (_) {
      throw new Error("The embedded DICOM cleanup journal is invalid.");
    }
    if (!Array.isArray(value) || value.some((entry) => !entry || typeof entry !== "object" || Array.isArray(entry))) {
      throw new Error("The embedded DICOM cleanup journal is invalid.");
    }
    return value;
  }

  function setSettingsOpen(open) {
    const isOpen = Boolean(open) && runtime.officeView !== "read";
    runtime.elements.settingsPanel.hidden = !isOpen;
    runtime.elements.importButton.setAttribute("aria-expanded", String(isOpen));
    if (isOpen) runtime.elements.catalogId.focus({ preventScroll: true });
  }

  function showEmptyState(options = {}) {
    const config = normalizeConfig(options.config || emptyConfig());
    runtime.generation += 1;
    runtime.config = config;
    runtime.viewer = null;
    runtime.elements.viewerMount.replaceChildren();
    runtime.elements.emptyState.hidden = false;
    runtime.elements.emptyStateTitle.textContent = options.title || "No study loaded";
    runtime.elements.emptyStateMessage.textContent = options.message || "Import DICOM files, a folder, or a ZIP archive to begin.";
    runtime.elements.seriesSelect.replaceChildren();
    runtime.elements.seriesSelect.dataset.signature = "";
    updateToolbar({ mode: "stack", activeTool: "window", seriesOptions: [] });
    clearLoading();
    syncForm(config);
    setSettingsOpen(options.openSettings !== false);
    setStatus(options.status || "Ready to import a DICOM study.");
    if (options.persist) scheduleSave();
  }

  function updateLocalSourceSummary(config) {
    const study = registeredStudy(config.studyId);
    if (!study) {
      runtime.elements.localSourceSummary.textContent = `${config.studyId}. The package will be restored from this presentation.`;
      return;
    }
    const images = Array.isArray(study.series) ? study.series.reduce((sum, item) => sum + Number(item.slices || 0), 0) : 0;
    runtime.elements.localSourceSummary.textContent = `${study.title || config.studyId} · ${study.seriesCount || study.series?.length || 0} series · ${images} images`;
  }

  function syncSourceVisibility(config = runtime.config) {
    const customOption = runtime.elements.catalogId.querySelector('option[value="custom"]');
    const isCustom = runtime.elements.catalogId.value === "custom";
    const isLocal = isCustom && config?.sourceType === "local";
    const isRemote = isCustom && config?.sourceType === "remote";
    runtime.elements.customSource.hidden = !isRemote;
    runtime.elements.localSource.hidden = !isLocal;
    runtime.elements.studyId.required = isRemote;
    runtime.elements.studyUrl.required = isRemote;
    runtime.elements.studyId.disabled = !isRemote;
    runtime.elements.studyUrl.disabled = !isRemote;
    if (customOption) customOption.textContent = isLocal ? "Study stored in this presentation" : "Custom package (HTTPS)";
    if (isLocal) updateLocalSourceSummary(config);
  }

  function syncForm(config) {
    if (config.sourceType === "local") runtime.lastLocalConfig = normalizeConfig(config);
    const entry = findCatalogItem(config.catalogId);
    runtime.elements.catalogId.value = entry ? entry.id : config.sourceType === "empty" ? "" : "custom";
    runtime.elements.studyId.value = config.studyId;
    runtime.elements.studyUrl.value = config.studyUrl;
    runtime.elements.series.value = config.series;
    runtime.elements.slice.value = String(config.slice);
    runtime.elements.mode.value = config.mode;
    runtime.elements.preset.value = config.preset;
    runtime.elements.tool.value = config.tool;
    syncSourceVisibility(config);
  }

  function remoteCustomConfig() {
    return normalizeConfig({
      schemaVersion: SCHEMA_VERSION,
      sourceType: "remote",
      catalogId: "custom",
      studyId: "",
      studyUrl: "",
      series: "1",
      slice: 0,
      mode: runtime.config?.mode || "stack",
      preset: runtime.config?.preset || "default",
      tool: runtime.config?.tool || "window",
      center: null,
      width: null,
    });
  }

  function applyCatalogDefaults(catalogId) {
    if (!catalogId) {
      runtime.config = emptyConfig();
      syncForm(runtime.config);
      return;
    }
    if (catalogId === "custom") {
      runtime.config = runtime.lastLocalConfig
        ? normalizeConfig(runtime.lastLocalConfig)
        : remoteCustomConfig();
      syncForm(runtime.config);
      return;
    }
    runtime.config = normalizeConfig(defaultConfig(catalogId));
    syncForm(runtime.config);
  }

  function readFormConfig() {
    const catalogId = runtime.elements.catalogId.value;
    const entry = findCatalogItem(catalogId);
    const current = runtime.config || emptyConfig();
    const keepLocal = !entry && current.sourceType === "local" && runtime.elements.localSource.hidden === false;
    return normalizeConfig({
      sourceType: entry ? "catalog" : keepLocal ? "local" : "remote",
      catalogId: entry ? entry.id : "custom",
      studyId: entry ? entry.studyId : keepLocal ? current.studyId : runtime.elements.studyId.value,
      studyUrl: entry ? entry.studyUrl : keepLocal ? current.studyUrl : runtime.elements.studyUrl.value,
      series: runtime.elements.series.value,
      slice: runtime.elements.slice.value,
      mode: runtime.elements.mode.value,
      preset: runtime.elements.preset.value,
      tool: runtime.elements.tool.value,
      center: null,
      width: null,
    });
  }

  function bindViewerEvents(viewer) {
    const stateEvents = [
      "dicom-ready",
      "dicom-series-change",
      "dicom-state-change",
      "dicom-mode-change",
    ];
    stateEvents.forEach((eventName) => {
      viewer.addEventListener(eventName, (event) => {
        if (viewer !== runtime.viewer) return;
        updateToolbar(event.detail || viewer.getState?.() || {});
        captureViewerState();
        scheduleSave();
      });
    });
    viewer.addEventListener("dicom-volume-progress", (event) => {
      if (viewer !== runtime.viewer) return;
      const detail = event.detail || {};
      if (Number.isFinite(detail.progress)) {
        setStatus(`Preparing volume: ${Math.round(detail.progress * 100)}%`);
      }
    });
    viewer.addEventListener("dicom-error", (event) => {
      if (viewer !== runtime.viewer) return;
      const message = event.detail?.message || "Viewer failure.";
      setLoading(message, true);
      setStatus("Error loading the study.");
    });
    viewer.addEventListener("dicom-expand-request", (event) => {
      if (viewer !== runtime.viewer) return;
      setExpanded(Boolean(event.detail?.expanded));
    });
  }

  async function renderViewer(config, options = {}) {
    const normalized = normalizeConfig(config);
    if (normalized.sourceType === "empty") {
      showEmptyState({ config: normalized, openSettings: options.openSettings, persist: options.persist });
      return null;
    }
    const studyUrl = validateStudySource(normalized);
    const generation = ++runtime.generation;
    runtime.config = normalized;
    runtime.elements.emptyState.hidden = true;
    syncForm(normalized);
    updateToolbar({ mode: normalized.mode, activeTool: normalized.tool, seriesOptions: [] });
    setLoading(normalized.sourceType === "local"
      ? runtime.officeConnected ? "Restoring the study from this presentation…" : "Restoring the converted study from the local cache…"
      : "Loading study and pixels…");
    setStatus("Loading slide content…");

    try {
      if (normalized.sourceType === "local") {
        if (!global.DicomSlidesImporter) throw new Error("The local DICOM importer did not load.");
        await global.DicomSlidesImporter.ensureRegistered(normalized.studyId);
        if (generation !== runtime.generation) return;
      }

      const viewer = document.createElement("dicom-study-viewer");
      viewer.setAttribute("study-id", normalized.studyId);
      viewer.setAttribute("src", studyUrl);
      viewer.setAttribute("series", normalized.series);
      viewer.setAttribute("mode", normalized.mode);
      viewer.setAttribute("preset", normalized.preset);
      viewer.setAttribute("slice", String(normalized.slice));
      viewer.setAttribute("tool", normalized.tool);
      viewer.setAttribute("controls", "external");
      viewer.setAttribute("aria-label", `Viewer for study ${normalized.studyId}`);
      bindViewerEvents(viewer);

      runtime.viewer = viewer;
      runtime.elements.viewerMount.replaceChildren(viewer);
      await viewer.ready;
      if (generation !== runtime.generation || runtime.viewer !== viewer) return;
      if (runtime.expanded) await viewer.setExpanded(true);
      if (normalized.center != null && normalized.width != null) {
        await viewer.setWindow(normalized.center, normalized.width);
      }
      captureViewerState();
      updateToolbar(viewer.getState?.() || {});
      clearLoading();
      if (normalized.sourceType === "local") {
        setStatus(runtime.officeConnected
          ? "Viewer ready; the interactive study is stored in this presentation."
          : "Viewer ready; pixels are in this browser's local cache.");
      } else {
        setStatus(runtime.officeConnected ? "Viewer ready; state saved to the slide." : "Browser preview; open in PowerPoint to save state to the slide.");
      }
      if (options.persist !== false) scheduleSave();
      return viewer;
    } catch (error) {
      if (generation !== runtime.generation) return null;
      setLoading(error.message || String(error), true);
      setStatus("Error loading the study.");
      throw error;
    }
  }

  function populateCatalog() {
    const select = runtime.elements.catalogId;
    select.replaceChildren();
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = "Choose a study…";
    select.appendChild(empty);
    catalog.forEach((entry) => {
      const option = document.createElement("option");
      option.value = entry.id;
      option.textContent = entry.label;
      select.appendChild(option);
    });
    const custom = document.createElement("option");
    custom.value = "custom";
    custom.textContent = "Custom package (HTTPS)";
    select.appendChild(custom);
  }

  function applyOfficeView(value) {
    const raw = String(value || "").toLowerCase();
    const readConstant = global.Office?.ActiveView?.Read;
    runtime.officeView = value === readConstant || raw === "read" ? "read" : "edit";
    document.body.dataset.officeView = runtime.officeView;
    if (runtime.officeView === "read") setSettingsOpen(false);
  }

  function getActiveView() {
    return new Promise((resolve) => {
      const documentApi = global.Office?.context?.document;
      if (!documentApi || typeof documentApi.getActiveViewAsync !== "function") {
        resolve("edit");
        return;
      }
      documentApi.getActiveViewAsync((result) => {
        if (result.status === global.Office.AsyncResultStatus.Succeeded) resolve(result.value);
        else resolve("edit");
      });
    });
  }

  function registerActiveViewChanged() {
    const documentApi = global.Office?.context?.document;
    if (!documentApi || typeof documentApi.addHandlerAsync !== "function") return;
    documentApi.addHandlerAsync(
      global.Office.EventType.ActiveViewChanged,
      (eventArgs) => applyOfficeView(eventArgs.activeView),
      (result) => {
        if (result.status === global.Office.AsyncResultStatus.Failed) {
          setStatus(`Could not monitor the active view: ${result.error.message}`);
        }
      }
    );
  }

  function requirePresentationStorage() {
    const storage = global.DicomSlidesPresentationStorage;
    if (!storage?.isSupported?.()) {
      throw new Error("Embedding DICOM studies requires PowerPointApi 1.7 or later.");
    }
    return storage;
  }

  function reportPresentationRestore(detail) {
    const message = detail?.message || "Restoring study from presentation…";
    setLoading(message);
    setStatus(message);
  }

  async function cacheAndRegisterPackage(packageRecord) {
    await global.DicomSlidesImporter.registerPackage(packageRecord);
    await global.DicomSlidesImporter.storePackage(packageRecord).catch(() => false);
    return packageRecord;
  }

  function referenceIdentity(reference) {
    return String(reference?.namespaceUri || "");
  }

  function withPendingCleanup(references, ...additions) {
    const unique = new Map();
    [...(references || []), ...additions.flat()].forEach((reference) => {
      const identity = referenceIdentity(reference);
      if (identity) unique.set(identity, reference);
    });
    return Array.from(unique.values());
  }

  async function retryPendingPackageCleanup(options = {}) {
    if (!runtime.pendingPackageCleanup.length) return [];
    const storage = requirePresentationStorage();
    const activeIdentity = referenceIdentity(runtime.packageReference);
    const remaining = [];
    const failures = [];
    for (const reference of runtime.pendingPackageCleanup) {
      if (referenceIdentity(reference) === activeIdentity) continue;
      try {
        await storage.deletePackage(reference);
        if (reference.studyId && reference.studyId !== runtime.packageReference?.studyId) {
          await global.DicomSlidesImporter?.deletePackage(reference.studyId);
        }
      } catch (error) {
        remaining.push(reference);
        failures.push(error);
      }
    }
    const changed = remaining.length !== runtime.pendingPackageCleanup.length;
    runtime.pendingPackageCleanup = remaining;
    if (changed && options.persist !== false) {
      await saveNow({ announce: false });
    }
    return failures;
  }

  function reportPendingCleanup(failures) {
    runtime.cleanupPending = failures.length > 0;
    if (!runtime.cleanupPending) return false;
    const message = "PowerPoint could not remove a discarded embedded DICOM package yet. Reopen the add-in to retry before sharing this presentation.";
    setLoading(message, true);
    setStatus("Embedded DICOM package removal is pending.");
    return true;
  }

  async function restoreLocalPackage(config) {
    const storage = requirePresentationStorage();
    if (runtime.packageReference) {
      if (runtime.packageReference.studyId !== config.studyId) {
        throw new Error("The embedded package reference belongs to a different study.");
      }
      const packageRecord = await storage.readPackage(runtime.packageReference, {
        onProgress: reportPresentationRestore,
      });
      if (config.storageMode !== PRESENTATION_STORAGE_MODE) {
        runtime.config = normalizeConfig(Object.assign({}, config, { storageMode: PRESENTATION_STORAGE_MODE }));
        const saved = await saveNow({ announce: false });
        if (!saved) throw new Error("PowerPoint could not upgrade the embedded DICOM package reference.");
      }
      return cacheAndRegisterPackage(packageRecord);
    }

    if (!config.legacyCacheOnly) {
      throw new Error("The embedded DICOM package reference is missing or invalid.");
    }

    const cachedPackage = await global.DicomSlidesImporter.loadPackage(config.studyId);
    if (!cachedPackage) {
      throw new Error(
        "This presentation was created before DICOM studies were embedded in the PPTX, and its old local cache is unavailable. Import the DICOM study again.",
      );
    }

    const migratedReference = await storage.writePackage(cachedPackage, {
      onProgress: reportPresentationRestore,
    });
    const previousConfig = runtime.config;
    runtime.packageReference = migratedReference;
    runtime.config = normalizeConfig(Object.assign({}, config, { storageMode: PRESENTATION_STORAGE_MODE }));
    const saved = await saveNow({ announce: false });
    if (!saved) {
      runtime.packageReference = null;
      runtime.config = previousConfig;
      runtime.pendingPackageCleanup = withPendingCleanup(runtime.pendingPackageCleanup, migratedReference);
      const cleanupJournalSaved = await saveNow({
        announce: false,
        config: previousConfig,
        packageReference: null,
      });
      if (cleanupJournalSaved) {
        const cleanupFailures = await retryPendingPackageCleanup();
        if (cleanupFailures.length) {
          throw new Error("PowerPoint could not save the embedded DICOM package reference, and removal of the incomplete package is pending.");
        }
      } else {
        try {
          await storage.deletePackage(migratedReference);
          runtime.pendingPackageCleanup = runtime.pendingPackageCleanup.filter(
            (reference) => referenceIdentity(reference) !== referenceIdentity(migratedReference),
          );
        } catch (cleanupError) {
          throw new Error(`PowerPoint could not save the embedded DICOM package reference. Cleanup also failed: ${cleanupError.message}`);
        }
      }
      throw new Error("PowerPoint could not save the embedded DICOM package reference.");
    }
    return cacheAndRegisterPackage(cachedPackage);
  }

  async function connectOffice(info) {
    const host = info?.host;
    const powerPointHost = global.Office?.HostType?.PowerPoint;
    if (host !== powerPointHost && String(host).toLowerCase() !== "powerpoint") {
      const preview = loadLocalPreview();
      if (preview && normalizeConfig(preview).sourceType !== "empty") {
        await renderViewer(preview, { persist: false });
      } else {
        showEmptyState({ persist: false });
      }
      await runtime.expansionController?.initialize();
      return;
    }

    runtime.officeConnected = true;
    document.body.classList.add("office-connected");
    const saved = loadOfficeConfig();
    try {
      runtime.packageReference = loadOfficePackageReference();
      runtime.pendingPackageCleanup = loadOfficeCleanupReferences();
      if (saved && normalizeConfig(saved).sourceType !== "empty") {
        runtime.config = normalizeConfig(saved);
        if (runtime.config.sourceType === "local") await restoreLocalPackage(runtime.config);
        await renderViewer(runtime.config, { persist: false });
        reportPendingCleanup(await retryPendingPackageCleanup());
        setSettingsOpen(false);
      } else {
        showEmptyState({ persist: false });
        reportPendingCleanup(await retryPendingPackageCleanup());
      }
    } catch (error) {
      if (saved && normalizeConfig(saved).sourceType !== "empty") {
        showEmptyState({
          config: normalizeConfig(saved),
          title: "Study data is unavailable",
          message: error.message || "Import this study again to restore its pixels.",
          status: "The slide state was found, but its embedded study could not be restored.",
          persist: false,
        });
      } else {
        showEmptyState({
          title: "Presentation storage needs attention",
          message: error.message || "The presentation cleanup journal could not be read.",
          persist: false,
        });
      }
    }
    applyOfficeView(await getActiveView());
    registerActiveViewChanged();
    await runtime.expansionController?.prepare?.();
    await runtime.expansionController?.initialize();
    if (runtime.viewer && !runtime.cleanupPending) {
      setStatus(runtime.config?.sourceType === "local"
        ? "Connected to PowerPoint; the interactive study is stored in this presentation."
        : "Connected to PowerPoint; state is stored in this slide.");
    }
  }

  function setImportBusy(busy) {
    const controls = [
      runtime.elements.importFilesButton,
      runtime.elements.importFolderButton,
      runtime.elements.importZipButton,
      runtime.elements.importFilesInput,
      runtime.elements.importFolderInput,
      runtime.elements.importZipInput,
    ];
    controls.forEach((control) => { control.disabled = Boolean(busy); });
    runtime.elements.cancelImportButton.hidden = !busy;
    runtime.elements.importDropZone.setAttribute("aria-disabled", String(Boolean(busy)));
    runtime.elements.importDropZone.classList.toggle("disabled", Boolean(busy));
  }

  function updateImportProgress(detail) {
    runtime.elements.importProgress.hidden = false;
    runtime.elements.importProgressBar.value = Number.isFinite(detail.progress) ? detail.progress : 0;
    runtime.elements.importProgressText.textContent = detail.message || "Converting study…";
    setStatus(detail.message || "Converting DICOM study…");
    if (detail.phase !== "complete") setLoading(detail.message || "Converting DICOM study…");
  }

  async function importLocalFiles(files) {
    const selected = Array.from(files || []);
    if (!selected.length) return;
    if (!global.DicomSlidesImporter) {
      setLoading("The DICOM import module did not load.", true);
      return;
    }
    let presentationStorage = null;
    if (runtime.officeConnected) {
      try {
        presentationStorage = requirePresentationStorage();
      } catch (error) {
        setLoading(error.message || String(error), true);
        setStatus("This PowerPoint version cannot embed DICOM studies.");
        return;
      }
    }

    if (runtime.importAbortController) runtime.importAbortController.abort();
    const controller = new AbortController();
    runtime.importAbortController = controller;
    const isCurrentImport = () => runtime.importAbortController === controller;
    setImportBusy(true);
    runtime.elements.importProgress.hidden = false;
    runtime.elements.importProgressBar.value = 0;
    runtime.elements.importProgressText.textContent = "Preparing files…";
    setLoading("Preparing DICOM import…");
    const previousConfig = runtime.config ? normalizeConfig(runtime.config) : emptyConfig();
    const previousReference = runtime.packageReference;
    const previousPendingCleanup = runtime.pendingPackageCleanup.slice();
    let embeddedReference = null;
    let referenceSaved = false;

    try {
      const result = await global.DicomSlidesImporter.importFiles(selected, {
        chunkSize: 12,
        persist: !presentationStorage,
        register: !presentationStorage,
        signal: controller.signal,
        onProgress: (detail) => {
          if (isCurrentImport()) updateImportProgress(Object.assign({}, detail, {
            progress: (Number(detail.progress) || 0) * (presentationStorage ? 0.9 : 1),
          }));
        },
      });
      if (!isCurrentImport()) return;
      if (presentationStorage) {
        if (!result.package) throw new Error("The DICOM importer did not return a package to embed.");
        embeddedReference = await presentationStorage.writePackage(result.package, {
          signal: controller.signal,
          onProgress: (detail) => {
            if (isCurrentImport()) updateImportProgress(Object.assign({}, detail, {
              progress: 0.9 + (Number(detail.progress) || 0) * 0.09,
            }));
          },
        });
        if (!isCurrentImport()) throw new DOMException("Import canceled.", "AbortError");
      }
      const firstSeries = result.study.series[0];
      const config = normalizeConfig({
        sourceType: "local",
        catalogId: "custom",
        studyId: result.study.studyId,
        studyUrl: global.DicomSlidesImporter.localStudyUrl(result.study.studyId),
        series: firstSeries.id,
        slice: Math.floor(Number(firstSeries.slices || 1) / 2),
        mode: "stack",
        preset: "default",
        tool: "window",
        center: null,
        width: null,
        storageMode: presentationStorage ? PRESENTATION_STORAGE_MODE : null,
      });
      runtime.packageReference = embeddedReference;
      runtime.pendingPackageCleanup = previousReference
        ? withPendingCleanup(previousPendingCleanup, previousReference)
        : previousPendingCleanup;
      runtime.config = config;
      syncForm(config);
      const slideStateSaved = await saveNow({ announce: false });
      referenceSaved = slideStateSaved;
      if (!slideStateSaved) throw new Error("PowerPoint could not save the embedded DICOM package reference.");
      if (!isCurrentImport()) return;
      if (presentationStorage) await cacheAndRegisterPackage(result.package);
      await renderViewer(config, { persist: false });
      if (!isCurrentImport()) return;
      const cleanupFailures = await retryPendingPackageCleanup();
      reportPendingCleanup(cleanupFailures);
      setSettingsOpen(false);
      runtime.elements.importProgress.hidden = true;
      const persistenceText = runtime.officeConnected
        ? "embedded in this presentation"
        : result.persisted ? "stored in the local cache" : "available only for this session";
      const warningText = result.warnings.length ? ` ${result.warnings.length} review warning(s).` : "";
      if (!cleanupFailures.length) {
        setStatus(`Imported: ${result.study.seriesCount} series, ${formatBytes(result.totalCompressedBytes)} compressed; ${persistenceText}.${warningText}`);
      }
    } catch (error) {
      if (!embeddedReference && error?.cleanupReference) embeddedReference = error.cleanupReference;
      if (embeddedReference && !referenceSaved) {
        runtime.packageReference = previousReference;
        runtime.config = previousConfig;
        runtime.pendingPackageCleanup = withPendingCleanup(previousPendingCleanup, embeddedReference);
        syncForm(previousConfig);
        const cleanupJournalSaved = await saveNow({
          announce: false,
          config: previousConfig,
          packageReference: previousReference,
        });
        if (cleanupJournalSaved) {
          const cleanupFailures = await retryPendingPackageCleanup();
          if (cleanupFailures.length) {
            error = new Error(`${error.message} The incomplete embedded package is queued for cleanup.`);
          }
        } else {
          try {
            await presentationStorage.deletePackage(embeddedReference);
            runtime.pendingPackageCleanup = previousPendingCleanup;
          } catch (cleanupError) {
            error = new Error(`${error.message} Cleanup also failed: ${cleanupError.message}`);
          }
        }
      }
      if (!isCurrentImport()) return;
      if (error?.name === "AbortError") {
        clearLoading();
        setStatus("Import canceled.");
        runtime.elements.importProgressText.textContent = "Import canceled.";
      } else {
        setLoading(error.message || String(error), true);
        setStatus("Failed to import the DICOM study.");
        runtime.elements.importProgressText.textContent = error.message || String(error);
      }
    } finally {
      if (isCurrentImport()) {
        setImportBusy(false);
        runtime.importAbortController = null;
      }
    }
  }

  function bindImportInput(input) {
    input.addEventListener("change", () => {
      const files = Array.from(input.files || []);
      input.value = "";
      importLocalFiles(files);
    });
  }

  async function runViewerCommand(command, configPatch = null) {
    if (!runtime.viewer || typeof command !== "function") return;
    try {
      if (configPatch) runtime.config = normalizeConfig(Object.assign({}, runtime.config, configPatch));
      await command(runtime.viewer);
      captureViewerState();
      updateToolbar(runtime.viewer.getState?.() || {});
      scheduleSave();
    } catch (error) {
      setStatus(error?.message || "The viewer command failed.");
    }
  }

  function applyExpandedUi(value) {
    const expanded = Boolean(value);
    runtime.expanded = expanded;
    document.body.classList.toggle("viewer-expanded", expanded);
    runtime.elements.expandViewButton.setAttribute("aria-pressed", String(expanded));
    runtime.elements.expandViewButton.setAttribute(
      "aria-label",
      expanded ? "Restore viewer size" : "Expand viewer to fill the slide",
    );
    runtime.elements.expandViewButton.title = expanded ? "Restore viewer size" : "Expand viewer to fill the slide";
    runtime.elements.expandViewButton.disabled = !runtime.viewer && !expanded;
  }

  async function setExpanded(value) {
    if (runtime.expansionController) return runtime.expansionController.setExpanded(Boolean(value));
    applyExpandedUi(value);
    if (runtime.viewer?.setExpanded) await runtime.viewer.setExpanded(Boolean(value));
    return Boolean(value);
  }

  function createExpansionController() {
    if (runtime.expansionController || !global.DicomSlidesPowerPointHost) return runtime.expansionController;
    runtime.expansionController = global.DicomSlidesPowerPointHost.createExpansionController({
      getViewer: () => runtime.viewer,
      getActiveView: () => runtime.officeView,
      onExpandedChange: applyExpandedUi,
      onStatus: setStatus,
    });
    return runtime.expansionController;
  }

  function bindUi() {
    runtime.elements.importButton.addEventListener("click", () => {
      setSettingsOpen(runtime.elements.settingsPanel.hidden);
    });
    toolButtons().forEach((button) => {
      button.addEventListener("click", () => {
        const tool = button.dataset.tool;
        runViewerCommand((viewer) => viewer.setTool(tool), { tool });
      });
    });
    runtime.elements.windowPresetSelect.addEventListener("change", (event) => {
      const preset = event.target.value;
      runViewerCommand((viewer) => viewer.setPreset(preset), { preset, center: null, width: null });
    });
    runtime.elements.seriesSelect.addEventListener("change", (event) => {
      const series = event.target.value;
      const desired = {
        mode: runtime.config?.mode || "stack",
        preset: runtime.config?.preset || "default",
        tool: runtime.config?.tool || "window",
      };
      runViewerCommand(async (viewer) => {
        await viewer.setSeries(series);
        await viewer.setPreset(desired.preset);
        await viewer.setTool(desired.tool);
        await viewer.setMode(desired.mode);
      }, { series });
    });
    modeButtons().forEach((button) => {
      button.addEventListener("click", () => {
        const mode = button.dataset.mode;
        runViewerCommand((viewer) => viewer.setMode(mode), { mode });
      });
    });
    runtime.elements.resetViewButton.addEventListener("click", () => {
      runViewerCommand((viewer) => viewer.reset(), { preset: "default", center: null, width: null });
    });
    runtime.elements.expandViewButton.addEventListener("click", () => setExpanded(!runtime.expanded));
    runtime.elements.closeSettingsButton.addEventListener("click", () => setSettingsOpen(false));
    runtime.elements.catalogId.addEventListener("change", (event) => {
      applyCatalogDefaults(event.target.value);
      syncSourceVisibility(runtime.config);
    });
    runtime.elements.restoreButton.addEventListener("click", () => {
      const current = runtime.config || emptyConfig();
      if (current.sourceType === "empty") {
        showEmptyState({ persist: true });
        return;
      }
      const entry = findCatalogItem(runtime.elements.catalogId.value);
      runtime.config = entry
        ? normalizeConfig(defaultConfig(entry.id))
        : normalizeConfig(Object.assign({}, current, {
          mode: "stack",
          preset: "default",
          slice: 0,
          tool: "window",
          center: null,
          width: null,
        }));
      syncForm(runtime.config);
      renderViewer(runtime.config).catch((error) => setLoading(error.message, true));
    });
    runtime.elements.settingsForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const previousConfig = runtime.config ? normalizeConfig(runtime.config) : emptyConfig();
      const previousReference = runtime.packageReference;
      const previousPendingCleanup = runtime.pendingPackageCleanup.slice();
      const previousLastLocalConfig = runtime.lastLocalConfig;
      let stateSaved = false;
      runtime.suspendAutoSave = true;
      try {
        const config = readFormConfig();
        validateStudySource(config);
        setSettingsOpen(false);
        await renderViewer(config, { persist: false });
        const retiredReference = config.sourceType !== "local" ? previousReference : null;
        runtime.packageReference = retiredReference ? null : previousReference;
        runtime.pendingPackageCleanup = retiredReference
          ? withPendingCleanup(previousPendingCleanup, retiredReference)
          : previousPendingCleanup;
        const saved = await saveNow({ announce: false, config });
        if (!saved) {
          throw new Error("PowerPoint could not save the new slide state.");
        }
        stateSaved = true;
        if (retiredReference) runtime.lastLocalConfig = null;
        reportPendingCleanup(await retryPendingPackageCleanup());
      } catch (error) {
        if (!stateSaved) {
          runtime.config = previousConfig;
          runtime.packageReference = previousReference;
          runtime.pendingPackageCleanup = previousPendingCleanup;
          runtime.lastLocalConfig = previousLastLocalConfig;
          await renderViewer(previousConfig, { persist: false }).catch(() => null);
        }
        setLoading(error.message || String(error), true);
      } finally {
        runtime.suspendAutoSave = false;
      }
    });

    runtime.elements.importFilesButton.addEventListener("click", () => runtime.elements.importFilesInput.click());
    runtime.elements.emptyImportButton.addEventListener("click", () => {
      setSettingsOpen(true);
      runtime.elements.importFilesInput.click();
    });
    runtime.elements.importFolderButton.addEventListener("click", () => runtime.elements.importFolderInput.click());
    runtime.elements.importZipButton.addEventListener("click", () => runtime.elements.importZipInput.click());
    bindImportInput(runtime.elements.importFilesInput);
    bindImportInput(runtime.elements.importFolderInput);
    bindImportInput(runtime.elements.importZipInput);
    runtime.elements.cancelImportButton.addEventListener("click", () => runtime.importAbortController?.abort());

    const dropZone = runtime.elements.importDropZone;
    ["dragenter", "dragover"].forEach((type) => dropZone.addEventListener(type, (event) => {
      event.preventDefault();
      if (!runtime.importAbortController) dropZone.classList.add("drag-over");
    }));
    ["dragleave", "drop"].forEach((type) => dropZone.addEventListener(type, (event) => {
      event.preventDefault();
      dropZone.classList.remove("drag-over");
    }));
    dropZone.addEventListener("drop", (event) => {
      if (!runtime.importAbortController) importLocalFiles(event.dataTransfer?.files || []);
    });
    dropZone.addEventListener("click", () => {
      if (!runtime.importAbortController) runtime.elements.importFilesInput.click();
    });
    dropZone.addEventListener("keydown", (event) => {
      if ((event.key === "Enter" || event.key === " ") && !runtime.importAbortController) {
        event.preventDefault();
        runtime.elements.importFilesInput.click();
      }
    });

    runtime.elements.useRemoteSourceButton.addEventListener("click", () => {
      runtime.lastLocalConfig = null;
      syncForm(remoteCustomConfig());
      runtime.elements.studyId.focus();
    });
    runtime.elements.removeLocalSourceButton.addEventListener("click", async () => {
      const previousConfig = runtime.config ? normalizeConfig(runtime.config) : emptyConfig();
      const previousReference = runtime.packageReference;
      const previousPendingCleanup = runtime.pendingPackageCleanup.slice();
      const previousLastLocalConfig = runtime.lastLocalConfig;
      let stateSaved = false;
      try {
        const config = emptyConfig();
        runtime.config = config;
        runtime.packageReference = null;
        runtime.pendingPackageCleanup = previousReference
          ? withPendingCleanup(previousPendingCleanup, previousReference)
          : previousPendingCleanup;
        const saved = await saveNow({
          announce: false,
          config,
          packageReference: null,
        });
        if (!saved) throw new Error("PowerPoint could not save the empty slide state.");
        stateSaved = true;
        showEmptyState({ persist: false });
        runtime.lastLocalConfig = null;
        const cleanupFailures = await retryPendingPackageCleanup();
        if (!reportPendingCleanup(cleanupFailures)) {
          setStatus("The study was removed from this presentation.");
        }
      } catch (error) {
        if (!stateSaved) {
          runtime.config = previousConfig;
          runtime.packageReference = previousReference;
          runtime.pendingPackageCleanup = previousPendingCleanup;
          runtime.lastLocalConfig = previousLastLocalConfig;
          syncForm(previousConfig);
        }
        setLoading(error.message || String(error), true);
        setStatus("Could not remove the study from this presentation.");
      }
    });

    global.addEventListener("beforeunload", () => {
      global.clearTimeout(runtime.saveTimer);
      saveNow();
    });
  }

  async function initializeUi() {
    runtime.elements = {
      viewerToolbar: byId("viewerToolbar"),
      importButton: byId("importButton"),
      toolWindowButton: byId("toolWindowButton"),
      toolPanButton: byId("toolPanButton"),
      toolZoomButton: byId("toolZoomButton"),
      toolScrollButton: byId("toolScrollButton"),
      windowPresetSelect: byId("windowPresetSelect"),
      seriesSelect: byId("seriesSelect"),
      mode2dButton: byId("mode2dButton"),
      modeMprButton: byId("modeMprButton"),
      mode3dButton: byId("mode3dButton"),
      resetViewButton: byId("resetViewButton"),
      expandViewButton: byId("expandViewButton"),
      settingsPanel: byId("settingsPanel"),
      closeSettingsButton: byId("closeSettingsButton"),
      settingsForm: byId("settingsForm"),
      catalogId: byId("catalogId"),
      customSource: byId("customSource"),
      localSource: byId("localSource"),
      localSourceSummary: byId("localSourceSummary"),
      useRemoteSourceButton: byId("useRemoteSourceButton"),
      removeLocalSourceButton: byId("removeLocalSourceButton"),
      studyId: byId("studyId"),
      studyUrl: byId("studyUrl"),
      series: byId("series"),
      slice: byId("slice"),
      mode: byId("mode"),
      preset: byId("preset"),
      tool: byId("tool"),
      restoreButton: byId("restoreButton"),
      importFilesButton: byId("importFilesButton"),
      importFolderButton: byId("importFolderButton"),
      importZipButton: byId("importZipButton"),
      importFilesInput: byId("importFilesInput"),
      importFolderInput: byId("importFolderInput"),
      importZipInput: byId("importZipInput"),
      importDropZone: byId("importDropZone"),
      importProgress: byId("importProgress"),
      importProgressBar: byId("importProgressBar"),
      importProgressText: byId("importProgressText"),
      cancelImportButton: byId("cancelImportButton"),
      viewerMount: byId("viewerMount"),
      emptyState: byId("emptyState"),
      emptyImportButton: byId("emptyImportButton"),
      emptyStateTitle: byId("emptyStateTitle"),
      emptyStateMessage: byId("emptyStateMessage"),
      loadingPanel: byId("loadingPanel"),
      loadingText: byId("loadingText"),
      statusText: byId("statusText"),
    };

    populateCatalog();
    bindUi();
    createExpansionController();
    if (global.DicomSlide?.ready) await global.DicomSlide.ready;
    if (global.DicomSlidesImporter?.ready) await global.DicomSlidesImporter.ready;
    if (hasOfficeRuntime()) {
      showEmptyState({ persist: false });
      return;
    }
    const preview = loadLocalPreview();
    if (preview && normalizeConfig(preview).sourceType !== "empty") {
      await renderViewer(preview, { persist: false });
    } else {
      showEmptyState({ persist: false });
    }
    await runtime.expansionController?.initialize();
  }

  function boot() {
    if (!runtime.bootPromise) {
      runtime.bootPromise = initializeUi().catch((error) => {
        runtime.bootPromise = null;
        throw error;
      });
    }
    return runtime.bootPromise;
  }

  const domReady = document.readyState === "loading"
    ? new Promise((resolve) => document.addEventListener("DOMContentLoaded", resolve, { once: true }))
    : Promise.resolve();

  domReady.then(boot).catch((error) => console.error(error));

  if (global.Office && typeof global.Office.onReady === "function") {
    try {
      const ready = global.Office.onReady((info) => {
        domReady.then(() => boot()).then(() => connectOffice(info)).catch((error) => {
          setStatus(`Failed to connect to PowerPoint: ${error.message}`);
        });
      });
      if (ready && typeof ready.catch === "function") ready.catch(() => {});
    } catch (_) {
      // Browser preview remains functional without an Office host.
    }
  }

  global.DicomSlidesPowerPointAddin = Object.freeze({
    version: "1.3.0",
    normalizeConfig,
    validateStudySource,
    renderViewer,
    importLocalFiles,
    getState: () => serializeConfig(),
  });
})(window);
