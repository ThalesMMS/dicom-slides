#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..", "..");
const hostPath = path.join(root, "powerpoint", "powerpoint-host.js");
assert.ok(fs.existsSync(hostPath), "PowerPoint host expansion module must exist");
const source = fs.readFileSync(hostPath, "utf8");
const frameKey = "dicomSlides.powerPoint.frame.v1";

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

function createSettings(log) {
  return {
    stored: {},
    get(key) { return this.stored[key] || null; },
    set(key, value) {
      log.push(["settings.set", key, value]);
      if (value == null) delete this.stored[key];
      else this.stored[key] = value;
    },
    saveAsync(callback) {
      log.push(["settings.save"]);
      setImmediate(() => callback({ status: "succeeded" }));
    },
  };
}

function createShape(log, id = "content-app-1") {
  const values = { left: 48, top: 36, width: 624, height: 351 };
  const shape = { id, type: "ContentApp" };
  for (const property of ["left", "top", "width", "height"]) {
    Object.defineProperty(shape, property, {
      enumerable: true,
      get() { return values[property]; },
      set(value) {
        log.push([`shape.${property}`, value]);
        values[property] = value;
      },
    });
  }
  return shape;
}

function createPowerPoint(log, shapes, options = {}) {
  const slide = {
    id: "slide-1",
    shapes: {
      items: shapes,
      load(properties) { log.push(["slideShapes.load", properties]); },
      getItem(id) {
        const shape = shapes.find((entry) => entry.id === id);
        if (!shape) throw new Error(`Missing shape ${id}`);
        return shape;
      },
    },
  };
  const collection = (name, items) => ({
    items,
    load(properties) { log.push([`${name}.load`, properties]); },
  });
  return {
    async run(callback) {
      log.push(["PowerPoint.run"]);
      if (options.nativeError) throw options.nativeError;
      const context = {
        presentation: {
          getSelectedShapes: () => collection("selectedShapes", shapes),
          getSelectedSlides: () => collection("selectedSlides", [slide]),
          pageSetup: { slideWidth: 720, slideHeight: 405, load() {} },
          slides: { getItem: () => slide },
        },
        async sync() { log.push(["context.sync"]); },
      };
      return callback(context);
    },
  };
}

function createHarness({ supported = true, shapes = null, host = "PowerPoint", nativeError = null } = {}) {
  const log = [];
  const settings = createSettings(log);
  const contentShapes = shapes || [createShape(log)];
  const viewer = {
    async setExpanded(value) { log.push(["viewer.setExpanded", Boolean(value)]); },
  };
  const stateChanges = [];
  const statuses = [];
  const context = vm.createContext({
    console: { log: console.log, error: console.error, warn() {} },
    setImmediate,
    window: null,
    Office: {
      AsyncResultStatus: { Failed: "failed", Succeeded: "succeeded" },
      HostType: { PowerPoint: "PowerPoint" },
      context: {
        host,
        document: { settings },
        requirements: { isSetSupported: () => supported },
      },
    },
    PowerPoint: createPowerPoint(log, contentShapes, { nativeError }),
  });
  context.window = context;
  context.globalThis = context;
  vm.runInContext(source, context, { filename: "powerpoint/powerpoint-host.js" });
  const controller = context.DicomSlidesPowerPointHost.createExpansionController({
    getViewer: () => viewer,
    onExpandedChange: (value) => stateChanges.push(Boolean(value)),
    onStatus: (message) => statuses.push(message),
  });
  return { contentShapes, controller, log, settings, stateChanges, statuses };
}

async function testNativeExpandAndRestore() {
  const harness = createHarness();
  const shape = harness.contentShapes[0];

  assert.equal(await harness.controller.setExpanded(true), true);
  assert.deepEqual(
    { left: shape.left, top: shape.top, width: shape.width, height: shape.height },
    { left: 0, top: 0, width: 720, height: 405 },
  );
  assert.deepEqual(JSON.parse(JSON.stringify(harness.settings.stored[frameKey])), {
    expanded: true,
    native: true,
    slideId: "slide-1",
    shapeId: "content-app-1",
    left: 48,
    top: 36,
    width: 624,
    height: 351,
  });
  assert.ok(
    harness.log.findIndex(([name]) => name === "settings.save")
      < harness.log.findIndex(([name]) => name === "shape.left"),
    "original geometry must be persisted before the content app is resized",
  );
  assert.ok(
    harness.log.findIndex(([name]) => name === "context.sync")
      < harness.log.findIndex(([name]) => name === "slideShapes.load"),
    "the active slide must be resolved before its shapes are loaded",
  );

  assert.equal(await harness.controller.setExpanded(false), false);
  assert.deepEqual(
    { left: shape.left, top: shape.top, width: shape.width, height: shape.height },
    { left: 48, top: 36, width: 624, height: 351 },
  );
  assert.equal(harness.settings.stored[frameKey], undefined);
  assert.match(harness.statuses.at(-1), /restored on the slide/i);
  assert.deepEqual(harness.stateChanges, [true, false]);
  assert.deepEqual(
    harness.log.filter(([name]) => name === "viewer.setExpanded"),
    [["viewer.setExpanded", true], ["viewer.setExpanded", false]],
  );
}

async function testUnsupportedPowerPointDoesNotPretendToFillTheSlide() {
  const harness = createHarness({ supported: false });

  assert.equal(await harness.controller.setExpanded(true), false);
  await flush();
  assert.equal(harness.log.some(([name]) => name === "PowerPoint.run"), false);
  assert.deepEqual(harness.log.filter(([name]) => name === "viewer.setExpanded"), [["viewer.setExpanded", false]]);
  assert.equal(harness.settings.stored[frameKey], undefined);
  assert.match(harness.statuses.at(-1), /requires PowerPoint 16\.105/i);
}

async function testNativeFailureIsReportedWithoutFakeFullscreen() {
  const harness = createHarness({ nativeError: new Error("native resize rejected") });

  assert.equal(await harness.controller.setExpanded(true), false);
  assert.equal(harness.settings.stored[frameKey], undefined);
  assert.deepEqual(harness.stateChanges, [false]);
  assert.match(harness.statuses.at(-1), /native resize rejected/i);
}

async function testBrowserPreviewCanStillExpandInsideItsFrame() {
  const harness = createHarness({ supported: false, host: null });

  assert.equal(await harness.controller.setExpanded(true), true);
  assert.equal(harness.settings.stored[frameKey].native, false);
  assert.match(harness.statuses.at(-1), /current add-in frame/i);

  assert.equal(await harness.controller.setExpanded(false), false);
  assert.match(harness.statuses.at(-1), /viewer size restored/i);
}

async function testAmbiguousContentAppsReportFailure() {
  const log = [];
  const first = createShape(log, "content-app-1");
  const second = createShape(log, "content-app-2");
  const harness = createHarness({ shapes: [first, second] });

  assert.equal(await harness.controller.setExpanded(true), false);
  assert.deepEqual({ left: first.left, top: first.top }, { left: 48, top: 36 });
  assert.deepEqual({ left: second.left, top: second.top }, { left: 48, top: 36 });
  assert.equal(harness.settings.stored[frameKey], undefined);
  assert.match(harness.statuses.at(-1), /identify one content add-in/i);
}

(async () => {
  await testNativeExpandAndRestore();
  await testUnsupportedPowerPointDoesNotPretendToFillTheSlide();
  await testNativeFailureIsReportedWithoutFakeFullscreen();
  await testBrowserPreviewCanStillExpandInsideItsFrame();
  await testAmbiguousContentAppsReportFailure();
  console.log("PowerPoint host expansion tests passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
