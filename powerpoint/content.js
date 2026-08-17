(function (global) {
  "use strict";

  const SETTINGS_KEY = "dicomSlides.powerPoint.config.v1";
  const LOCAL_STORAGE_KEY = "dicomSlides.powerPoint.preview.v1";
  const SCHEMA_VERSION = 2;
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
    expansionController: null,
    expanded: false,
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
    };

    if (result.width != null) result.width = Math.max(1, result.width);
    return result;
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

    const isLocalDevelopment = ["localhost", "127.0.0.1", "[::1]"].includes(resolved.hostname);
    const allowed = resolved.protocol === "https:"
      || (resolved.protocol === "http:" && isLocalDevelopment)
      || (resolved.protocol === "file:" && global.location.protocol === "file:");
    if (!allowed) {
      throw new Error("The study package must use HTTPS. HTTP is allowed only on localhost.");
    }
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

  function saveNow(options = {}) {
    const config = serializeConfig();
    if (!runtime.officeConnected || !global.Office?.context?.document?.settings) {
      if (!hasOfficeRuntime()) saveLocalPreview(config);
      return Promise.resolve(!hasOfficeRuntime());
    }

    return new Promise((resolve) => {
      try {
        const settings = global.Office.context.document.settings;
        settings.set(SETTINGS_KEY, config);
        settings.saveAsync((result) => {
          if (result.status === global.Office.AsyncResultStatus.Failed) {
            setStatus(`Could not save the slide state: ${result.error.message}`);
            resolve(false);
          } else {
            if (options.announce !== false) {
              setStatus(config.sourceType === "local"
                ? "State saved to the slide; pixels remain in this device's local cache."
                : "State saved to the slide.");
            }
            resolve(true);
          }
        });
      } catch (error) {
        setStatus(`Could not save the slide state: ${error.message}`);
        resolve(false);
      }
    });
  }

  function scheduleSave() {
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
      runtime.elements.localSourceSummary.textContent = `${config.studyId}. The package will be restored from the local cache when needed.`;
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
    if (customOption) customOption.textContent = isLocal ? "Study imported on this device" : "Custom package (HTTPS)";
    if (isLocal) updateLocalSourceSummary(config);
  }

  function syncForm(config) {
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
      runtime.config = remoteCustomConfig();
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
        updateToolbar(event.detail || viewer.getState?.() || {});
        captureViewerState();
        scheduleSave();
      });
    });
    viewer.addEventListener("dicom-volume-progress", (event) => {
      const detail = event.detail || {};
      if (Number.isFinite(detail.progress)) {
        setStatus(`Preparing volume: ${Math.round(detail.progress * 100)}%`);
      }
    });
    viewer.addEventListener("dicom-error", (event) => {
      const message = event.detail?.message || "Viewer failure.";
      setLoading(message, true);
      setStatus("Error loading the study.");
    });
    viewer.addEventListener("dicom-expand-request", (event) => {
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
    setLoading(normalized.sourceType === "local" ? "Restoring the converted study from the local cache…" : "Loading study and pixels…");
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
        setStatus("Viewer ready; pixels are in this device's local cache.");
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
    if (saved && normalizeConfig(saved).sourceType !== "empty") {
      runtime.config = normalizeConfig(saved);
      try {
        await renderViewer(runtime.config, { persist: false });
        setSettingsOpen(false);
      } catch (error) {
        showEmptyState({
          config: runtime.config,
          title: "Study data is unavailable",
          message: error.message || "Import this study again to restore its pixels.",
          status: "The slide state was found, but the local study cache is unavailable.",
          persist: false,
        });
      }
    } else {
      showEmptyState({ persist: false });
    }
    applyOfficeView(await getActiveView());
    registerActiveViewChanged();
    await runtime.expansionController?.initialize();
    if (runtime.viewer) {
      setStatus(runtime.config?.sourceType === "local"
        ? "Connected to PowerPoint; state is in the slide and pixels are in the local cache."
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

    if (runtime.importAbortController) runtime.importAbortController.abort();
    const controller = new AbortController();
    runtime.importAbortController = controller;
    setImportBusy(true);
    runtime.elements.importProgress.hidden = false;
    runtime.elements.importProgressBar.value = 0;
    runtime.elements.importProgressText.textContent = "Preparing files…";
    setLoading("Preparing DICOM import…");

    try {
      const result = await global.DicomSlidesImporter.importFiles(selected, {
        chunkSize: 12,
        persist: true,
        signal: controller.signal,
        onProgress: updateImportProgress,
      });
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
      });
      runtime.config = config;
      syncForm(config);
      await renderViewer(config, { persist: false });
      const slideStateSaved = await saveNow({ announce: false });
      setSettingsOpen(false);
      runtime.elements.importProgress.hidden = true;
      const cacheText = result.persisted ? "stored in the local cache" : "available only for this session";
      const saveText = runtime.officeConnected
        ? slideStateSaved ? " Slide state saved." : " Slide state could not be saved."
        : "";
      const warningText = result.warnings.length ? ` ${result.warnings.length} review warning(s).` : "";
      setStatus(`Imported: ${result.study.seriesCount} series, ${formatBytes(result.totalCompressedBytes)} compressed; ${cacheText}.${saveText}${warningText}`);
    } catch (error) {
      if (error?.name === "AbortError") {
        clearLoading();
        setStatus("Import canceled.");
        runtime.elements.importProgressText.textContent = "Import canceled.";
      } else {
        setLoading(error.message || String(error), true);
        setStatus("Failed to convert the DICOM files.");
        runtime.elements.importProgressText.textContent = error.message || String(error);
      }
    } finally {
      setImportBusy(false);
      if (runtime.importAbortController === controller) runtime.importAbortController = null;
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
    runtime.elements.settingsForm.addEventListener("submit", (event) => {
      event.preventDefault();
      try {
        const config = readFormConfig();
        validateStudySource(config);
        setSettingsOpen(false);
        renderViewer(config).catch((error) => setLoading(error.message, true));
      } catch (error) {
        setLoading(error.message || String(error), true);
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
      runtime.config = remoteCustomConfig();
      syncForm(runtime.config);
      runtime.elements.studyId.focus();
    });
    runtime.elements.removeLocalSourceButton.addEventListener("click", async () => {
      const studyId = runtime.config?.sourceType === "local" ? runtime.config.studyId : null;
      if (studyId && global.DicomSlidesImporter) await global.DicomSlidesImporter.deletePackage(studyId);
      showEmptyState({ persist: false });
      await saveNow({ announce: false });
      setStatus("The cached study was removed. Import a study to continue.");
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
    version: "1.1.0",
    normalizeConfig,
    validateStudySource,
    renderViewer,
    importLocalFiles,
    getState: () => serializeConfig(),
  });
})(window);
