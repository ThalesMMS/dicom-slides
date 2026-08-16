# English AI Onboarding, References, and Repository Translation Design

**Date:** 2026-08-16  
**Status:** Approved concept; specification awaiting final review

## Summary

Translate every human-readable text authored by this project into English and extend the HTML presentation with three beginner-friendly onboarding slides plus a final references slide. The onboarding must teach a non-technical user how to give a locally installed, file-capable AI agent the DICOM Slides repository and a local DICOM directory or ZIP so the agent can build a presentation from the user's own cases.

The translation must preserve technical identifiers, existing paths, DICOM source metadata, multilingual encoding fixtures, personal names, and third-party license text. Generated display text must be translated at its source and then synchronized into the checked-in generated assets.

## Communication Job

By the end of the deck, a non-technical presenter should understand how to provide this repository and anonymized DICOM inputs to a local AI agent, how to review the generated presentation safely, and how to cite every included dataset and the DICOM Slides project.

## Goals

- Make the complete project consistently English for users and contributors.
- Add clear, vendor-neutral instructions for using ChatGPT, Claude, Grok, or another AI agent that can read and edit local files.
- Give the audience a copy-ready prompt containing the canonical repository URL and a placeholder for a DICOM directory or ZIP.
- Explicitly warn users not to publish raw DICOM inputs and not to assume that conversion performs complete anonymization.
- Add a final references slide covering Visible Human Project data, MRI-DIR data, and reuse of DICOM Slides itself.
- Preserve the current presentation's visual language and interactive viewer behavior.
- Keep current technical identifiers and existing file paths stable.

## Non-goals

- Renaming existing files, directories, study IDs, series IDs, API names, events, manifest formats, or CSS selectors.
- Translating original DICOM metadata copied from source studies.
- Translating the MIT license, Creative Commons license, TCIA download notice, or other third-party legal text.
- Claiming that every product or subscription named on the slides can access local files. The slides will tell the user to choose a desktop or coding agent that explicitly has local file access.
- Automating DICOM anonymization or certifying that a study is de-identified.
- Replacing either demonstration dataset as part of this change.
- Adding vendor logos, screenshots, or other externally sourced visual assets.

## Chosen Presentation Structure

The deck will contain seven slides in this order:

1. `01-introduction` — translated existing introduction.
2. `01a-ai-setup` — what the user needs before starting.
3. `01b-ai-prompt` — a prompt the user can copy into a local AI agent.
4. `01c-ai-review` — a plain-language safety and quality review.
5. `02-visible-human` — translated existing Visible Human CT demonstration.
6. `03-mri-dir` — translated existing MRI-DIR demonstration.
7. `04-references` — data and software references.

The existing slide paths and IDs remain unchanged. New alphabetical suffixes place the onboarding slides conceptually between the introduction and the first imaging case without renaming the existing slides.

### Slide 1: DICOM Slide

The existing hero slide will be translated. Its main message remains that the same local data supports stack viewing, MPR, and 3D volume rendering. Keyboard instructions, accessibility text, metric labels, and the poster caption will be English.

Proposed title:

> 2D, MPR, and 3D in one viewer

### Slide 2: What You Need

Narrative job: remove uncertainty about prerequisites before the user contacts an AI agent.

Proposed title:

> Start with three things

Content, expressed as a simple numbered sequence rather than a dashboard of cards:

1. A desktop or coding AI agent that can read and edit a local folder.
2. The project URL: `https://github.com/ThalesMMS/dicom-slides`.
3. An anonymized DICOM folder or a ZIP containing the DICOM files.

The slide will explain that an ordinary chat-only window is insufficient if it cannot open local folders or run the repository's tools. Product names may appear as examples, but capability—not brand—is the selection criterion.

### Slide 3: Copy-ready Prompt

Narrative job: give the layperson exact language that produces a useful first agent run.

Proposed title:

> Give your agent a clear starting point

The visible prompt will be concise enough to fit at normal presentation size:

> Use https://github.com/ThalesMMS/dicom-slides as the starting point for an English presentation with my own imaging cases. My anonymized DICOM files are in `<PATH TO MY DICOM FOLDER OR ZIP>`. Work in a local copy of the repository. Use its existing conversion and validation tools, add my processed studies to the presentation, preserve the interactive viewer, update titles and references, and test the result. Do not copy or commit my raw DICOM files or ZIP. Stop and tell me if you find identifying information or cannot verify that the inputs are anonymized. When finished, tell me which files changed and how to open the presentation.

