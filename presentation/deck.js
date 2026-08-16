(function (global) {
  "use strict";

  const catalog = global.DicomSlideSlides || [];
  const deck = document.getElementById("deck");
  const progress = document.getElementById("progress-bar");
  const counter = document.getElementById("slide-counter");
  const previousButton = document.getElementById("previous-slide");
  const nextButton = document.getElementById("next-slide");
  let current = 0;

  const slides = catalog.map((entry, index) => {
    const section = document.createElement("section");
    section.className = "deck-slide";
    section.dataset.slideId = entry.id;
    section.setAttribute("aria-hidden", "true");

    const frame = document.createElement("iframe");
    frame.title = entry.title;
    frame.loading = index < 2 ? "eager" : "lazy";
    frame.addEventListener("error", () => {
      section.innerHTML = `<div class="deck-slide-error">Could not load slide “${entry.title}”.</div>`;
    });
    section.appendChild(frame);
    deck.appendChild(section);
    return { entry, section, frame, loaded: false };
  });

  function loadSlide(index) {
    const slide = slides[index];
    if (!slide || slide.loaded) return;
    slide.loaded = true;
    slide.frame.src = slide.entry.src;
  }

  function setExpanded(expanded, sourceFrame) {
    document.body.classList.toggle("viewer-is-expanded", Boolean(expanded));
    for (const slide of slides) {
      const active = Boolean(expanded) && slide.frame.contentWindow === sourceFrame;
      if (slide.frame.contentWindow) {
        slide.frame.contentWindow.postMessage({
          source: "dicom-slide-deck",
          command: "set-expanded",
          value: active,
        }, "*");
      }
    }
  }

  function fromHash() {
    const parsed = Number(global.location.hash.replace("#", ""));
    return Number.isInteger(parsed) && parsed >= 1 ? parsed - 1 : 0;
  }

  function showSlide(index, updateHash) {
    if (!slides.length) return;
    setExpanded(false, null);
    current = Math.max(0, Math.min(slides.length - 1, index));
    for (const neighbor of [current - 1, current, current + 1]) loadSlide(neighbor);

    slides.forEach((slide, slideIndex) => {
      const active = slideIndex === current;
      slide.section.classList.toggle("active", active);
      slide.section.setAttribute("aria-hidden", String(!active));
    });
    progress.style.width = `${((current + 1) / slides.length) * 100}%`;
    counter.textContent = `${current + 1} / ${slides.length}`;
    previousButton.disabled = current === 0;
    nextButton.disabled = current === slides.length - 1;
    document.title = `${slides[current].entry.title} — DICOM Slide`;
    if (updateHash !== false) global.history.replaceState(null, "", `#${current + 1}`);
  }

  previousButton.addEventListener("click", () => showSlide(current - 1));
  nextButton.addEventListener("click", () => showSlide(current + 1));

  document.addEventListener("keydown", (event) => {
    if (["INPUT", "BUTTON", "SELECT", "TEXTAREA"].includes(event.target.tagName)) return;
    if (["ArrowRight", "PageDown", " "].includes(event.key)) showSlide(current + 1);
    else if (["ArrowLeft", "PageUp"].includes(event.key)) showSlide(current - 1);
    else if (event.key === "Home") showSlide(0);
    else if (event.key === "End") showSlide(slides.length - 1);
    else if (event.key.toLowerCase() === "f") document.documentElement.requestFullscreen?.();
    else return;
    event.preventDefault();
  });

  global.addEventListener("message", (event) => {
    const message = event.data;
    if (!message || message.source !== "dicom-slide-slide") return;
    const owner = slides.find((slide) => slide.frame.contentWindow === event.source);
    if (!owner) return;
    if (message.command === "next") showSlide(current + 1);
    else if (message.command === "previous") showSlide(current - 1);
    else if (message.command === "first") showSlide(0);
    else if (message.command === "last") showSlide(slides.length - 1);
    else if (message.command === "fullscreen") document.documentElement.requestFullscreen?.();
    else if (message.command === "set-expanded") setExpanded(Boolean(message.value), event.source);
  });

  global.addEventListener("hashchange", () => showSlide(fromHash(), false));
  showSlide(fromHash(), false);
})(window);
