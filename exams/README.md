# Study workflow

1. Put the raw DICOM directory or ZIP in `exams/inbox/`.
2. Convert it into a browser package:

   ```console
   python tools/convert_study.py exams/inbox/my-exam.zip exams/library/my-exam --study-id my-exam
   ```

3. Validate the result:

   ```console
   python tools/validate_project.py exams/library/my-exam
   ```

4. Reference `exams/library/my-exam/study.js` from a `<dicom-study-viewer>`.

`inbox/` is intentionally ignored. `library/` contains processed,
self-registering JavaScript packages that work over HTTP and `file://`.

Included data have their own licenses, separate from the code's MIT license.
Read [`../DATA_LICENSES.md`](../DATA_LICENSES.md) before adding,
redistributing, or presenting images.