A short note will tell users to replace the angle-bracket placeholder with the real path shown by their computer, for example `C:\Cases\Teaching\case-01.zip` or `/Users/me/Cases/case-01`.

### Slide 4: Review Before Sharing

Narrative job: make the user responsible for a final privacy, functionality, and attribution check.

Proposed title:

> Check the result before you share it

The review will contain four plain-language checks:

1. **Privacy:** confirm that no patient name, identifier, date, institution, or other identifying metadata appears.
2. **Repository safety:** confirm that raw DICOM directories and ZIP files remain outside Git and GitHub.
3. **Functionality:** open every case and test the image stack, MPR, 3D, series selection, and slide navigation.
4. **Credits:** verify the dataset license, attribution, and project citation before presenting or publishing.

The slide will state that the human remains responsible for the final review; the agent's output is not an anonymization certificate.

### Slides 5 and 6: Demonstration Cases

All Portuguese copy, labels, status text, accessibility text, and derived study/series display titles will be translated. Technical dataset names, case IDs, series names such as `T1Post1`, and DOI values remain unchanged.

### Slide 7: References

Narrative job: close the deck with copyable credits that satisfy the included data terms and make reuse of the project straightforward.

The slide will use a restrained reference layout with three entries and readable URLs:

1. **Visible Human Project**
   - National Library of Medicine (U.S.). *The Visible Human Project*.
   - `https://www.nlm.nih.gov/research/visible/visible_human.html`
   - Required attribution: “Courtesy of the U.S. National Library of Medicine.”
   - Short clarification: NLM does not endorse this project.
2. **MRI-DIR**
   - Ger, R. B., et al. (2018). *Data from Synthetic and Phantom MR Images for Determining Deformable Image Registration Accuracy (MRI-DIR)* (Version 1). The Cancer Imaging Archive.
   - `https://doi.org/10.7937/K9/TCIA.2018.3f08iejt`
   - CC BY 4.0.
3. **DICOM Slides**
   - Santos, T. M. M. (2026). *DICOM Slide: 2D, MPR, and 3D viewer* [Software].
   - `https://github.com/ThalesMMS/dicom-slides`
   - MIT License.

The project reference will be explicitly labeled as the line to copy when these slides are used as the basis for another presentation.

## Visual and Interaction Design

- Reuse the existing dark background, typography, accent colors, spacing, and responsive slide shell.
- Favor a flat numbered progression, a large prompt block, and a simple checklist. Avoid dense card grids and vendor-branded UI imitations.
- Add only the CSS needed for the onboarding and reference compositions.
- Keep titles to one line at normal desktop presentation sizes.
- Preserve keyboard navigation, fullscreen behavior, iframe isolation, print behavior, and viewer expansion.
- Keep body text at or above the deck's existing readable scale; shorten copy before reducing type.
- Use semantic HTML, English `lang` attributes, descriptive `aria-label` values, and visible URLs that remain useful in exported screenshots or PDFs.
- Do not add external images or decorative assets; the current CT poster remains the only hero image.

## Translation Boundary

### Translate

- All Markdown documentation authored by this project.
- All visible slide content, document titles, captions, status messages, accessibility labels, and help text.
- Viewer buttons, tool labels, transfer-function labels, loading text, warnings, errors, and fallbacks.
- Python and JavaScript comments, module docstrings, CLI help, authored exception messages, and validation output.
- Test names, test comments, assertion descriptions, and console summaries.
- Authored display titles and labels in current generated study and series manifests.
- `CITATION.cff` titles, messages, and other human-readable authored fields.

### Preserve

- Existing technical identifiers, filenames, directory names, study IDs, series IDs, UIDs, event names, API names, formats, CSS selectors, and command names.
- Original DICOM-derived metadata, even when it contains another language.
- Deliberately multilingual test fixtures used to validate DICOM character-set handling, including French and Czech sample metadata.
- Personal names and their correct diacritics.
- Verbatim third-party license, attribution, and legal-notice files.
- URLs, DOI values, hashes, encoded chunks, pixel data, geometry, and numerical metadata.

## Source-of-truth Strategy

Translation must occur upstream where text is generated:

