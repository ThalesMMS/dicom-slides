#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..", "..");

(async () => {
  const browser = await chromium.launch({ headless: true, args: ["--allow-file-access-from-files"] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(pathToFileURL(path.join(root, "index.html")).href, { waitUntil: "load" });
    await page.waitForURL(/presentation\/index\.html$/);
    await page.locator("#next-slide").click();
    const frameElement = page.locator('.deck-slide.active iframe');
    await frameElement.waitFor();
    assert.match(await frameElement.getAttribute("src"), /slides\/02-visible-human\/index\.html$/);
    const slide = page.frames().find((frame) => /slides\/02-visible-human\/index\.html$/.test(frame.url()));
    assert.ok(slide, "file:// deck must load the independent medical slide");
    const state = await slide.locator("dicom-study-viewer").evaluate(async (element) => {
      await element.ready;
      await element.setMode("mpr");
      return {
        mode: element.getState().mode,
        modes: element.shadowRoot.querySelectorAll("button[data-view-mode]").length,
      };
    });
    assert.deepEqual(state, { mode: "mpr", modes: 3 });

    await page.goto(pathToFileURL(path.join(root, "tests", "browser", "iframe-host.html")).href, { waitUntil: "load" });
    await page.waitForFunction(() => window.adapterMessages.some((message) => message.type === "ready"));
    const adapterFrame = page.frames().find((frame) => /runtime\/iframe\/index\.html/.test(frame.url()));
    assert.ok(adapterFrame, "file:// iframe adapter must load");
    await page.evaluate(() => window.postAdapterCommand("setMode", { value: "mpr" }));
    await adapterFrame.waitForFunction(() => window.viewer && window.viewer.getState().mode === "mpr");
    assert.deepEqual(pageErrors, []);
    console.log("OK: root double-click flow and complete component loading passed over file://");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
