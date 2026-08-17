#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..", "..");
const componentPath = path.join(root, "runtime", "components", "dicom-study-viewer.js");

class FakeEventTarget {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) || [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }
  removeEventListener(type, handler) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter((entry) => entry !== handler));
  }
  dispatchEvent(event) {
    for (const handler of this.listeners.get(event.type) || []) handler(event);
    return true;
  }
}

class FakeHTMLElement extends FakeEventTarget {
  attachShadow() {
    this.shadowRoot = { append() {} };
  }
}

class FakeCustomEvent {
  constructor(type, options = {}) {
    this.type = type;
    Object.assign(this, options);
  }
}

const registry = new Map();
const sandbox = {
  console,
  URL,
  HTMLElement: FakeHTMLElement,
  CustomEvent: FakeCustomEvent,
  customElements: {
    get: (name) => registry.get(name),
    define: (name, value) => registry.set(name, value),
  },
  document: {
    createElement() {
      return { append() {}, replaceChildren() {} };
    },
  },
  window: null,
  DicomSlide: { baseUrl: "https://example.test/runtime/", ready: Promise.resolve() },
};
sandbox.window = sandbox;
vm.runInNewContext(fs.readFileSync(componentPath, "utf8"), sandbox, { filename: componentPath });

const element = new sandbox.DicomSlide.DicomStudyViewerElement();
const viewerRoot = new FakeEventTarget();
const viewer = {
  root: viewerRoot,
  getState: () => ({ activeTool: "pan" }),
};
let forwarded = null;
element.addEventListener("dicom-state-change", (event) => { forwarded = event.detail; });
element._bindViewerEvents(viewer);
viewerRoot.dispatchEvent(new FakeCustomEvent("toolchange", { detail: { activeTool: "pan" } }));

assert.deepEqual(
  JSON.parse(JSON.stringify(forwarded)),
  { activeTool: "pan" },
  "keyboard tool shortcuts must update external controls before the tool is used",
);
console.log("DICOM component event forwarding tests passed.");
