(function (global) {
  "use strict";

  const studies = Object.freeze([
    Object.freeze({
      id: "mri-dir-t1-mr",
      label: "MRI-DIR — synthetic T1 MR",
      studyId: "mri-dir-t1-mr",
      studyUrl: "../exams/library/mri-dir-t1-mr/study.js",
      defaultSeries: "1",
      defaultMode: "stack",
      defaultPreset: "default",
      defaultSlice: 6,
      modality: "MR",
    }),
    Object.freeze({
      id: "visible-human-abdomen-ct",
      label: "Visible Human — abdominal CT",
      studyId: "visible-human-abdomen-ct",
      studyUrl: "../exams/library/visible-human-abdomen-ct/study.js",
      defaultSeries: "1",
      defaultMode: "stack",
      defaultPreset: "abdomen",
      defaultSlice: 49,
      modality: "CT",
    }),
  ]);

  global.DicomSlidesPowerPoint = Object.freeze({
    version: "1.0.0",
    studies,
  });
})(window);
