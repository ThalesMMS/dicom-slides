# English AI Onboarding and References Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a fully English DICOM Slides repository with a seven-slide presentation that teaches non-technical users how to bring anonymized DICOM cases to a local AI agent and closes with complete data and software references.

**Architecture:** Keep the existing static HTML/CSS/JavaScript deck and Web Component runtime. Add four independent slide documents to the catalog, translate authored text at its source, synchronize generated study/manifest JSON and JavaScript wrappers, and enforce the language boundary with Node, Python, browser, and repository-validation tests.

**Tech Stack:** Static HTML5/CSS, classic JavaScript, Web Components, WebGL2, Python 3/unittest, Node.js assertions, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-16-english-ai-onboarding-and-references-design.md`

## Global Constraints

- Translate every project-authored human-readable string, comment, docstring, CLI message, test description, and document into English.
- Preserve existing technical identifiers, paths, study IDs, series IDs, UIDs, APIs, events, CSS selectors, manifest formats, hashes, geometry, and pixel payloads.
- Preserve original DICOM metadata, the French/Czech character-set fixtures, personal-name diacritics, and verbatim third-party legal text.
- Keep `LICENSE`, `LICENSES/**`, and `exams/library/mri-dir-t1-mr/LICENSE.txt` unchanged.
- Keep raw DICOM directories and ZIPs out of Git; do not claim that conversion guarantees anonymization.
- Use `https://github.com/ThalesMMS/dicom-slides` as the canonical repository URL.
- Keep the exact NLM attribution phrase “Courtesy of the U.S. National Library of Medicine.”
- Keep the deck functional through both `file://` and the local HTTP server, with no new runtime dependency.
- Do not rename the existing `01-introduction`, `02-visible-human`, or `03-mri-dir` slide directories.
- Use TDD for each behavior change and commit only the files named by the completed task.

---

## File Structure and Responsibilities

### New presentation files

- `presentation/slides/01a-ai-setup/index.html` — prerequisites for using a local AI agent.
- `presentation/slides/01b-ai-prompt/index.html` — copy-ready prompt with repository URL and DICOM path placeholder.
- `presentation/slides/01c-ai-review/index.html` — privacy, repository, functionality, and credit review.
- `presentation/slides/04-references/index.html` — Visible Human, MRI-DIR, and DICOM Slides references.
- `tests/browser/test_presentation_layout.js` — catalog, English language, link, and overflow checks at two viewports.
- `tests/javascript/test_english_content.js` — final repository-wide audit for Portuguese prose.

### Existing presentation files

- `presentation/slides.js` — exact seven-slide order.
- `presentation/shared/slide.css` — shared onboarding/reference layouts and translated poster caption.
- `presentation/slides/01-introduction/index.html` — English hero copy.
- `presentation/slides/02-visible-human/index.html` — English CT case copy/status.
- `presentation/slides/03-mri-dir/index.html` — English MR case copy/status.
- `tests/javascript/test_modular_structure.js` — structural and content contract.
- `tests/browser/test_file_url.js` and `tests/browser/test_browser_ui.js` — updated CT slide position.

### Runtime and runtime tests

- `runtime/core/viewer.js` — one Portuguese error plus authored comments.
- `runtime/volume/transfer-functions.js`, `runtime/volume/mpr-viewer.js`, `runtime/volume/webgl-renderer.js` — authored comments.
- `tests/javascript/test_volume_integration.js` and `tests/browser/test_browser_ui.js` — English comments and assertion descriptions.

### Conversion sources and generated packages

- `tools/convert_dicom.py` — English preset labels.
- `tools/convert_study.py` — English fallback series title and future slug fallback.
- `tools/import_custom_bricks.py` — English full-range label.
- `tools/import_visible_human.py` — English study and series display titles.
- `tests/python/test_convert_dicom.py` and `tests/python/test_validate_project.py` — generator assertions.
- `exams/library/visible-human-abdomen-ct/study.{json,js}` and both CT `manifest.{json,js}` pairs — synchronized English display text.
- `exams/library/mri-dir-t1-mr/study.{json,js}` and four MR `manifest.{json,js}` pairs — synchronized English display text.

### Documentation and citation files

- `README.md`, `DATA_LICENSES.md`, `CITING.md`, `CITATION.cff` — primary public documentation.
- `docs/format-research.md` — technical research note.
- `exams/README.md` and `exams/library/README.md` — examination workflow/library descriptions.
- `presentation/README.md` and `runtime/README.md` — verify already-English text and keep terminology consistent.

---

### Task 0: Establish a Tracked, Tested Publication Baseline

**Files:**
- Track without editing: the current repository files under `docs/`, `exams/`, `presentation/`, `runtime/`, `tests/`, and `tools/` plus the named top-level project files.
- Preserve ignored: raw content under `exams/inbox/` other than its tracked `.gitignore` and `README.md`.

**Interfaces:**
- Consumes: the current untracked working tree and existing ignore rules.
- Produces: one baseline commit containing the complete current project so later translation diffs can prove that third-party licenses and pixel chunks did not change.

- [ ] **Step 1: Inspect the untracked baseline and ignore behavior**

```powershell
git status --short
git check-ignore -v exams/inbox/*
```

Expected: project files are currently untracked; raw inbox contents are ignored by `exams/inbox/.gitignore`.

- [ ] **Step 2: Run baseline tests before tracking the files**

```powershell
python -m unittest discover -s tests/python -v
node tests/javascript/test_modular_structure.js
node tests/javascript/test_volume_loader.js
node tests/javascript/test_volume_integration.js
python tools/validate_project.py exams/library/visible-human-abdomen-ct
python tools/validate_project.py exams/library/mri-dir-t1-mr
```

Expected: all current tests and both validators pass before translation work begins.

- [ ] **Step 3: Stage the complete publication baseline explicitly**

```powershell
git add -- .gitignore CITATION.cff CITING.md DATA_LICENSES.md LICENSE LICENSES README.md docs exams index.html presentation requirements-conversion.txt runtime serve.bat serve.command serve.py tests tools
git diff --cached --name-only
```

Inspect the staged list. It must contain the study packages and their chunks, source code, tests, documentation, and licenses. It must not contain a raw `.dcm` file, a DICOM ZIP, cache directory, or unrelated file.

- [ ] **Step 4: Commit the tested baseline**

```powershell
git commit -m "chore: track current project baseline"
```

Expected: `git status --short` is empty immediately after the commit.

---

### Task 1: Expand and Translate the Presentation

**Files:**
- Create: `presentation/slides/01a-ai-setup/index.html`
- Create: `presentation/slides/01b-ai-prompt/index.html`
- Create: `presentation/slides/01c-ai-review/index.html`
- Create: `presentation/slides/04-references/index.html`
- Create: `tests/browser/test_presentation_layout.js`
- Modify: `presentation/slides.js`
- Modify: `presentation/shared/slide.css`
- Modify: `presentation/slides/01-introduction/index.html`
- Modify: `presentation/slides/02-visible-human/index.html`
- Modify: `presentation/slides/03-mri-dir/index.html`
- Modify: `tests/javascript/test_modular_structure.js`
- Modify: `tests/browser/test_file_url.js`
- Modify: `tests/browser/test_browser_ui.js`

**Interfaces:**
- Consumes: `window.DicomSlideSlides` catalog entries shaped as `{ id, title, src }` and `presentation/shared/slide-bridge.js`.
- Produces: the exact ordered IDs `["01-introduction", "01a-ai-setup", "01b-ai-prompt", "01c-ai-review", "02-visible-human", "03-mri-dir", "04-references"]`.
- Produces: four independent, directly openable slide documents with English `lang` and no network dependency.

- [ ] **Step 1: Strengthen the structural test before adding slides**

Replace the loose catalog-length assertion in `tests/javascript/test_modular_structure.js` with the exact contract and add the content assertions below after `slideFiles` is built:

```js
assert.deepEqual(
  catalog.map((slide) => slide.id),
  [
    "01-introduction",
    "01a-ai-setup",
    "01b-ai-prompt",
    "01c-ai-review",
    "02-visible-human",
    "03-mri-dir",
    "04-references",
  ],
  "presentation must publish the approved seven-slide narrative"
);

const slideHtmlById = new Map(catalog.map((slide, index) => [
  slide.id,
  fs.readFileSync(slideFiles[index], "utf8"),
]));
for (const [id, html] of slideHtmlById) {
  assert.match(html, /<html lang="en">/, `${id} must declare English`);
}
assert.match(slideHtmlById.get("01a-ai-setup"), /Start with three things/);
assert.match(slideHtmlById.get("01b-ai-prompt"), /https:\/\/github\.com\/ThalesMMS\/dicom-slides/);
assert.match(slideHtmlById.get("01b-ai-prompt"), /PATH TO MY DICOM FOLDER OR ZIP/);
assert.match(slideHtmlById.get("01c-ai-review"), /Check the result before you share it/);
assert.match(slideHtmlById.get("01c-ai-review"), /not an anonymization certificate/i);
assert.match(slideHtmlById.get("04-references"), /Courtesy of the U\.S\. National Library of Medicine/);
assert.match(slideHtmlById.get("04-references"), /10\.7937\/K9\/TCIA\.2018\.3f08iejt/);
assert.match(slideHtmlById.get("04-references"), /Santos, T\. M\. M\. \(2026\)/);
```

- [ ] **Step 2: Run the structural test and confirm the red state**

Run:

```powershell
node tests/javascript/test_modular_structure.js
```

Expected: FAIL because the current catalog contains only three slides.

- [ ] **Step 3: Publish the exact seven-slide catalog**

Set `presentation/slides.js` to:

```js
(function (global) {
  "use strict";
  global.DicomSlideSlides = Object.freeze([
    { id: "01-introduction", title: "DICOM Slide", src: "slides/01-introduction/index.html" },
    { id: "01a-ai-setup", title: "Prepare your cases", src: "slides/01a-ai-setup/index.html" },
    { id: "01b-ai-prompt", title: "Prompt your AI agent", src: "slides/01b-ai-prompt/index.html" },
    { id: "01c-ai-review", title: "Review before sharing", src: "slides/01c-ai-review/index.html" },
    { id: "02-visible-human", title: "Visible Human CT", src: "slides/02-visible-human/index.html" },
    { id: "03-mri-dir", title: "MRI-DIR", src: "slides/03-mri-dir/index.html" },
    { id: "04-references", title: "References", src: "slides/04-references/index.html" },
  ]);
})(window);
```

- [ ] **Step 4: Create the setup slide**

Create `presentation/slides/01a-ai-setup/index.html` with this complete document:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark">
  <title>Prepare your cases — DICOM Slide</title>
  <link rel="stylesheet" href="../../shared/slide.css">
</head>
<body>
  <main class="slide active guide-slide" aria-label="Requirements for creating a presentation with an AI agent">
    <div class="slide-inner">
      <span class="eyebrow">Create your own deck · 1 of 3</span>
      <h2>Start with three things</h2>
      <ol class="guide-steps">
        <li><span class="guide-number">1</span><div><h3>A local AI agent</h3><p>Use ChatGPT, Claude, Grok, or another desktop or coding agent that can read and edit a folder on your computer. Product capabilities vary: file access is what matters.</p></div></li>
        <li><span class="guide-number">2</span><div><h3>This presentation project</h3><p>Ask the agent to download or use <a class="slide-link" href="https://github.com/ThalesMMS/dicom-slides">github.com/ThalesMMS/dicom-slides</a> as its starting point.</p></div></li>
        <li><span class="guide-number">3</span><div><h3>Your anonymized images</h3><p>Give the agent the local path to a folder of DICOM files—or to a ZIP that contains them. Keep the original files outside GitHub.</p></div></li>
      </ol>
      <p class="guide-footnote">A regular chat window is not enough if it cannot open local files or run the project tools.</p>
    </div>
  </main>
  <script src="../../shared/slide-bridge.js"></script>
</body>
</html>
```

- [ ] **Step 5: Create the copy-ready prompt slide**

Create `presentation/slides/01b-ai-prompt/index.html` with this complete document:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark">
  <title>Prompt your AI agent — DICOM Slide</title>
  <link rel="stylesheet" href="../../shared/slide.css">
</head>
<body>
  <main class="slide active guide-slide" aria-label="Copy-ready instructions for an AI agent">
    <div class="slide-inner">
      <span class="eyebrow">Create your own deck · 2 of 3</span>
      <h2>Give your agent a clear starting point</h2>
      <pre class="agent-prompt"><code>Use https://github.com/ThalesMMS/dicom-slides as the starting point for an English presentation with my own imaging cases.

My anonymized DICOM files are in &lt;PATH TO MY DICOM FOLDER OR ZIP&gt;.

Work in a local copy of the repository. Use its existing conversion and validation tools, add my processed studies to the presentation, preserve the interactive viewer, update titles and references, and test the result.

Do not copy or commit my raw DICOM files or ZIP. Stop and tell me if you find identifying information or cannot verify that the inputs are anonymized.

When finished, tell me which files changed and how to open the presentation.</code></pre>
      <p class="guide-footnote">Replace the text in angle brackets with the real path shown by your computer, such as <code>C:\Cases\Teaching\case-01.zip</code> or <code>/Users/me/Cases/case-01</code>.</p>
    </div>
  </main>
  <script src="../../shared/slide-bridge.js"></script>
</body>
</html>
```

- [ ] **Step 6: Create the review slide**

Create `presentation/slides/01c-ai-review/index.html` with this complete document:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark">
  <title>Review before sharing — DICOM Slide</title>
  <link rel="stylesheet" href="../../shared/slide.css">
</head>
<body>
  <main class="slide active guide-slide" aria-label="Safety and quality review before sharing a presentation">
    <div class="slide-inner">
      <span class="eyebrow">Create your own deck · 3 of 3</span>
      <h2>Check the result before you share it</h2>
      <ol class="review-steps">
        <li><span class="guide-number">1</span><div><h3>Privacy</h3><p>Confirm that no patient name, identifier, date, institution, or other identifying information appears.</p></div></li>
        <li><span class="guide-number">2</span><div><h3>Repository safety</h3><p>Confirm that raw DICOM folders and ZIP files remain outside Git and GitHub.</p></div></li>
        <li><span class="guide-number">3</span><div><h3>Functionality</h3><p>Open every case and test the image stack, series selector, MPR, 3D, and slide navigation.</p></div></li>
        <li><span class="guide-number">4</span><div><h3>Credits</h3><p>Verify each dataset's license and attribution, then include the project citation in your references.</p></div></li>
      </ol>
      <p class="callout warn review-warning"><strong>You remain responsible for the final review.</strong> An AI agent's output is not an anonymization certificate.</p>
    </div>
  </main>
  <script src="../../shared/slide-bridge.js"></script>
</body>
</html>
```

- [ ] **Step 7: Create the references slide**

Create `presentation/slides/04-references/index.html` with this complete document:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark">
  <title>References — DICOM Slide</title>
  <link rel="stylesheet" href="../../shared/slide.css">
</head>
<body>
  <main class="slide active references-slide" aria-label="Data and software references">
    <div class="slide-inner">
      <span class="eyebrow">Sources and reuse</span>
      <h2>References</h2>
      <div class="reference-list">
        <section class="reference-entry">
          <h3>Visible Human Project</h3>
          <p>National Library of Medicine (U.S.). <em>The Visible Human Project</em>. <a class="slide-link" href="https://www.nlm.nih.gov/research/visible/visible_human.html">nlm.nih.gov/research/visible/visible_human.html</a></p>
          <p class="reference-note">CT data: Courtesy of the U.S. National Library of Medicine. NLM does not endorse this project.</p>
        </section>
        <section class="reference-entry">
          <h3>MRI-DIR</h3>
          <p>Ger, R. B., et al. (2018). <em>Data from Synthetic and Phantom MR Images for Determining Deformable Image Registration Accuracy (MRI-DIR)</em> (Version 1). The Cancer Imaging Archive. <a class="slide-link" href="https://doi.org/10.7937/K9/TCIA.2018.3f08iejt">doi:10.7937/K9/TCIA.2018.3f08iejt</a>. CC BY 4.0.</p>
        </section>
        <section class="reference-entry project-reference">
          <h3>Reuse these slides</h3>
          <p>Copy this line into the references slide of any presentation based on this project:</p>
          <blockquote>Santos, T. M. M. (2026). <em>DICOM Slide: 2D, MPR, and 3D viewer</em> [Software]. <a class="slide-link" href="https://github.com/ThalesMMS/dicom-slides">github.com/ThalesMMS/dicom-slides</a>. MIT License.</blockquote>
        </section>
      </div>
    </div>
  </main>
  <script src="../../shared/slide-bridge.js"></script>
</body>
</html>
```

- [ ] **Step 8: Add the shared guide/reference styles**

Append this block before the media queries in `presentation/shared/slide.css`:

```css
.guide-slide h2,.references-slide h2{margin-bottom:clamp(18px,2.4vh,30px)}
.guide-steps,.review-steps{display:grid;gap:clamp(12px,2vh,22px);margin:0;padding:0;list-style:none;flex:1;align-content:center}
.guide-steps li,.review-steps li{display:grid;grid-template-columns:56px minmax(0,1fr);gap:18px;align-items:start;padding:clamp(12px,1.8vh,20px) 0;border-top:1px solid var(--line)}
.guide-number{display:grid;width:46px;height:46px;place-items:center;border:1px solid rgba(56,189,248,.48);border-radius:50%;color:#a8e5ff;font-weight:850}
.guide-steps h3,.review-steps h3{margin:0 0 4px;font-size:clamp(19px,1.8vw,26px)}
.guide-steps p,.review-steps p{margin:0;max-width:1150px;font-size:clamp(15px,1.35vw,20px);line-height:1.45}
.guide-footnote{margin:18px 0 0;font-size:clamp(13px,1.1vw,16px);color:#8193a1}
.slide-link{color:#7dd3fc;text-decoration-color:rgba(125,211,252,.45);text-underline-offset:3px;overflow-wrap:anywhere}
.agent-prompt{flex:1;min-height:0;margin:0;padding:clamp(18px,2.3vw,30px);overflow:auto;border:1px solid #334252;border-radius:16px;background:#080c11;color:#d8e8f2;font:500 clamp(14px,1.18vw,18px)/1.48 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:pre-wrap}
.review-steps{grid-template-columns:1fr 1fr;gap:0 32px}
.review-warning{margin-bottom:0}
.reference-list{display:grid;gap:0;min-height:0}
.reference-entry{padding:clamp(12px,1.8vh,20px) 0;border-top:1px solid var(--line)}
.reference-entry h3{margin:0 0 6px;font-size:clamp(18px,1.6vw,24px);color:#e9f3f9}
.reference-entry p,.reference-entry blockquote{margin:0;color:#afbfcb;font-size:clamp(13px,1.18vw,17px);line-height:1.45}
.reference-entry .reference-note{margin-top:5px;color:#8ce8c5}
.project-reference blockquote{margin-top:8px;padding:12px 14px;border-left:3px solid var(--accent);background:rgba(56,189,248,.07);color:#d9e8f1}
```

Extend the existing responsive rule with:

```css
@media(max-width:980px){
  .review-steps{grid-template-columns:1fr;overflow:auto}
  .guide-steps,.review-steps,.reference-list{overflow:auto}
  .guide-steps li,.review-steps li{grid-template-columns:44px minmax(0,1fr)}
  .guide-number{width:38px;height:38px}
}
```

Change the hero pseudo-caption to:

```css
content:"Visible Human · study 1 · axial CT in HU";
```

- [ ] **Step 9: Translate the three existing slide documents**

Apply these exact copy changes while leaving element structure, viewer attributes, event names, and paths unchanged:

| File | Current | English |
|---|---|---|
| `01-introduction` | `lang="pt-BR"` | `lang="en"` |
| `01-introduction` | `2D, MPR e volume 3D no mesmo viewer` | `2D, MPR, and 3D in one viewer` |
| `01-introduction` | hero paragraph | `The viewer uses local DICOM Slide chunks. MPR and 3D assemble the active series into a volume only when needed.` |
| `01-introduction` | `2 volumes funcionais` | `2 working volumes` |
| `01-introduction` | `457 imagens` | `457 images` |
| `01-introduction` | `Zero dependências em runtime` | `Zero runtime dependencies` |
| `01-introduction` | keyboard help | `Use ←/→ to change slides. In the viewer, D cycles through 2D, MPR, and 3D; Esc returns to the 2D stack.` |
| `01-introduction` | poster alt text | `Axial slice from the Visible Human Male abdominal CT` |
| `02-visible-human` | `lang="pt-BR"` | `lang="en"` |
| `02-visible-human` | document title and heading `Visible Human — TC abdominal` | `Visible Human — abdominal CT` |
| `02-visible-human` | `Carregando estudo…` | `Loading study…` |
| `02-visible-human` | `séries / imagens / matriz / entre cortes` | `series / images / matrix / slice spacing` |
| `02-visible-human` | `Mesmo payload, três modos` | `One payload, three viewing modes` |
| `02-visible-human` | explanatory paragraph | `The normal and post-freezing series cover the same abdominal range. When MPR or 3D opens, the Int16/HU chunks are assembled into one continuous volume.` |
| `02-visible-human` | `Axial, coronal e sagital` | `Axial, coronal, and sagittal` |
| `02-visible-human` | `Formato / Crédito` | `Format / Credit` |
| `02-visible-human` | status template | Use the exact CT expression below. |
| `03-mri-dir` | `lang="pt-BR"` | `lang="en"` |
| `03-mri-dir` | `RM sintética T1 multissérie` | `multi-series synthetic T1 MR` |
| `03-mri-dir` | `Carregando estudo…` | `Loading study…` |
| `03-mri-dir` | `séries / imagens / matriz / geometria` | `series / images / matrix / geometry` |
| `03-mri-dir` | `Conjunto de pesquisa` | `Research dataset` |
| `03-mri-dir` | explanatory paragraph | `T1Post1–T1Post4 are synthetic/modelled images for deformable-registration research, not a diagnostic multi-sequence acquisition.` |
| `03-mri-dir` | `Origem / Licença` | `Source / License` |
| `03-mri-dir` | status template | Use the exact MR expressions below. |

Use these exact status expressions:

```js
// Visible Human CT
status.textContent = state.totalSlices
  ? `Series ${state.seriesNumber || 1} · image ${Number(state.slice || 0) + 1}/${state.totalSlices}${mode}`
  : "Loading study…";

// MRI-DIR
const image = state.totalSlices
  ? ` · image ${Number(state.slice || 0) + 1}/${state.totalSlices}`
  : "";
status.textContent = state.totalSeries
  ? `Series ${state.seriesNumber || state.seriesIndex + 1} · ${state.seriesIndex + 1}/${state.totalSeries}${image}${mode}`
  : "Loading study…";
```

Do not retain the obsolete statement “V opens 3D”; the runtime actually uses `D` to cycle modes and `V` has no handler.

- [ ] **Step 10: Update browser navigation tests for the shifted CT slide**

In `tests/browser/test_file_url.js`, click `#next-slide` four times before locating the CT frame:

```js
for (let index = 0; index < 4; index += 1) {
  await page.locator("#next-slide").click();
}
```

In `tests/browser/test_browser_ui.js`, replace the CT deck URL `#2` with `#5`. Translate the Portuguese comments and assertion messages in that test to English while preserving behavior.

- [ ] **Step 11: Add automated slide layout checks**

Create `tests/browser/test_presentation_layout.js`:

```js
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
```

- [ ] **Step 12: Run presentation tests**

Start the local server hidden, run the structural, layout, file URL, and UI tests, then stop the exact process:

```powershell
node tests/javascript/test_modular_structure.js
$server = Start-Process -FilePath python -ArgumentList 'serve.py' -PassThru -WindowStyle Hidden
try {
  node tests/browser/test_presentation_layout.js
  node tests/browser/test_browser_ui.js
  node tests/browser/test_file_url.js
} finally {
  Stop-Process -Id $server.Id
}
```

Expected: every command exits 0 and each script prints its `OK:` summary.

- [ ] **Step 13: Commit the presentation**

```powershell
git add -- presentation tests/javascript/test_modular_structure.js tests/browser/test_presentation_layout.js tests/browser/test_file_url.js tests/browser/test_browser_ui.js
git commit -m "feat: add English AI onboarding and references slides"
```

---

### Task 2: Translate Runtime Prose and Runtime Tests

**Files:**
- Modify: `runtime/core/viewer.js`
- Modify: `runtime/volume/transfer-functions.js`
- Modify: `runtime/volume/mpr-viewer.js`
- Modify: `runtime/volume/webgl-renderer.js`
- Modify: `tests/javascript/test_volume_integration.js`
- Modify: `tests/browser/test_browser_ui.js`

**Interfaces:**
- Consumes: unchanged runtime classes, exported catalogs, and tool reducer APIs.
- Produces: identical runtime behavior with English errors, comments, and test descriptions.
- Preserves: `DicomSlideViewer`, `DicomSlideVolume`, `VolumeViewer`, `WINDOW_PRESETS`, mode/tool IDs, and keyboard bindings.

- [ ] **Step 1: Add a failing source-language assertion**

Before evaluating `runtimeScripts` in `tests/javascript/test_volume_integration.js`, scan every relevant runtime source and reject high-confidence Portuguese runtime prose:

```js
const portugueseRuntimeProse = /\b(?:Módulo volumétrico|Arrasto|janela padrão|série|séries|sombreamento|usuário|botão|domínio|opacidade|câmera|faixa dinâmica|qualidade plena|não inicializado)\b/iu;
const runtimeProseFiles = [...runtimeScripts, "runtime/core/viewer.js"];
for (const filename of runtimeProseFiles) {
  const source = fs.readFileSync(path.join(root, filename), "utf8");
  assert.doesNotMatch(source, portugueseRuntimeProse, `${filename} still contains Portuguese prose`);
}
for (const filename of runtimeScripts) {
  const source = fs.readFileSync(path.join(root, filename), "utf8");
  vm.runInContext(source, context, { filename });
}
```

- [ ] **Step 2: Run the integration test and verify it fails**

Run:

```powershell
node tests/javascript/test_volume_integration.js
```

Expected: FAIL on the first Portuguese comment or runtime message.

- [ ] **Step 3: Translate runtime messages and comments without changing code**

Make this exact visible-string replacement in `runtime/core/viewer.js`:

```js
this.volumeCapability = { supported: false, reason: "Volumetric module has not been initialized yet" };
```

Translate every Portuguese comment block in the four runtime files into direct technical English. Preserve all numeric constants, expressions, shader strings, function names, property names, and DOM markup. Use these terminology mappings consistently:

| Portuguese concept | Required English |
|---|---|
| janela / nível | window / level |
| arrasto | drag |
| corte | slice |
| faixa dinâmica | dynamic range |
| paradas | stops |
| sombreamento | shading |
| luz de cabeça | headlight |
| qualidade plena | full quality |
| série sem HU | non-HU series |
| domínio nativo | native domain |
| câmera | camera |
| botão direito | right mouse button |

The first two comment blocks in `runtime/core/viewer.js` must become:

```js
// Fixed window presets in the toolbar; "default" resolves to the series'
// default window (defaultWindow in the manifest). Shortcuts: keys 1 through 5.
```

and:

```js
// Selects the active tool for the current mode: 2D uses the stack toolbar,
// while MPR and 3D forward the selection to VolumeViewer.
```

- [ ] **Step 4: Translate runtime test prose**

Translate every Portuguese comment and assertion description in `tests/javascript/test_volume_integration.js` and `tests/browser/test_browser_ui.js`. Apply these exact assertion-message replacements:

```js
"MPR scrolling must clamp to the axis bounds"
"The shift must not move the color ramp"
"Selecting a preset must adopt its recommended shading"
"Bones B/W recommends shading"
"Airways does not recommend shading"
```

Preserve the French and Czech strings in `tests/python/test_convert_dicom.py` unchanged; they are DICOM character-set fixtures, not project prose.

- [ ] **Step 5: Run runtime unit and browser tests**

```powershell
node tests/javascript/test_volume_loader.js
node tests/javascript/test_volume_integration.js
$server = Start-Process -FilePath python -ArgumentList 'serve.py' -PassThru -WindowStyle Hidden
try {
  node tests/browser/test_browser_ui.js
} finally {
  Stop-Process -Id $server.Id
}
```

Expected: all three tests pass with no behavior changes.

- [ ] **Step 6: Commit the runtime translation**

```powershell
git add -- runtime/core/viewer.js runtime/volume/transfer-functions.js runtime/volume/mpr-viewer.js runtime/volume/webgl-renderer.js tests/javascript/test_volume_integration.js tests/browser/test_browser_ui.js
git commit -m "refactor: translate runtime prose to English"
```

---

### Task 3: Translate Conversion Sources and Generated Exam Packages

**Files:**
- Modify: `tools/convert_dicom.py`
- Modify: `tools/convert_study.py`
- Modify: `tools/import_custom_bricks.py`
- Modify: `tools/import_visible_human.py`
- Modify: `tests/python/test_convert_dicom.py`
- Modify: `tests/python/test_validate_project.py`
- Modify: `tests/javascript/test_volume_integration.js`
- Modify: `exams/library/visible-human-abdomen-ct/study.json`
- Modify: `exams/library/visible-human-abdomen-ct/study.js`
- Modify: `exams/library/visible-human-abdomen-ct/series/normal-ct/manifest.json`
- Modify: `exams/library/visible-human-abdomen-ct/series/normal-ct/manifest.js`
- Modify: `exams/library/visible-human-abdomen-ct/series/frozen-ct/manifest.json`
- Modify: `exams/library/visible-human-abdomen-ct/series/frozen-ct/manifest.js`
- Modify: `exams/library/mri-dir-t1-mr/study.json`
- Modify: `exams/library/mri-dir-t1-mr/study.js`
- Modify: all four `exams/library/mri-dir-t1-mr/series/*/manifest.json` files
- Modify: all four `exams/library/mri-dir-t1-mr/series/*/manifest.js` files

**Interfaces:**
- Consumes: existing `presets_for_series(first, minimum, maximum) -> (default_window, presets)` and `package_study(...) -> dict` behavior.
- Produces: English authored labels while keeping current IDs, geometry, chunks, hashes, DICOM source metadata, and pixel payloads unchanged.
- Produces future fallback `Series <number>` and future fallback slug `no-description`; existing checked-in IDs do not change.

- [ ] **Step 1: Add failing generator assertions**

In `tests/python/test_convert_dicom.py` add:

```python
def test_uses_english_authored_preset_labels(self) -> None:
    from tools import convert_dicom

    _, ct_presets = convert_dicom.presets_for_series(
        {"modality": "CT", "windowCenter": 40, "windowWidth": 400},
        -1024,
        2000,
    )
    self.assertEqual(ct_presets["soft"]["label"], "Soft tissue")
    self.assertEqual(ct_presets["lung"]["label"], "Lung")
    self.assertEqual(ct_presets["bone"]["label"], "Bone")

    _, mr_presets = convert_dicom.presets_for_series(
        {"modality": "MR", "windowCenter": 100, "windowWidth": 200},
        0,
        1000,
    )
    self.assertEqual(mr_presets["full"]["label"], "Full range")
```

In `tests/python/test_validate_project.py` import `json` and append these assertions after `package_study`:

```python
study = json.loads((output / "study.json").read_text(encoding="utf-8"))
self.assertEqual(study["title"], "Visible Human Male — abdominal CT")
self.assertEqual(
    [series["title"] for series in study["series"]],
    ["Normal CT (before freezing)", "CT after freezing"],
)
normal_manifest = json.loads(
    (output / "series" / "normal-ct" / "manifest.json").read_text(encoding="utf-8")
)
self.assertEqual(normal_manifest["presets"]["soft"]["label"], "Soft tissue")
self.assertEqual(normal_manifest["presets"]["lung"]["label"], "Lung")
self.assertEqual(normal_manifest["presets"]["bone"]["label"], "Bone")
```

In `tests/javascript/test_volume_integration.js` add:

```js
assert.equal(visibleHumanStudy.title, "Visible Human Male — abdominal CT");
assert.deepEqual(
  visibleHumanStudy.series.map((series) => series.title),
  ["Normal CT (before freezing)", "CT after freezing"]
);
assert.equal(mriDirStudy.title, "MRI-DIR — multi-series synthetic T1 MR");
```

- [ ] **Step 2: Run focused tests and verify the red state**

```powershell
python -m unittest discover -s tests/python -p "test_convert_dicom.py" -v
python -m unittest discover -s tests/python -p "test_validate_project.py" -v
node tests/javascript/test_volume_integration.js
```

Expected: failures show the current Portuguese labels/titles.

- [ ] **Step 3: Translate generator source strings**

Apply these exact replacements:

| File | Current | English |
|---|---|---|
| `tools/convert_dicom.py` | `Partes moles` | `Soft tissue` |
| `tools/convert_dicom.py` | `Pulmão` | `Lung` |
| `tools/convert_dicom.py` | `Osso` | `Bone` |
| `tools/convert_dicom.py` | `Faixa completa` | `Full range` |
| `tools/import_custom_bricks.py` | `Faixa completa` | `Full range` |
| `tools/convert_study.py` | `Série ${number_text}` | `Series ${number_text}` |
| `tools/convert_study.py` | `sem-descricao` | `no-description` |
| `tools/import_visible_human.py` | `TC normal (pré-congelamento)` | `Normal CT (before freezing)` |
| `tools/import_visible_human.py` | `TC após congelamento` | `CT after freezing` |
| `tools/import_visible_human.py` | `Visible Human Male — TC abdominal` | `Visible Human Male — abdominal CT` |

Do not change `normal-ct`, `frozen-ct`, `normalCT`, `frozenCT`, `visible-human-abdomen-ct`, or any current series directory.

- [ ] **Step 4: Synchronize the checked-in generated display text**

Perform only the following literal substitutions in the JSON and JavaScript wrapper files listed in this task:

```text
Visible Human Male — TC abdominal -> Visible Human Male — abdominal CT
TC normal (pré-congelamento) -> Normal CT (before freezing)
TC após congelamento -> CT after freezing
Partes moles -> Soft tissue
Pulmão -> Lung
Osso -> Bone
MRI-DIR — RM sintética T1 multissérie -> MRI-DIR — multi-series synthetic T1 MR
Faixa completa -> Full range
```

Use an exact UTF-8/no-BOM mechanical replacement so no numerical or encoded field changes:

```powershell
$files = @(
  'exams/library/visible-human-abdomen-ct/study.json',
  'exams/library/visible-human-abdomen-ct/study.js',
  'exams/library/visible-human-abdomen-ct/series/normal-ct/manifest.json',
  'exams/library/visible-human-abdomen-ct/series/normal-ct/manifest.js',
  'exams/library/visible-human-abdomen-ct/series/frozen-ct/manifest.json',
  'exams/library/visible-human-abdomen-ct/series/frozen-ct/manifest.js',
  'exams/library/mri-dir-t1-mr/study.json',
  'exams/library/mri-dir-t1-mr/study.js'
) + (Get-ChildItem 'exams/library/mri-dir-t1-mr/series' -Recurse -File -Include 'manifest.json','manifest.js').FullName
$replacements = [ordered]@{
  'Visible Human Male — TC abdominal' = 'Visible Human Male — abdominal CT'
  'TC normal (pré-congelamento)' = 'Normal CT (before freezing)'
  'TC após congelamento' = 'CT after freezing'
  'Partes moles' = 'Soft tissue'
  'Pulmão' = 'Lung'
  'Osso' = 'Bone'
  'MRI-DIR — RM sintética T1 multissérie' = 'MRI-DIR — multi-series synthetic T1 MR'
  'Faixa completa' = 'Full range'
}
$utf8 = New-Object System.Text.UTF8Encoding($false)
foreach ($file in $files) {
  $resolved = (Resolve-Path -LiteralPath $file).Path
  $text = [IO.File]::ReadAllText($resolved)
  foreach ($entry in $replacements.GetEnumerator()) {
    $text = $text.Replace($entry.Key, $entry.Value)
  }
  [IO.File]::WriteAllText($resolved, $text, $utf8)
}
```

- [ ] **Step 5: Run generator, package, and validation tests**

```powershell
python -m unittest discover -s tests/python -v
node tests/javascript/test_volume_integration.js
python tools/validate_project.py exams/library/visible-human-abdomen-ct
python tools/validate_project.py exams/library/mri-dir-t1-mr
```

Expected: all tests pass; both validators report valid studies; chunk counts, hashes, dimensions, and orientation tests remain unchanged.

- [ ] **Step 6: Confirm no chunk payload changed**

Run:

```powershell
git status --short -- exams/library/*/series/*/chunks
```

Expected: no output.

- [ ] **Step 7: Commit the conversion and package translation**

```powershell
git add -- tools tests/python/test_convert_dicom.py tests/python/test_validate_project.py tests/javascript/test_volume_integration.js exams/library/visible-human-abdomen-ct exams/library/mri-dir-t1-mr
git commit -m "refactor: translate generated study labels to English"
```

---

### Task 4: Translate Documentation and Citation Metadata

**Files:**
- Create: `tests/javascript/test_english_content.js`
- Modify: `README.md`
- Modify: `DATA_LICENSES.md`
- Modify: `CITING.md`
- Modify: `CITATION.cff`
- Modify: `docs/format-research.md`
- Modify: `exams/README.md`
- Modify: `exams/library/README.md`
- Verify: `presentation/README.md`
- Verify: `runtime/README.md`

**Interfaces:**
- Consumes: the canonical repository URL, NLM attribution/terms URLs, MRI-DIR DOI, current commands, and existing technical paths.
- Produces: English public documentation and CFF metadata aligned with the final references slide.
- Produces: a repository-wide prose audit that ignores third-party legal text, pixel chunks, binaries, and multilingual DICOM fixtures.

- [ ] **Step 1: Add the repository-wide English-content audit**

Create `tests/javascript/test_english_content.js`:

```js
#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const textExtensions = new Set([
  ".bat", ".cff", ".command", ".css", ".html", ".js", ".json", ".md", ".py", ".txt",
]);
const ignoredDirectories = new Set([".git", "LICENSES", "chunks"]);
const ignoredFiles = new Set([
  "LICENSE",
  "exams/library/mri-dir-t1-mr/LICENSE.txt",
]);
const portugueseProse = /\b(?:apresentaç(?:ão|ões)|visualizador|exames?|séries?|licenças?|projeto|dados|arquivos?|imagens?|cortes?|carregando|estudos?|matriz|geometria|origem|crédito|formato|faixa completa|partes moles|pulmão|osso|pré-congelamento|após congelamento|sem-descricao|janela|janelado|ferramenta|usuário|botão|arrasto|sombreamento|domínio|opacidade|câmera|qualidade|padrão|pesquisa realizada|resposta curta|como citar|não destinado|não|são|está|estão|começam|própri[ao]|revela|recomenda|apenas|também|mantém|devolve|continua|abaixo|acima|segue|ainda|entre|quando|onde|mesmo|sem|sintétic[ao]|multissérie|avaliação|diagnóstico|TC abdominal|TC normal)\b/iu;

function collect(directory, output = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) collect(absolute, output);
    else output.push(absolute);
  }
  return output;
}

const violations = [];
for (const filename of collect(root)) {
  const relative = path.relative(root, filename).replaceAll("\\", "/");
  // Planning records quote legacy source strings as translation fixtures.
  if (relative.startsWith("docs/superpowers/")) continue;
  if (ignoredFiles.has(relative)) continue;
  if (!textExtensions.has(path.extname(filename).toLowerCase())) continue;
  const lines = fs.readFileSync(filename, "utf8").split(/\r?\n/);
  lines.forEach((line, index) => {
    if (portugueseProse.test(line) || /lang=["']pt-BR["']/i.test(line)) {
      violations.push(`${relative}:${index + 1}: ${line.trim()}`);
    }
  });
}

assert.deepEqual(
  violations,
  [],
  `Project-authored Portuguese prose remains:\n${violations.join("\n")}`
);
console.log("OK: project-authored human-readable text is English");
```

- [ ] **Step 2: Run the audit and confirm the red state**

```powershell
node tests/javascript/test_english_content.js
```

Expected: FAIL with Portuguese lines from the root documentation and research note.

- [ ] **Step 3: Rewrite the primary documentation in English**

Translate `README.md` sentence-by-sentence, preserve every working command/path/link, and use these exact English section headings:

```markdown
# DICOM Slide
## Local demo
## Included studies
## Embed in another HTML presentation
## Viewer controls
## Data format
## Process a new DICOM study
## Rebuild the Visible Human study
## Validation
## Repository layout
## Slide authoring
## Licenses
```

Use `my-exam` rather than `novo-exame` in hypothetical commands. Keep this warning near the top:

```markdown
> **Demonstration, education, and research use only. Not intended for diagnosis or clinical decision-making.**
```

Add this plain-language AI reuse paragraph under slide authoring:

```markdown
To build a presentation from your own cases, give a file-capable local AI agent this repository URL and the path to an anonymized DICOM directory or ZIP. Keep raw inputs in `exams/inbox/` or another ignored local directory. The converter does not certify anonymization; inspect all metadata before publishing.
```

- [ ] **Step 4: Rewrite the data-license and citation guides**

Translate `DATA_LICENSES.md` with these section headings:

```markdown
# Data licenses and provenance
## Visible Human Male — abdominal CT
## MRI-DIR — multi-series synthetic T1 MR
## Intended use
```

Preserve the official URLs and state exactly:

```markdown
Required attribution: **“Courtesy of the U.S. National Library of Medicine.”**

This attribution does not mean that NLM approved, certified, sponsored, or maintains this software.
```

Translate `CITING.md` with these section headings:

```markdown
# How to cite
## This project
## When a Visible Human image appears
## When an MRI-DIR image appears
## Example final credits
```

Use this exact project citation:

```markdown
> Santos, T. M. M. (2026). *DICOM Slide: 2D, MPR, and 3D viewer* [Software]. https://github.com/ThalesMMS/dicom-slides
```

Keep the complete Ger et al. MRI-DIR citation and DOI already present; translate only the surrounding authored explanation.

- [ ] **Step 5: Replace the CFF metadata with the English canonical form**

Set `CITATION.cff` to:

```yaml
cff-version: 1.2.0
message: "If you use this software, please cite it and the displayed imaging dataset as described in CITING.md."
title: "DICOM Slide: 2D, MPR, and 3D viewer"
type: software
authors:
  - family-names: "Santos"
    given-names: "Thales Matheus Mendonça"
license: MIT
date-released: "2026-08-16"
repository-code: "https://github.com/ThalesMMS/dicom-slides"
url: "https://github.com/ThalesMMS/dicom-slides"
preferred-citation:
  type: software
  title: "DICOM Slide: 2D, MPR, and 3D viewer"
  authors:
    - family-names: "Santos"
      given-names: "Thales Matheus Mendonça"
  year: 2026
```

- [ ] **Step 6: Translate supporting documentation**

Translate `docs/format-research.md` faithfully, preserving every technical format name, table value, link, DICOM section reference, recommendation, and date. Use these main headings:

```markdown
# Formats for MPR/reslicing and persistence of 3D results
## Short answer
## Three different objects commonly called “3D”
## Requirements for correct reslicing
## Format comparison
## Evaluation of this repository's chunks
## Concrete recommendation for this project
## Decision summary
```

Translate `exams/README.md` and `exams/library/README.md`. Keep `exams/inbox/README.md` unchanged because it is already English. Verify `presentation/README.md` and `runtime/README.md` contain no Portuguese and that terminology matches “study,” “series,” “viewer,” and “presentation.”

- [ ] **Step 7: Run documentation and language checks**

```powershell
node tests/javascript/test_english_content.js
node tests/javascript/test_modular_structure.js
python tools/validate_project.py exams/library/visible-human-abdomen-ct
python tools/validate_project.py exams/library/mri-dir-t1-mr
```

Expected: all commands pass. The language audit must not flag “Mendonça,” “IRM cérébrale, neuro-crâne,” or “Příliš žluťoučký.”

- [ ] **Step 8: Confirm third-party license text is untouched**

Run:

```powershell
git status --short -- LICENSE LICENSES exams/library/mri-dir-t1-mr/LICENSE.txt
```

Expected: no output.

- [ ] **Step 9: Commit documentation and the audit**

```powershell
git add -- README.md DATA_LICENSES.md CITING.md CITATION.cff docs/format-research.md exams/README.md exams/library/README.md presentation/README.md runtime/README.md tests/javascript/test_english_content.js
git commit -m "docs: translate repository and citation guidance"
```

---

### Task 5: Full Verification and Visual Quality Gate

**Files:**
- Verify: all files changed by Tasks 1–4.
- Modify only if a failing test or visual defect requires a targeted correction.

**Interfaces:**
- Consumes: the seven-slide catalog, English runtime, English generated labels, English documentation, and audit test.
- Produces: evidence that the repository satisfies the specification without regressions.

- [ ] **Step 1: Read the verification and browser-control skills**

Read `verification-before-completion/SKILL.md` and `browser:control-in-app-browser/SKILL.md` completely before running the final quality gate. Follow their evidence and browser-inspection requirements.

- [ ] **Step 2: Run the complete non-browser test suite**

```powershell
python -m unittest discover -s tests/python -v
node tests/javascript/test_modular_structure.js
node tests/javascript/test_english_content.js
node tests/javascript/test_volume_loader.js
node tests/javascript/test_volume_integration.js
python tools/validate_project.py exams/library/visible-human-abdomen-ct
python tools/validate_project.py exams/library/mri-dir-t1-mr
```

Expected: every process exits 0.

- [ ] **Step 3: Run all browser suites through HTTP and file URLs**

```powershell
$server = Start-Process -FilePath python -ArgumentList 'serve.py' -PassThru -WindowStyle Hidden
try {
  node tests/browser/test_presentation_layout.js
  node tests/browser/test_browser_ui.js
  node tests/browser/test_file_url.js
} finally {
  Stop-Process -Id $server.Id
}
```

Expected: all browser tests exit 0, no page errors are collected, the file URL test reaches the CT slide at position 5, and MPR/3D tests remain green.

- [ ] **Step 4: Inspect every slide visually at desktop size**

Start a hidden server and persist its exact process ID in the system temporary directory:

```powershell
$qaPidFile = Join-Path $env:TEMP 'dicom-slide-qa-server.pid'
$qaServer = Start-Process -FilePath python -ArgumentList 'serve.py' -PassThru -WindowStyle Hidden
[IO.File]::WriteAllText($qaPidFile, [string]$qaServer.Id)
```

Use the in-app browser to open `http://127.0.0.1:8765/presentation/index.html` with a 1440 × 900 viewport. Navigate slides 1 through 7 and inspect each at full size for:

- title wrapping;
- clipped prompt text;
- horizontal or vertical overflow;
- reference readability;
- broken or visually ambiguous URLs;
- misaligned numbered rows;
- viewer expansion regressions;
- unintended overlaps.

On slides 5 and 6, wait for the study to load and exercise stack, series selection, MPR, and 3D. Confirm CT coronal/sagittal and 3D superior/inferior orientation remains correct.

- [ ] **Step 5: Inspect responsive behavior**

Repeat the slide-by-slide inspection at 900 × 760. Confirm:

- guide and reference sections scroll internally only when necessary;
- navigation remains reachable;
- the prompt remains readable;
- no content is hidden behind the deck navigation;
- study slides retain a usable viewer area.

Stop only the recorded QA server and remove the temporary PID file:

```powershell
$qaPidFile = Join-Path $env:TEMP 'dicom-slide-qa-server.pid'
$qaServerId = [int][IO.File]::ReadAllText($qaPidFile)
Stop-Process -Id $qaServerId
Remove-Item -LiteralPath $qaPidFile
```

- [ ] **Step 6: Audit preserved material and changed scope**

Run:

```powershell
git status --short
git diff --stat HEAD~4..HEAD
git diff --check HEAD~4..HEAD
git status --short -- LICENSE LICENSES exams/library/mri-dir-t1-mr/LICENSE.txt exams/library/*/series/*/chunks
```

Expected:

- `git diff --check` produces no whitespace errors.
- third-party licenses and chunk payloads show no modifications.
- no raw DICOM or ZIP file appears.
- only intended repository files and the approved spec/plan are tracked.

- [ ] **Step 7: Fix and re-run only if evidence finds a defect**

For any failure, make the smallest targeted correction, first add or tighten the regression assertion that demonstrates it, then repeat Steps 2–6. Do not weaken overflow, language, orientation, attribution, or privacy checks to obtain a pass.

- [ ] **Step 8: Commit final QA corrections if any**

If Step 7 changed files:

```powershell
git add -u -- presentation runtime exams/library tools tests README.md DATA_LICENSES.md CITING.md CITATION.cff docs
git commit -m "fix: resolve final English deck QA findings"
```

If Step 7 made no changes, do not create an empty commit.

- [ ] **Step 9: Record final evidence for handoff**

Capture the exact command results, seven-slide count, two validated studies, browser viewport checks, unchanged third-party licenses/chunks, and final commit hash. Use this evidence—not an assumption—to report completion.
