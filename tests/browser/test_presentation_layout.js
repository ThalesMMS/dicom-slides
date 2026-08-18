#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const { chromium } = require("playwright");

const baseUrl = process.env.DICOM_SLIDE_BASE_URL || "http://127.0.0.1:8765";
const slideIds = [
  "01-introduction",
  "02-visible-human",
  "03-mri-dir",
  "03a-powerpoint-web",
  "03b-powerpoint-upload",
  "03c-powerpoint-macos",
  "01a-ai-setup",
  "01b-ai-prompt",
  "01c-ai-review",
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
          studyCard: document.querySelector(".study-card")
            ? {
                scrollHeight: document.querySelector(".study-card").scrollHeight,
                clientHeight: document.querySelector(".study-card").clientHeight,
              }
            : null,
          reviewItems: Array.from(document.querySelectorAll(".review-steps li"), (item) => {
            const rect = item.getBoundingClientRect();
            return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right };
          }),
          installImage: document.querySelector(".install-visual img")
            ? {
                naturalWidth: document.querySelector(".install-visual img").naturalWidth,
                objectFit: getComputedStyle(document.querySelector(".install-visual img")).objectFit,
                objectPosition: getComputedStyle(document.querySelector(".install-visual img")).objectPosition,
              }
            : null,
        }));
        assert.equal(layout.language, "en", `${slideIds[index]} must declare English`);
        assert.ok(layout.scrollWidth <= layout.clientWidth + 1, `${slideIds[index]} overflows horizontally`);
        assert.ok(layout.scrollHeight <= layout.clientHeight + 1, `${slideIds[index]} overflows vertically`);
        if (viewport.width > 980 && layout.studyCard) {
          assert.ok(
            layout.studyCard.scrollHeight <= layout.studyCard.clientHeight + 1,
            `${slideIds[index]} study card requires internal scrolling on a desktop viewport`
          );
        }
        if (slideIds[index] === "01c-ai-review") {
          assert.equal(layout.reviewItems.length, 3, "Review slide must contain exactly three checklist items");
          const [first, second, third] = layout.reviewItems;
          assert.ok(second.top >= first.bottom - 1, "Second review item must sit below the first");
          assert.ok(third.top >= second.bottom - 1, "Third review item must sit below the second");
          assert.ok(
            [second, third].every((item) =>
              Math.abs(item.left - first.left) <= 1 && Math.abs(item.right - first.right) <= 1
            ),
            "All review items must use the same single-column width"
          );
        }
        if (slideIds[index].startsWith("03") && slideIds[index].includes("powerpoint")) {
          assert.ok(layout.installImage, `${slideIds[index]} must include its PowerPoint screenshot`);
          assert.ok(layout.installImage.naturalWidth > 0, `${slideIds[index]} screenshot must load`);
          assert.equal(layout.installImage.objectFit, "contain", `${slideIds[index]} screenshot must remain uncropped`);
          assert.match(layout.installImage.objectPosition, /50%/, `${slideIds[index]} screenshot must be vertically centered`);
        }
      }
      assert.deepEqual(pageErrors, []);
      await page.close();
    }
    console.log("OK: ten English slides fit the desktop and narrow presentation viewports");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
