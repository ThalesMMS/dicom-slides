#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..", "..");

function existing(relativePath) {
  const absolutePath = path.join(root, ...relativePath.split("/"));
  assert.ok(fs.existsSync(absolutePath), `missing public project path: ${relativePath}`);
  return absolutePath;
}

function loadCatalog() {
  const filename = existing("presentation/slides.js");
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), sandbox, { filename });
  return Array.from(sandbox.window.DicomSlideSlides, (slide) => ({ ...slide }));
}

existing("runtime/dicom-slide.js");
existing("runtime/components/dicom-study-viewer.js");
existing("exams/inbox/README.md");
existing("exams/library");
existing("presentation/index.html");
assert.equal(fs.existsSync(path.join(root, "data")), false, "processed studies must not remain under data/");
assert.match(fs.readFileSync(existing("exams/inbox/.gitignore"), "utf8"), /^\*$/m, "raw inbox contents must be ignored");

const catalog = loadCatalog();
assert.ok(Array.isArray(catalog), "slide catalog must expose an array");
assert.deepEqual(
  catalog.map((slide) => slide.id),
  [
    "01-introduction",
    "02-visible-human",
    "03-mri-dir",
    "03a-powerpoint-web",
    "03b-powerpoint-upload",
    "03c-powerpoint-macos",
    "01a-ai-setup",
    "01b-ai-prompt",
    "03d-powerpoint-windows",
    "03e-powerpoint-windows-install",
    "01c-ai-review",
    "04-references",
  ],
  "presentation must publish the approved twelve-slide narrative"
);

const slideFiles = catalog.map((slide) => {
  assert.match(slide.id, /^[a-z0-9-]+$/, "slide id must be URL- and folder-friendly");
  assert.equal(typeof slide.title, "string");
  assert.ok(slide.title.trim(), "slide title must not be empty");
  assert.match(slide.src, /^slides\/[a-z0-9-]+\/index\.html$/);
  return existing(`presentation/${slide.src}`);
});

const slideHtmlById = new Map(catalog.map((slide, index) => [
  slide.id,
  fs.readFileSync(slideFiles[index], "utf8"),
]));
for (const [id, html] of slideHtmlById) {
  assert.match(html, /<html lang="en">/, `${id} must declare English`);
}
assert.match(slideHtmlById.get("01a-ai-setup"), /How to use with AI-generated web slides/);
assert.match(slideHtmlById.get("03a-powerpoint-web"), /Home.*Add-ins.*Advanced/s);
assert.match(slideHtmlById.get("03a-powerpoint-web"), /powerpoint-addins-advanced\.png/);
assert.match(slideHtmlById.get("03b-powerpoint-upload"), /Upload My Add-in/);
assert.match(slideHtmlById.get("03b-powerpoint-upload"), /powerpoint-upload-addin-manifest\.png/);
assert.match(slideHtmlById.get("03c-powerpoint-macos"), /Library\/Containers\/com\.microsoft\.Powerpoint\/Data\/Documents\/wef/);
assert.match(slideHtmlById.get("03c-powerpoint-macos"), /dicom-slides-powerpoint-plugin\.png/);
assert.match(slideHtmlById.get("03d-powerpoint-windows"), /small XML file.*does not contain.*exam/s);
assert.match(slideHtmlById.get("03d-powerpoint-windows"), /ordinary folder/i);
assert.match(slideHtmlById.get("03d-powerpoint-windows"), /Trusted Add-in Catalog.*shared folder/s);
assert.match(slideHtmlById.get("03e-powerpoint-windows-install"), /Trusted Add-in Catalogs/);
assert.match(slideHtmlById.get("03e-powerpoint-windows-install"), /SHARED FOLDER/);
assert.match(slideHtmlById.get("03e-powerpoint-windows-install"), /create-a-network-shared-folder-catalog-for-task-pane-and-content-add-ins/);
for (const id of ["03a-powerpoint-web", "03c-powerpoint-macos", "03e-powerpoint-windows-install"]) {
  const html = slideHtmlById.get(id);
  assert.match(html, /Right-click/, `${id} must tell readers to right-click the manifest link`);
  assert.match(html, /Download Linked File As/, `${id} must name the browser download command`);
  assert.match(html, /Save link as/, `${id} must include the common alternate browser label`);
}
assert.match(slideHtmlById.get("01b-ai-prompt"), /https:\/\/github\.com\/ThalesMMS\/dicom-slides/);
assert.match(slideHtmlById.get("01b-ai-prompt"), /PATH TO MY DICOM FOLDER OR ZIP/);
assert.match(slideHtmlById.get("01c-ai-review"), /Check the result before you share it/);
assert.match(slideHtmlById.get("01c-ai-review"), /not an anonymization certificate/i);
assert.match(slideHtmlById.get("04-references"), /Courtesy of the U\.S\. National Library of Medicine/);
assert.match(slideHtmlById.get("04-references"), /10\.7937\/K9\/TCIA\.2018\.3f08iejt/);
assert.match(slideHtmlById.get("04-references"), /Santos, T\. M\. M\. \(2026\)/);

assert.equal(new Set(slideFiles).size, slideFiles.length, "each catalog item must point to its own HTML file");
assert.equal(
  fs.readdirSync(path.join(root, "presentation", "slides"), { recursive: true })
    .filter((entry) => entry.endsWith("index.html")).length,
  catalog.length,
  "every slide HTML must be visible in the catalog"
);

for (const filename of slideFiles) {
  const html = fs.readFileSync(filename, "utf8");
  const localReferences = [...html.matchAll(/(?:src|href)=["']([^"'#?]+)["']/g)].map((match) => match[1]);
  for (const reference of localReferences) {
    if (/^(?:[a-z]+:|\/\/)/i.test(reference)) continue;
    assert.ok(
      fs.existsSync(path.resolve(path.dirname(filename), reference)),
      `${path.relative(root, filename)} has a broken local reference: ${reference}`
    );
  }
}

const rootReadme = fs.readFileSync(existing("README.md"), "utf8");
for (const publicWorkflow of ["<dicom-study-viewer", "exams/inbox", "exams/library", "presentation/slides.js"]) {
  assert.ok(rootReadme.includes(publicWorkflow), `README must document ${publicWorkflow}`);
}
existing("runtime/README.md");
existing("presentation/README.md");

console.log("OK: modular runtime, exam workflow, slide catalog, and independent slide paths passed");
