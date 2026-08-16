(function (global) {
  "use strict";

  function post(command, value) {
    global.parent.postMessage({ source: "dicom-slide-slide", command, value }, "*");
  }

  document.addEventListener("dicom-expand-request", (event) => {
    post("set-expanded", Boolean(event.detail && event.detail.expanded));
  });

  global.addEventListener("message", (event) => {
    const message = event.data;
    if (!message || message.source !== "dicom-slide-deck" || message.command !== "set-expanded") return;
    const expanded = Boolean(message.value);
    document.querySelector(".study-slide")?.classList.toggle("viewer-expanded", expanded);
    document.querySelector("dicom-study-viewer")?.setExpanded(expanded);
  });

  document.addEventListener("keydown", (event) => {
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    const isInteractive = path.some(
      (node) => node instanceof Element
        && node.matches("dicom-study-viewer,input,button,select,textarea,[contenteditable='true']")
    );
    if (isInteractive) return;

    if (["ArrowRight", "PageDown", " "].includes(event.key)) post("next");
    else if (["ArrowLeft", "PageUp"].includes(event.key)) post("previous");
    else if (event.key === "Home") post("first");
    else if (event.key === "End") post("last");
    else if (event.key.toLowerCase() === "f") post("fullscreen");
    else return;
    event.preventDefault();
  });
})(window);
