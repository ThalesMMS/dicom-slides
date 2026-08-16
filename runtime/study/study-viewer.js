(function (global) {
  "use strict";

  const STYLE_TEXT = `
.dss-root{width:100%;height:100%;min-height:320px;display:grid;grid-template-rows:auto minmax(0,1fr);overflow:hidden;background:#05070a;color:#eef5fa;font:500 13px/1.3 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
.dss-seriesbar{min-height:50px;display:grid;grid-template-columns:minmax(150px,1fr) auto minmax(240px,1.5fr) auto auto auto;align-items:center;gap:7px;padding:7px 9px;border-bottom:1px solid #27313b;background:linear-gradient(180deg,#17202a,#0d1218)}
.dss-study{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:800;color:#e6f2f8}
.dss-label{color:#91a4b3;font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase}
.dss-select,.dss-button{height:32px;border:1px solid #34414d;border-radius:7px;background:#17202a;color:#e5edf3;font:inherit}
.dss-select{min-width:0;width:100%;padding:0 30px 0 9px;cursor:pointer}
.dss-button{box-sizing:border-box;inline-size:34px;min-inline-size:34px;max-inline-size:34px;padding:0;display:inline-grid;place-items:center;justify-self:center;cursor:pointer;font-weight:800}.dss-button:hover:not(:disabled){border-color:#38bdf8;background:#20303c}.dss-button:disabled{opacity:.4;cursor:default}
.dss-count{min-width:56px;color:#9eb0bd;text-align:right;font-variant-numeric:tabular-nums}
.dss-viewer{min-height:0;overflow:hidden;background:#000}
.dss-error{display:grid;place-items:center;height:100%;padding:24px;background:#14080a;color:#ffd5dc;text-align:center;white-space:pre-wrap}
@media(max-width:720px){.dss-seriesbar{grid-template-columns:auto minmax(0,1fr) auto auto}.dss-study{display:none}.dss-label{display:none}.dss-count{min-width:42px}}
`;

  const scriptPromises = new Map();

  function ensureStyles(root) {
    const owner = root instanceof Document || root instanceof ShadowRoot ? root : document;
    if (owner.querySelector("style[data-dicom-study-viewer-style]")) return;
    const style = document.createElement("style");
    style.dataset.dicomStudyViewerStyle = "true";
    style.textContent = STYLE_TEXT;
    if (owner instanceof Document) owner.head.appendChild(style);
    else owner.appendChild(style);
  }

  function loadScript(url) {
    const absolute = new URL(url, document.baseURI).href;
    if (scriptPromises.has(absolute)) return scriptPromises.get(absolute);
    const promise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = absolute;
      script.async = true;
      script.onload = () => resolve(absolute);
      script.onerror = () => reject(new Error(`Could not load study manifest: ${absolute}`));
      document.head.appendChild(script);
    });
    scriptPromises.set(absolute, promise);
    return promise;
  }

  async function loadStudy(studyId, manifestUrl) {
    const registry = global.__DICOM_SLIDE_STUDIES__ || {};
    if (!registry[studyId]) await loadScript(manifestUrl);
    const study = (global.__DICOM_SLIDE_STUDIES__ || {})[studyId];
    if (!study) throw new Error(`Study manifest did not register “${studyId}”.`);
    if (!Array.isArray(study.series) || study.series.length === 0) {
      throw new Error(`Study “${studyId}” has no series.`);
    }
    return study;
  }

  class StudyViewer {
    constructor(container, options) {
      if (!(container instanceof Element)) throw new TypeError("StudyViewer requires a DOM container.");
      this.container = container;
      this.options = Object.assign({ initialSeries: null }, options || {});
      if (!this.options.studyId || !this.options.manifestUrl) {
        throw new TypeError("StudyViewer requires studyId and manifestUrl options.");
      }
      this.study = null;
      this.viewer = null;
      this.seriesIndex = -1;
      this.expanded = false;
      this.loadToken = 0;
      this.destroyed = false;
      this._build();
      this._bind();
      this.ready = this._initialize();
    }

    _build() {
      ensureStyles(this.container.getRootNode ? this.container.getRootNode() : document);
      const root = document.createElement("div");
      root.className = "dss-root";
      root.innerHTML = `
        <div class="dss-seriesbar">
          <div class="dss-study">Loading study…</div>
          <span class="dss-label">Series</span>
          <select class="dss-select" aria-label="Study series" disabled></select>
          <button class="dss-button" type="button" data-action="previous-series" aria-label="Previous series" disabled>←</button>
          <button class="dss-button" type="button" data-action="next-series" aria-label="Next series" disabled>→</button>
          <span class="dss-count" aria-live="polite"></span>
        </div>
        <div class="dss-viewer"></div>`;
      this.container.replaceChildren(root);
      this.root = root;
      this.studyTitle = root.querySelector(".dss-study");
      this.select = root.querySelector(".dss-select");
      this.previousButton = root.querySelector("[data-action='previous-series']");
      this.nextButton = root.querySelector("[data-action='next-series']");
      this.count = root.querySelector(".dss-count");
      this.viewerHost = root.querySelector(".dss-viewer");
    }

    _bind() {
      this.select.addEventListener("change", () => this.setSeries(this.select.value));
      this.previousButton.addEventListener("click", () => this.setSeries(this._neighborIndex(-1)));
      this.nextButton.addEventListener("click", () => this.setSeries(this._neighborIndex(1)));
    }

    async _initialize() {
      try {
        this.study = await loadStudy(this.options.studyId, this.options.manifestUrl);
        this.studyTitle.textContent = this.study.title || this.options.studyId;
        this.select.replaceChildren();
        this.study.series.forEach((series, index) => {
          const option = document.createElement("option");
          option.value = series.id;
          option.textContent = `${series.number || index + 1} · ${series.title} · ${series.slices} images`;
          option.disabled = series.available === false;
          this.select.appendChild(option);
        });
        const firstAvailableIndex = this.study.series.findIndex((series) => series.available !== false);
        if (firstAvailableIndex < 0) {
          const reason = this.study.series.find((series) => series.unavailableReason)?.unavailableReason
            || "Pixel payload is not included for this study.";
          throw new Error(reason);
        }
        const requested = this.options.initialSeries;
        const requestedIndex = requested == null
          ? -1
          : this.study.series.findIndex((series) => series.id === requested || String(series.number) === String(requested));
        const initialIndex = requestedIndex >= 0 && this.study.series[requestedIndex].available !== false
          ? requestedIndex
          : firstAvailableIndex;
        await this.setSeries(initialIndex);
        this.root.dispatchEvent(new CustomEvent("studyready", { bubbles: true, detail: this.getState() }));
        return this;
      } catch (error) {
        this._showError(error);
        throw error;
      }
    }

    async setSeries(value) {
      if (!this.study || this.destroyed) return;
      let index = typeof value === "number"
        ? Math.round(value)
        : this.study.series.findIndex((series) => series.id === value || String(series.number) === String(value));
      index = Math.max(0, Math.min(this.study.series.length - 1, index));
      const series = this.study.series[index];
      if (!series) return;
      if (series.available === false) {
        throw new Error(series.unavailableReason || `Series “${series.title}” is unavailable.`);
      }
      const token = ++this.loadToken;
      if (this.viewer) this.viewer.destroy();
      this.viewer = null;
      this.seriesIndex = index;
      this.select.value = series.id;
      this._updateSeriesControls(true);

      try {
        const viewer = new global.DicomSlideViewer.Viewer(this.viewerHost, {
          caseId: series.caseId,
          manifestUrl: new URL(series.manifest, this.study.baseUrl).href,
        });
        this.viewer = viewer;
        await viewer.ready;
        if (this.destroyed || token !== this.loadToken) {
          viewer.destroy();
          return;
        }
        viewer.setExpanded(this.expanded);
        this._updateSeriesControls(false);
        this.root.dispatchEvent(new CustomEvent("serieschange", { bubbles: true, detail: this.getState() }));
        return viewer;
      } catch (error) {
        if (token === this.loadToken) this._showError(error);
        throw error;
      }
    }

    _updateSeriesControls(loading) {
      const total = this.study ? this.study.series.length : 0;
      this.previousButton.disabled = loading || this._neighborIndex(-1) < 0;
      this.nextButton.disabled = loading || this._neighborIndex(1) < 0;
      this.select.disabled = loading || !this.study.series.some((series) => series.available !== false);
      this.count.textContent = total ? `${this.seriesIndex + 1} / ${total}` : "";
    }

    _neighborIndex(direction) {
      if (!this.study) return -1;
      for (let index = this.seriesIndex + direction; index >= 0 && index < this.study.series.length; index += direction) {
        if (this.study.series[index].available !== false) return index;
      }
      return -1;
    }

    _showError(error) {
      this.viewerHost.innerHTML = `<div class="dss-error"></div>`;
      this.viewerHost.firstElementChild.textContent = `Failed to load study\n${error && error.message ? error.message : String(error)}`;
      console.error(error);
    }

    getState() {
      const series = this.study && this.study.series[this.seriesIndex];
      return Object.assign(
        {
          studyId: this.options.studyId,
          studyTitle: this.study ? this.study.title : null,
          seriesIndex: this.seriesIndex,
          seriesId: series ? series.id : null,
          seriesNumber: series ? series.number : null,
          seriesTitle: series ? series.title : null,
          totalSeries: this.study ? this.study.series.length : 0,
        },
        this.viewer ? this.viewer.getState() : {}
      );
    }

    setSlice(value) { return this.viewer && this.viewer.setSlice(value); }
    setPreset(value) { return this.viewer && this.viewer.setPreset(value); }
    setMode(value) { return this.viewer && this.viewer.setMode(value); }
    setWindow(center, width) { return this.viewer && this.viewer.setWindow(center, width); }
    setActiveTool(value) { return this.viewer && this.viewer.setActiveTool(value); }
    setExpanded(value) {
      this.expanded = Boolean(value);
      return this.viewer && this.viewer.setExpanded(this.expanded);
    }
    reset() { return this.viewer && this.viewer.reset(); }

    destroy() {
      this.destroyed = true;
      this.loadToken += 1;
      if (this.viewer) this.viewer.destroy();
      this.viewer = null;
      this.container.replaceChildren();
    }
  }

  global.DicomSlideStudy = { StudyViewer, loadStudy, version: "2.0.0" };
})(window);
