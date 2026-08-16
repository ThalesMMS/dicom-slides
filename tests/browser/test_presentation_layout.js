#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const { chromium } = require("playwright");

const baseUrl = process.env.DICOM_SLIDE_BASE_URL || "http://127.0.0.1:8765";
const slideIds = [
  "01-introduction",
  "01a-ai-setup",
  "01b-ai-prompt",
  "01c-ai-review",
  "02-visible-human",
  "03-mri-dir",
  "04-references",
];

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 900, height: 760 }]) {
      const page = await browser.newPage({ viewport });
      const pageErrors = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      for (let index = 0; index < slideIds.length; index += 1) {
        await page.goto(`${baseUrl}/presentation/index.html#${index + 1}`, { waitUntil: "load" });
        const section = page.locator(".deck-slide.active");
        await section.waitFor();
        assert.equal(await section.getAttribute("data-slide-id"), slideIds[index]);
        const handle = await section.locator("iframe").elementHandle();
        const frame = await handle.contentFrame();
        await frame.waitForURL(new RegExp(`/presentation/slides/${slideIds[index]}/index\\.html$`));
        await frame.waitForLoadState("load");
        const layout = await frame.evaluate(() => ({
          language: document.documentElement.lang,
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
          scrollHeight: document.documentElement.scrollHeight,
          clientHeight: document.documentElement.clientHeight,
        }));
        assert.equal(layout.language, "en", `${slideIds[index]} must declare English`);
        assert.ok(layout.scrollWidth <= layout.clientWidth + 1, `${slideIds[index]} overflows horizontally`);
        assert.ok(layout.scrollHeight <= layout.clientHeight + 1, `${slideIds[index]} overflows vertically`);
      }
      assert.deepEqual(pageErrors, []);
      await page.close();
    }
    console.log("OK: seven English slides fit the desktop and narrow presentation viewports");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