- Change importer and converter defaults such as CT series titles, window preset labels, fallback series descriptions, and CLI descriptions to English.
- Regenerate or synchronously update checked-in `study.json`/`study.js` and `manifest.json`/`manifest.js` pairs so both forms remain byte-equivalent in meaning.
- Update tests to assert the new English output.
- Do not edit compressed chunk payloads because they contain image data, not authored prose.

This avoids a repository in which checked-in examples are English but the next conversion silently recreates Portuguese labels.

## Documentation and Citation Updates

- Rewrite `README.md`, `DATA_LICENSES.md`, and `CITING.md` in clear English.
- Translate supporting documentation under `docs/`, `presentation/`, `runtime/`, and `exams/`.
- Keep command examples technically valid and use English example names for hypothetical new studies.
- Update `CITATION.cff` to use the English project title and include the canonical GitHub repository URL.
- Keep the MIT project license separate from the imaging-data terms.
- Explain that the Visible Human Project data are public-domain data distributed under NLM terms, including the exact required courtesy phrase and the prohibition on implying NLM endorsement.
- Retain the MRI-DIR dataset citation, DOI, CC BY 4.0 attribution, and TCIA notice.

## Privacy and Safety Behavior

- Raw DICOM inputs remain in `exams/inbox/` or another ignored local path and must not be added to Git.
- Slides and documentation will avoid stating that the converter guarantees anonymization.
- The copy-ready prompt instructs the agent to stop and report possible identifiers.
- The review slide instructs the user to perform a final human privacy check before publication.
- The medical-use disclaimer remains prominent and will be translated without weakening it: demonstration, education, and research only; not for diagnosis or clinical decision-making.

## Error Handling

- Existing presentation loading errors will be translated without changing control flow.
- New slides are static and require no network access, clipboard API, or vendor-specific integration.
- URLs will be ordinary visible links so they still work when opened over `file://` and remain readable if the slide is captured as an image.
- If a study lacks an authored English title, the runtime fallback will be English while untouched DICOM source descriptions remain as received.

## Verification Strategy

Implementation will follow test-driven development:

1. Add or update structural tests first so they fail for the missing onboarding/reference slides and Portuguese expected strings.
2. Implement the English copy and new slide structure.
3. Update source generators and synchronized generated manifests.
4. Run all Python, JavaScript, project-validation, and browser test suites.
5. Add a controlled language audit for known Portuguese prose tokens. The audit must allow personal names, third-party legal text, and multilingual DICOM fixtures rather than treating every non-ASCII character as an error.
6. Open the complete deck through the local server and inspect all seven slides individually at common 16:9 desktop dimensions and a narrow responsive viewport.
7. Check for clipping, unexpected wrapping, overlap, inaccessible labels, broken navigation, broken links, viewer expansion regressions, and unreadable reference text.
8. Exercise both demonstration studies in stack, MPR, and 3D modes and run the existing orientation/browser regression tests.

## Acceptance Criteria

- The deck contains the seven slides in the specified order.
- All audience-facing content is English.
- The three onboarding slides are understandable without programming knowledge.
- The prompt includes the exact canonical repository URL and an obvious DICOM directory/ZIP placeholder.
- The privacy and raw-DICOM warnings are visible, not hidden only in documentation.
- The last slide includes Visible Human, MRI-DIR, and DICOM Slides references.
- The exact NLM courtesy phrase is present and no NLM endorsement is implied.
- The DICOM Slides reference points to `https://github.com/ThalesMMS/dicom-slides` and is labeled for reuse.
- All project-authored prose in documentation, UI, source comments/docstrings, CLI output, and tests is English.
- Technical identifiers, original DICOM metadata, personal names, test encoding fixtures, and third-party license text remain intact.
- Current generated JSON/JavaScript data pairs remain consistent.
- All automated tests and project validation pass.
- Visual inspection finds no unintended overlap, clipping, or unreadable text.
- The presentation continues to work through direct `file://` opening and the local HTTP server.

## Authoritative Sources

- National Library of Medicine, Visible Human Project: `https://www.nlm.nih.gov/research/visible/visible_human.html`
- National Library of Medicine Terms and Conditions: `https://www.nlm.nih.gov/databases/download/terms_and_conditions.html`
- MRI-DIR collection citation: `https://doi.org/10.7937/K9/TCIA.2018.3f08iejt`
- DICOM Slides repository: `https://github.com/ThalesMMS/dicom-slides`

## Open Questions

None. The approved scope establishes English for all project-authored human-readable text while preserving technical and third-party source material.
