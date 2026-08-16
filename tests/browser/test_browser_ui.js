#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const { chromium } = require("playwright");

const baseUrl = process.env.DICOM_SLIDE_BASE_URL || "http://127.0.0.1:8765";

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    const drag = async (locator, dx, dy) => {
      const box = await locator.boundingBox();
      assert.ok(box && box.width > 10 && box.height > 10, "interactive canvas must be visible");
      const startX = box.x + box.width / 2;
      const startY = box.y + box.height / 2;
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(startX + dx, startY + dy, { steps: 4 });
      await page.mouse.up();
    };

    await page.goto(`${baseUrl}/presentation/index.html#1.5`, { waitUntil: "load" });
    await page.locator(".deck-slide.active").waitFor({ timeout: 3000 });
    assert.equal(
      await page.locator(".deck-slide.active").getAttribute("data-slide-id"),
      "01-introduction",
      "Fractional hashes must fall back to the first slide"
    );

    await page.goto(`${baseUrl}/tests/browser/component-smoke.html`, { waitUntil: "load" });
    await page.waitForFunction(() => customElements.get("dicom-study-viewer"));
    const componentResult = await page.locator("dicom-study-viewer").evaluate(async (element) => {
      await element.ready;
      return {
        state: element.getState(),
        seriesOptions: element.shadowRoot.querySelectorAll('.dss-select option').length,
        modes: element.shadowRoot.querySelectorAll('button[data-view-mode]').length,
      };
    });
    assert.equal(componentResult.seriesOptions, 4);
    assert.equal(componentResult.modes, 3);
    assert.equal(String(componentResult.state.seriesNumber), "1");
    assert.equal(await page.evaluate(() => window.dicomReadyCount), 1, "component readiness must be emitted once per load");
    assert.equal(await page.locator('script[data-dicom-slide-runtime-module]').count(), 10, "duplicate entry scripts must reuse one module load");
    const forwardingResult = await page.locator("dicom-study-viewer").evaluate(async (element) => {
      let seriesEvents = 0;
      element.addEventListener("dicom-series-change", () => { seriesEvents += 1; });
      await element.setSeries("2");
      const first = String(element.getState().seriesNumber);
      await element.setSeries("1");
      return { first, second: String(element.getState().seriesNumber), seriesEvents };
    });
    assert.deepEqual(forwardingResult, { first: "2", second: "1", seriesEvents: 2 });

    await page.goto(`${baseUrl}/tests/browser/iframe-host.html`, { waitUntil: "load" });
    await page.waitForFunction(() => window.adapterMessages.some((message) => message.type === "ready"));
    const adapterFrame = page.frames().find((frame) => /\/runtime\/iframe\/index\.html/.test(frame.url()));
    assert.ok(adapterFrame, "iframe adapter must load inside its host page");
    await adapterFrame.waitForFunction(() => window.viewer && window.viewer.viewer && window.viewer.viewer.manifest);
    await page.evaluate(() => window.postAdapterCommand("setMode", { value: "mpr" }));
    await adapterFrame.waitForFunction(() => window.viewer.getState().mode === "mpr");

    await adapterFrame.evaluate(() => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { source: "dicom-slide-host", command: "setMode", value: "stack" },
        origin: "https://evil.invalid",
        source: window.parent,
      }));
    });
    await page.waitForTimeout(50);
    assert.equal(await adapterFrame.evaluate(() => window.viewer.getState().mode), "mpr", "Wrong origins must be ignored");

    await adapterFrame.evaluate(() => {
      window.dispatchEvent(new MessageEvent("message", {
        data: { source: "dicom-slide-host", command: "setMode", value: "stack" },
        origin: window.location.origin,
        source: window,
      }));
    });
    await page.waitForTimeout(50);
    assert.equal(await adapterFrame.evaluate(() => window.viewer.getState().mode), "mpr", "Non-parent sources must be ignored");

    await adapterFrame.evaluate(() => {
      document.querySelector("dicom-study-viewer").setMode = () => Promise.reject(new Error("adapter command failed"));
    });
    await page.evaluate(() => window.postAdapterCommand("setMode", { value: "stack" }));
    await page.waitForFunction(() => window.adapterMessages.some((message) =>
      message.type === "error" && message.state && message.state.message === "adapter command failed"));

    await page.goto(`${baseUrl}/presentation/index.html#5`, { waitUntil: "load" });
    const activeSlideFrame = page.locator('.deck-slide.active iframe');
    await activeSlideFrame.waitFor({ timeout: 3000 });
    assert.match(await activeSlideFrame.getAttribute("src"), /slides\/02-visible-human\/index\.html$/);
    const activeSlide = page.frames().find((frame) => /slides\/02-visible-human\/index\.html$/.test(frame.url()));
    assert.ok(activeSlide, "the active catalog slide must load in its own iframe");
    await activeSlide.locator("dicom-study-viewer").evaluate((element) => element.ready);
    assert.equal(await activeSlide.locator("dicom-study-viewer").evaluate((element) => element.getState().mode), "stack");
    await activeSlide.locator("[data-action='expand']").click();
    await page.waitForFunction(() => document.body.classList.contains("viewer-is-expanded"));
    assert.equal(await activeSlide.locator(".study-slide").evaluate((element) => element.classList.contains("viewer-expanded")), true);
    assert.equal(await activeSlide.locator("[data-action='expand']").getAttribute("aria-pressed"), "true");
    await activeSlide.locator("[data-action='expand']").click();
    await page.waitForFunction(() => !document.body.classList.contains("viewer-is-expanded"));

    await page.goto(
      `${baseUrl}/runtime/iframe/index.html?study-id=mri-dir-t1-mr&study=../../exams/library/mri-dir-t1-mr/study.js&series=1`,
      { waitUntil: "load" }
    );
    await page.waitForFunction(() => window.viewer && window.viewer.viewer && window.viewer.viewer.manifest);
    const seriesOptions = await page.locator('select[aria-label="Study series"] option').allTextContents();
    assert.deepEqual(seriesOptions.map((label) => label.trim()), [
      "1 · T1Post1 · 14 images",
      "2 · T1Post2 · 14 images",
      "3 · T1Post3 · 14 images",
      "4 · T1Post4 · 14 images",
    ]);

    const modeLabels = await page.locator("button[data-view-mode]").allTextContents();
    assert.deepEqual(modeLabels.map((label) => label.trim()), ["2D", "MPR", "3D"]);
    assert.equal(await page.locator('button[data-view-mode="stack"]').getAttribute("aria-pressed"), "true");

    await page.locator('button[data-view-mode="mpr"]').click();
    await page.waitForFunction(() => window.viewer.viewer.volumeView && window.viewer.viewer.getState().mode === "mpr");
    const mprTools = await page.locator('[data-volume-panel="mpr"] [data-volume-tool]').allTextContents();
    assert.deepEqual(mprTools.map((label) => label.trim()), ["Crosshair", "W/L", "Pan", "Zoom", "Scroll"]);
    const axialCanvas = page.locator('[data-volume-view="axial"] canvas');

    const mprWindowBefore = await page.evaluate(() => {
      const state = window.viewer.viewer.volumeView.getState();
      return { center: state.center, width: state.width };
    });
    await page.locator('[data-volume-panel="mpr"] [data-volume-tool="window"]').click();
    await drag(axialCanvas, 52, 28);
    const mprWindowAfter = await page.evaluate(() => {
      const state = window.viewer.viewer.volumeView.getState();
      return { center: state.center, width: state.width };
    });
    assert.notDeepEqual(mprWindowAfter, mprWindowBefore, "MPR W/L drag must change windowing");

    await page.locator('[data-volume-panel="mpr"] [data-volume-tool="pan"]').click();
    await drag(axialCanvas, 38, 24);
    const mprPan = await page.evaluate(() => window.viewer.viewer.volumeView.getState().mprTransforms.axial);
    assert.notEqual(mprPan.panX, 0, "MPR Pan must change horizontal offset");
    assert.notEqual(mprPan.panY, 0, "MPR Pan must change vertical offset");

    await page.locator('[data-volume-panel="mpr"] [data-volume-tool="zoom"]').click();
    await drag(axialCanvas, 0, -42);
    const mprZoom = await page.evaluate(() => window.viewer.viewer.volumeView.getState().mprTransforms.axial.zoom);
    assert.notEqual(mprZoom, 1, "MPR Zoom must change the plane scale");

    await page.locator('button[data-view-mode="volume"]').click();
    await page.waitForFunction(() => window.viewer.viewer.volumeView && window.viewer.viewer.getState().mode === "volume");
    const volumeTools = await page.locator('[data-volume-panel="volume"] [data-volume-tool]').allTextContents();
    assert.deepEqual(volumeTools.map((label) => label.trim()), ["W/L", "Pan", "Zoom", "Rotate"]);
    const transferLabels = await page.locator('[data-volume-control="transfer-function"] option').allTextContents();
    assert.deepEqual(
      transferLabels.map((label) => label.trim()),
      ["Angio", "Airways", "Bones and skin 1", "Bones and skin 2", "Bones and skin 3", "Bones B/W", "Skin B/W"]
    );

    assert.equal(
      await page.evaluate(() => Boolean(window.viewer.viewer.volumeView.volumeRenderer && !window.viewer.viewer.volumeView.volumeRenderer.failed)),
      true,
      "3D WebGL2 renderer and transfer-function shader must initialize"
    );
    const volumeCanvas = page.locator('[data-volume-view="volume"] canvas');
    const volumeWindowBefore = await page.evaluate(() => {
      const state = window.viewer.viewer.volumeView.getState();
      return { center: state.center, width: state.width };
    });
    await page.locator('[data-volume-panel="volume"] [data-volume-tool="window"]').click();
    await drag(volumeCanvas, 48, 26);
    const volumeWindowAfter = await page.evaluate(() => {
      const state = window.viewer.viewer.volumeView.getState();
      return { center: state.center, width: state.width };
    });
    assert.notDeepEqual(volumeWindowAfter, volumeWindowBefore, "3D W/L drag must change windowing");

    await page.locator('[data-volume-panel="volume"] [data-volume-tool="pan"]').click();
    await drag(volumeCanvas, 36, 21);
    const volumePan = await page.evaluate(() => {
      const state = window.viewer.viewer.volumeView.getState();
      return [state.volumePanX, state.volumePanY];
    });
    assert.notDeepEqual(volumePan, [0, 0], "3D Pan must change the camera offset");

    const volumeZoomBefore = await page.evaluate(() => window.viewer.viewer.volumeView.getState().zoom);
    await page.locator('[data-volume-panel="volume"] [data-volume-tool="zoom"]').click();
    await drag(volumeCanvas, 0, -40);
    const volumeZoomAfter = await page.evaluate(() => window.viewer.viewer.volumeView.getState().zoom);
    assert.notEqual(volumeZoomAfter, volumeZoomBefore, "3D Zoom must change magnification");

    const rotationBefore = await page.evaluate(() => {
      const state = window.viewer.viewer.volumeView.getState();
      return [state.yaw, state.pitch];
    });
    await page.locator('[data-volume-panel="volume"] [data-volume-tool="rotate"]').click();
    await drag(volumeCanvas, 44, 22);
    const rotationAfter = await page.evaluate(() => {
      const state = window.viewer.viewer.volumeView.getState();
      return [state.yaw, state.pitch];
    });
    assert.notDeepEqual(rotationAfter, rotationBefore, "3D Rotate must change yaw and pitch");

    const preservedBefore = await page.evaluate(() => {
      const state = window.viewer.viewer.volumeView.getState();
      return [state.zoom, state.volumePanX, state.volumePanY, state.yaw, state.pitch];
    });
    await page.locator('[data-volume-control="transfer-function"]').selectOption("bones-bw");
    const transferState = await page.evaluate(() => window.viewer.viewer.volumeView.getState());
    assert.equal(transferState.transferFunctionId, "bones-bw");
    assert.deepEqual(
      [transferState.zoom, transferState.volumePanX, transferState.volumePanY, transferState.yaw, transferState.pitch],
      preservedBefore,
      "transfer selection must preserve the camera state"
    );
    // The preset supplies its own window (applyPreset): 3D W/L uses its native
    // domain, where a W/L drag sweeps the preset through the volume.
    const presetWindow = await page.evaluate(() => {
      const view = window.viewer.viewer.volumeView;
      return window.DicomSlideVolume.transferFunctionWindow("bones-bw", view.transferDomain);
    });
    assert.equal(transferState.center, presetWindow.center);
    assert.equal(transferState.width, presetWindow.width);

    // Sliders start hidden; the "Sliders" toggle reveals them.
    assert.equal(await page.locator('[data-volume-control="volume-shift"]').isVisible(), false);
    await page.locator("[data-volume-action='toggle-sliders']").click();
    await page.locator('[data-volume-control="volume-shift"]').fill("400");
    await page.locator('[data-volume-control="volume-shift"]').dispatchEvent("input");
    assert.equal(await page.evaluate(() => window.viewer.viewer.volumeView.getState().volumeShift), 400);
    await page.locator("[data-volume-action='toggle-sliders']").click();

    const shadingButton = page.locator("[data-volume-action='shading']");
    assert.equal(await shadingButton.getAttribute("aria-pressed"), "true", "Bones B/W recommends shading");
    await shadingButton.click();
    assert.equal(await page.evaluate(() => window.viewer.viewer.volumeView.getState().shading), false);
    await page.locator('[data-volume-control="transfer-function"]').selectOption("airways");
    assert.equal(
      await page.evaluate(() => window.viewer.viewer.volumeView.getState().shading),
      false,
      "Airways does not recommend shading"
    );
    if (process.env.DICOM_SLIDE_SCREENSHOT) {
      await page.screenshot({ path: process.env.DICOM_SLIDE_SCREENSHOT, fullPage: true });
    }

    await page.locator('button[data-view-mode="stack"]').click();
    assert.equal(await page.locator('button[data-view-mode="stack"]').getAttribute("aria-pressed"), "true");
    const expectedSeries = [
      ["series-1-t1post1-4d84985", "1", 14],
      ["series-2-t1post2-3381f4c", "2", 14],
      ["series-3-t1post3-2b72935", "3", 14],
      ["series-4-t1post4-9720507", "4", 14],
    ];
    for (const [seriesId, seriesNumber, slices] of expectedSeries) {
      await page.locator('select[aria-label="Study series"]').selectOption(seriesId);
      await page.waitForFunction(
        ([number, count]) => {
          const state = window.viewer.getState();
          return String(state.seriesNumber) === number && state.totalSlices === count && !window.viewer.select.disabled;
        },
        [seriesNumber, slices]
      );
    }
    assert.deepEqual(pageErrors, []);

    console.log("OK: four-series switching, mode selector, MPR/3D tool drags, and transfer-function shader passed");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
