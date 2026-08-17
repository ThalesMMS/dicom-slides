(function (global) {
  "use strict";

  const SETTINGS_KEY = "dicomSlides.powerPoint.config.v1";
  const LOCAL_STORAGE_KEY = "dicomSlides.powerPoint.preview.v1";
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
    booted: false,
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

  function defaultConfig(catalogId) {
    const entry = findCatalogItem(catalogId) || catalog[0] || {
      id: "custom",
      studyId: "",
      studyUrl: "",
      defaultSeries: "1",
      defaultMode: "stack",
      defaultPreset: "default",
      defaultSlice: 0,
    };
    return {
      schemaVersion: 1,
      catalogId: entry.id || "custom",
      studyId: entry.studyId || "",
      studyUrl: entry.studyUrl || "",
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
    const requestedCatalog = findCatalogItem(candidate.catalogId);
    const base = defaultConfig(requestedCatalog?.id || catalog[0]?.id || "custom");
    const catalogId = requestedCatalog ? requestedCatalog.id : "custom";

    const result = {
      schemaVersion: 1,
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
    if (!config.studyId) throw new Error("Informe o ID do estudo.");
    if (!config.studyUrl) throw new Error("Informe a URL do study.js.");

    let resolved;
    try {
      resolved = new URL(config.studyUrl, global.location.href);
    } catch (_) {
      throw new Error("A URL do study.js é inválida.");
    }

    const isLocalDevelopment = ["localhost", "127.0.0.1", "[::1]"].includes(resolved.hostname);
    const allowed = resolved.protocol === "https:"
      || (resolved.protocol === "http:" && isLocalDevelopment)
      || (resolved.protocol === "file:" && global.location.protocol === "file:");
    if (!allowed) {
      throw new Error("O pacote do estudo deve usar HTTPS. HTTP é aceito somente em localhost.");
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

  function modeLabel(mode) {
    return mode === "mpr" ? "MPR" : mode === "volume" ? "3D" : "2D";
  }

  function updateBadges(state) {
    if (!state || typeof state !== "object") return;
    runtime.elements.studyLabel.textContent = state.studyTitle || runtime.config.studyId || "Estudo DICOM";
    runtime.elements.modeBadge.textContent = modeLabel(state.mode || runtime.config.mode);
    runtime.elements.seriesBadge.textContent = state.seriesTitle
      ? `Série ${state.seriesNumber || state.seriesIndex + 1} · ${state.seriesTitle}`
      : `Série ${runtime.config.series || "—"}`;
    const currentSlice = Number.isFinite(state.slice) ? state.slice + 1 : null;
    const totalSlices = Number.isFinite(state.totalSlices) ? state.totalSlices : null;
    runtime.elements.sliceBadge.textContent = currentSlice == null
      ? "Imagem —"
      : `Imagem ${currentSlice}${totalSlices ? ` / ${totalSlices}` : ""}`;
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
    updateBadges(state);
    return runtime.config;
  }

  function serializeConfig() {
    const config = captureViewerState();
    return {
      schemaVersion: 1,
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

  function saveNow() {
    const config = serializeConfig();
    if (!runtime.officeConnected || !global.Office?.context?.document?.settings) {
      saveLocalPreview(config);
      return;
    }

    try {
      const settings = global.Office.context.document.settings;
      settings.set(SETTINGS_KEY, config);
      settings.saveAsync((result) => {
        if (result.status === global.Office.AsyncResultStatus.Failed) {
          setStatus(`Não foi possível salvar o estado: ${result.error.message}`);
        } else {
          setStatus("Estado salvo no slide.");
        }
      });
    } catch (error) {
      setStatus(`Não foi possível salvar o estado: ${error.message}`);
    }
  }

  function scheduleSave() {
    global.clearTimeout(runtime.saveTimer);
    runtime.saveTimer = global.setTimeout(saveNow, 250);
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
    runtime.elements.settingsButton.setAttribute("aria-expanded", String(isOpen));
    if (isOpen) runtime.elements.catalogId.focus({ preventScroll: true });
  }

  function syncCustomSourceVisibility() {
    const isCustom = runtime.elements.catalogId.value === "custom";
    runtime.elements.customSource.hidden = !isCustom;
    runtime.elements.studyId.required = isCustom;
    runtime.elements.studyUrl.required = isCustom;
  }

  function syncForm(config) {
    const entry = findCatalogItem(config.catalogId);
    runtime.elements.catalogId.value = entry ? entry.id : "custom";
    runtime.elements.studyId.value = config.studyId;
    runtime.elements.studyUrl.value = config.studyUrl;
    runtime.elements.series.value = config.series;
    runtime.elements.slice.value = String(config.slice);
    runtime.elements.mode.value = config.mode;
    runtime.elements.preset.value = config.preset;
    runtime.elements.tool.value = config.tool;
    syncCustomSourceVisibility();
  }

  function applyCatalogDefaults(catalogId) {
    if (catalogId === "custom") {
      const next = Object.assign({}, runtime.config, { catalogId: "custom" });
      syncForm(normalizeConfig(next));
      return;
    }
    const next = defaultConfig(catalogId);
    runtime.config = normalizeConfig(next);
    syncForm(runtime.config);
  }

  function readFormConfig() {
    const catalogId = runtime.elements.catalogId.value;
    const entry = findCatalogItem(catalogId);
    const current = runtime.config || defaultConfig(catalog[0]?.id);
    return normalizeConfig({
      catalogId: entry ? entry.id : "custom",
      studyId: entry ? entry.studyId : runtime.elements.studyId.value,
      studyUrl: entry ? entry.studyUrl : runtime.elements.studyUrl.value,
      series: runtime.elements.series.value,
      slice: runtime.elements.slice.value,
      mode: runtime.elements.mode.value,
      preset: runtime.elements.preset.value,
      tool: runtime.elements.tool.value,
      center: null,
      width: null,
      previous: current,
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
      viewer.addEventListener(eventName, () => {
        captureViewerState();
        scheduleSave();
      });
    });
    viewer.addEventListener("dicom-volume-progress", (event) => {
      const detail = event.detail || {};
      if (Number.isFinite(detail.progress)) {
        setStatus(`Preparando volume: ${Math.round(detail.progress * 100)}%`);
      }
    });
    viewer.addEventListener("dicom-error", (event) => {
      const message = event.detail?.message || "Falha no visualizador.";
      setLoading(message, true);
      setStatus("Erro ao carregar o estudo.");
    });
  }

  async function renderViewer(config, options = {}) {
    const normalized = normalizeConfig(config);
    const studyUrl = validateStudySource(normalized);
    const generation = ++runtime.generation;
    runtime.config = normalized;
    syncForm(normalized);
    updateBadges({
      studyTitle: findCatalogItem(normalized.catalogId)?.label || normalized.studyId,
      mode: normalized.mode,
    });
    setLoading("Carregando estudo e pixels…");
    setStatus("Carregando conteúdo do slide…");

    const viewer = document.createElement("dicom-study-viewer");
    viewer.setAttribute("study-id", normalized.studyId);
    viewer.setAttribute("src", studyUrl);
    viewer.setAttribute("series", normalized.series);
    viewer.setAttribute("mode", normalized.mode);
    viewer.setAttribute("preset", normalized.preset);
    viewer.setAttribute("slice", String(normalized.slice));
    viewer.setAttribute("tool", normalized.tool);
    viewer.setAttribute("aria-label", `Visualizador do estudo ${normalized.studyId}`);
    bindViewerEvents(viewer);

    runtime.viewer = viewer;
    runtime.elements.viewerMount.replaceChildren(viewer);

    try {
      await viewer.ready;
      if (generation !== runtime.generation || runtime.viewer !== viewer) return;
      if (normalized.center != null && normalized.width != null) {
        await viewer.setWindow(normalized.center, normalized.width);
      }
      captureViewerState();
      clearLoading();
      setStatus(runtime.officeConnected ? "Visualizador pronto; estado salvo no slide." : "Prévia no navegador; abra pelo PowerPoint para salvar no slide.");
      if (options.persist !== false) scheduleSave();
    } catch (error) {
      if (generation !== runtime.generation) return;
      setLoading(error.message || String(error), true);
      setStatus("Erro ao carregar o estudo.");
    }
  }

  function populateCatalog() {
    const select = runtime.elements.catalogId;
    select.replaceChildren();
    catalog.forEach((entry) => {
      const option = document.createElement("option");
      option.value = entry.id;
      option.textContent = entry.label;
      select.appendChild(option);
    });
    const custom = document.createElement("option");
    custom.value = "custom";
    custom.textContent = "Pacote personalizado (HTTPS)";
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
          setStatus(`Não foi possível monitorar a exibição: ${result.error.message}`);
        }
      }
    );
  }

  async function connectOffice(info) {
    const host = info?.host;
    const powerPointHost = global.Office?.HostType?.PowerPoint;
    if (host !== powerPointHost && String(host).toLowerCase() !== "powerpoint") return;

    runtime.officeConnected = true;
    document.body.classList.add("office-connected");
    const saved = loadOfficeConfig();
    if (saved) {
      runtime.config = normalizeConfig(saved);
      await renderViewer(runtime.config, { persist: false });
    }
    applyOfficeView(await getActiveView());
    registerActiveViewChanged();
    setStatus("Conectado ao PowerPoint; o estado será salvo neste slide.");
  }

  function bindUi() {
    runtime.elements.settingsButton.addEventListener("click", () => {
      setSettingsOpen(runtime.elements.settingsPanel.hidden);
    });
    runtime.elements.closeSettingsButton.addEventListener("click", () => setSettingsOpen(false));
    runtime.elements.catalogId.addEventListener("change", (event) => {
      applyCatalogDefaults(event.target.value);
      syncCustomSourceVisibility();
    });
    runtime.elements.restoreButton.addEventListener("click", () => {
      const catalogId = runtime.elements.catalogId.value === "custom"
        ? catalog[0]?.id
        : runtime.elements.catalogId.value;
      runtime.config = normalizeConfig(defaultConfig(catalogId));
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
    global.addEventListener("beforeunload", () => {
      global.clearTimeout(runtime.saveTimer);
      saveNow();
    });
  }

  async function boot() {
    if (runtime.booted) return;
    runtime.booted = true;
    runtime.elements = {
      authoringBar: byId("authoringBar"),
      settingsButton: byId("settingsButton"),
      settingsPanel: byId("settingsPanel"),
      closeSettingsButton: byId("closeSettingsButton"),
      settingsForm: byId("settingsForm"),
      catalogId: byId("catalogId"),
      customSource: byId("customSource"),
      studyId: byId("studyId"),
      studyUrl: byId("studyUrl"),
      series: byId("series"),
      slice: byId("slice"),
      mode: byId("mode"),
      preset: byId("preset"),
      tool: byId("tool"),
      restoreButton: byId("restoreButton"),
      viewerMount: byId("viewerMount"),
      loadingPanel: byId("loadingPanel"),
      loadingText: byId("loadingText"),
      statusText: byId("statusText"),
      studyLabel: byId("studyLabel"),
      modeBadge: byId("modeBadge"),
      seriesBadge: byId("seriesBadge"),
      sliceBadge: byId("sliceBadge"),
    };

    populateCatalog();
    bindUi();
    runtime.config = normalizeConfig(loadLocalPreview() || defaultConfig(catalog[0]?.id));
    syncForm(runtime.config);
    await renderViewer(runtime.config, { persist: false });
  }

  const domReady = document.readyState === "loading"
    ? new Promise((resolve) => document.addEventListener("DOMContentLoaded", resolve, { once: true }))
    : Promise.resolve();

  domReady.then(boot).catch((error) => console.error(error));

  if (global.Office && typeof global.Office.onReady === "function") {
    try {
      const ready = global.Office.onReady((info) => {
        domReady.then(() => boot()).then(() => connectOffice(info)).catch((error) => {
          setStatus(`Falha ao conectar ao PowerPoint: ${error.message}`);
        });
      });
      if (ready && typeof ready.catch === "function") ready.catch(() => {});
    } catch (_) {
      // Browser preview remains functional without an Office host.
    }
  }

  global.DicomSlidesPowerPointAddin = Object.freeze({
    version: "1.0.0",
    normalizeConfig,
    validateStudySource,
    renderViewer,
    getState: () => serializeConfig(),
  });
})(window);
