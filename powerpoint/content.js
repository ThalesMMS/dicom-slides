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
    booted: false,
    importAbortController: null,
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
      schemaVersion: SCHEMA_VERSION,
      sourceType: entry.id === "custom" ? "remote" : "catalog",
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
    if (!config.studyId) throw new Error("Informe o ID do estudo.");
    if (!config.studyUrl) throw new Error("Informe a URL do study.js.");

    let resolved;
    try {
      resolved = new URL(config.studyUrl, global.location.href);
    } catch (_) {
      throw new Error("A URL do study.js é inválida.");
    }

    if (resolved.protocol === "dicom-slides-local:") {
      if (config.sourceType !== "local" || !global.DicomSlidesImporter) {
        throw new Error("A referência local do estudo é inválida.");
      }
      const urlStudyId = global.DicomSlidesImporter.studyIdFromLocalUrl(resolved.href);
      if (urlStudyId && urlStudyId !== config.studyId.toLowerCase()) {
        throw new Error("O ID do estudo não corresponde ao pacote local.");
      }
      return resolved.href;
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

  function formatBytes(value) {
    const bytes = Number(value || 0);
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
  }

  function registeredStudy(studyId) {
    return global.__DICOM_SLIDE_STUDIES__?.[studyId] || null;
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
          setStatus(config.sourceType === "local" ? "Estado salvo; pixels mantidos no cache local deste dispositivo." : "Estado salvo no slide.");
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

  function updateLocalSourceSummary(config) {
    const study = registeredStudy(config.studyId);
    if (!study) {
      runtime.elements.localSourceSummary.textContent = `${config.studyId}. O pacote será restaurado do cache quando necessário.`;
      return;
    }
    const images = Array.isArray(study.series) ? study.series.reduce((sum, item) => sum + Number(item.slices || 0), 0) : 0;
    runtime.elements.localSourceSummary.textContent = `${study.title || config.studyId} · ${study.seriesCount || study.series?.length || 0} série(s) · ${images} imagem(ns)`;
  }

  function syncSourceVisibility(config = runtime.config) {
    const customOption = runtime.elements.catalogId.querySelector('option[value="custom"]');
    const isCustom = runtime.elements.catalogId.value === "custom";
    const isLocal = isCustom && config?.sourceType === "local";
    const isRemote = isCustom && !isLocal;
    runtime.elements.customSource.hidden = !isRemote;
    runtime.elements.localSource.hidden = !isLocal;
    runtime.elements.studyId.required = isRemote;
    runtime.elements.studyUrl.required = isRemote;
    runtime.elements.studyId.disabled = !isRemote;
    runtime.elements.studyUrl.disabled = !isRemote;
    if (customOption) customOption.textContent = isLocal ? "Exame importado neste dispositivo" : "Pacote personalizado (HTTPS)";
    if (isLocal) updateLocalSourceSummary(config);
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
    const current = runtime.config || defaultConfig(catalog[0]?.id);
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
      studyTitle: registeredStudy(normalized.studyId)?.title || findCatalogItem(normalized.catalogId)?.label || normalized.studyId,
      mode: normalized.mode,
    });
    setLoading(normalized.sourceType === "local" ? "Restaurando exame convertido do cache local…" : "Carregando estudo e pixels…");
    setStatus("Carregando conteúdo do slide…");

    try {
      if (normalized.sourceType === "local") {
        if (!global.DicomSlidesImporter) throw new Error("O importador DICOM local não foi carregado.");
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
      viewer.setAttribute("aria-label", `Visualizador do estudo ${normalized.studyId}`);
      bindViewerEvents(viewer);

      runtime.viewer = viewer;
      runtime.elements.viewerMount.replaceChildren(viewer);
      await viewer.ready;
      if (generation !== runtime.generation || runtime.viewer !== viewer) return;
      if (normalized.center != null && normalized.width != null) {
        await viewer.setWindow(normalized.center, normalized.width);
      }
      captureViewerState();
      clearLoading();
      if (normalized.sourceType === "local") {
        setStatus("Visualizador pronto; os pixels estão no cache local deste dispositivo.");
      } else {
        setStatus(runtime.officeConnected ? "Visualizador pronto; estado salvo no slide." : "Prévia no navegador; abra pelo PowerPoint para salvar no slide.");
      }
      if (options.persist !== false) scheduleSave();
      return viewer;
    } catch (error) {
      if (generation !== runtime.generation) return null;
      setLoading(error.message || String(error), true);
      setStatus("Erro ao carregar o estudo.");
      throw error;
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
    setStatus(runtime.config?.sourceType === "local"
      ? "Conectado ao PowerPoint; estado no slide e pixels no cache local."
      : "Conectado ao PowerPoint; o estado será salvo neste slide.");
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
    runtime.elements.importProgressText.textContent = detail.message || "Convertendo exame…";
    setStatus(detail.message || "Convertendo exame DICOM…");
    if (detail.phase !== "complete") setLoading(detail.message || "Convertendo exame DICOM…");
  }

  async function importLocalFiles(files) {
    const selected = Array.from(files || []);
    if (!selected.length) return;
    if (!global.DicomSlidesImporter) {
      setLoading("O módulo de importação DICOM não foi carregado.", true);
      return;
    }

    if (runtime.importAbortController) runtime.importAbortController.abort();
    const controller = new AbortController();
    runtime.importAbortController = controller;
    setImportBusy(true);
    runtime.elements.importProgress.hidden = false;
    runtime.elements.importProgressBar.value = 0;
    runtime.elements.importProgressText.textContent = "Preparando arquivos…";
    setLoading("Preparando importação DICOM…");

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
      await renderViewer(config);
      setSettingsOpen(false);
      runtime.elements.importProgress.hidden = true;
      const cacheText = result.persisted ? "guardado no cache local" : "disponível somente nesta sessão";
      const warningText = result.warnings.length ? ` ${result.warnings.length} alerta(s) de revisão.` : "";
      setStatus(`Importado: ${result.study.seriesCount} série(s), ${formatBytes(result.totalCompressedBytes)} comprimidos; ${cacheText}.${warningText}`);
    } catch (error) {
      if (error?.name === "AbortError") {
        clearLoading();
        setStatus("Importação cancelada.");
        runtime.elements.importProgressText.textContent = "Importação cancelada.";
      } else {
        setLoading(error.message || String(error), true);
        setStatus("Falha ao converter os arquivos DICOM.");
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

  function bindUi() {
    runtime.elements.settingsButton.addEventListener("click", () => {
      setSettingsOpen(runtime.elements.settingsPanel.hidden);
    });
    runtime.elements.closeSettingsButton.addEventListener("click", () => setSettingsOpen(false));
    runtime.elements.catalogId.addEventListener("change", (event) => {
      applyCatalogDefaults(event.target.value);
      syncSourceVisibility(runtime.config);
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

    runtime.elements.importFilesButton.addEventListener("click", () => runtime.elements.importFilesInput.click());
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
      runtime.config = normalizeConfig(defaultConfig(catalog[0]?.id));
      syncForm(runtime.config);
      await renderViewer(runtime.config);
      setStatus("Pacote local removido; estudo de demonstração restaurado.");
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
    if (global.DicomSlidesImporter?.ready) await global.DicomSlidesImporter.ready;
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
    version: "1.1.0",
    normalizeConfig,
    validateStudySource,
    renderViewer,
    importLocalFiles,
    getState: () => serializeConfig(),
  });
})(window);
