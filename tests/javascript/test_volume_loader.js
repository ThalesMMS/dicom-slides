#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..", "..");
const readRuntime = (filename) => fs.readFileSync(path.join(root, filename), "utf8");

function makeContext() {
  const context = { console, performance, setTimeout, clearTimeout };
  context.window = context;
  context.__DicomSlideInternal = {
    volume: {
      transfer: {},
      geometry: { buildAffineLPS: () => new Float64Array(16) },
    },
  };
  vm.createContext(context);
  vm.runInContext(readRuntime("runtime/volume/volume-loader.js"), context, {
    filename: "runtime/volume/volume-loader.js",
  });
  return context;
}

function manifestWith(chunks) {
  return {
    caseId: "loader-test",
    pixelType: "int16-le",
    sortMode: "spatial",
    dimensions: { columns: 2, rows: 2, slices: 3 },
    spacing: { column: 1, row: 1, slice: 1 },
    orientationLPS: [1, 0, 0, 0, 1, 0],
    chunks: chunks.map((chunk, index) => ({ index, ...chunk })),
  };
}

async function main() {
  const context = makeContext();
  const loader = context.__DicomSlideInternal.volume.loader;
  let chunkLengths = [4, 8];
  let loadCalls = 0;
  context.DicomSlideData = {
    loadChunk: async (_manifest, index) => {
      loadCalls += 1;
      return new Int16Array(chunkLengths[index]);
    },
  };

  const invalidLayouts = [
    manifestWith([{ firstSlice: 0, sliceCount: 1 }, { firstSlice: 2, sliceCount: 1 }]),
    manifestWith([{ firstSlice: 0, sliceCount: 2 }, { firstSlice: 1, sliceCount: 2 }]),
    manifestWith([{ firstSlice: 0.5, sliceCount: 1 }, { firstSlice: 1, sliceCount: 2 }]),
    manifestWith([{ firstSlice: 0, sliceCount: 2 }, { firstSlice: 2, sliceCount: 2 }]),
    manifestWith([{ index: 1, firstSlice: 0, sliceCount: 1 }, { index: 0, firstSlice: 1, sliceCount: 2 }]),
  ];
  for (const manifest of invalidLayouts) {
    assert.equal(loader.canLoadManifest(manifest).supported, false);
    await assert.rejects(loader.loadFromManifest(manifest), /chunk|slice|coverage/i);
  }
  assert.equal(loadCalls, 0, "Invalid layouts must fail before loading any chunk");

  const validManifest = manifestWith([
    { firstSlice: 0, sliceCount: 1 },
    { firstSlice: 1, sliceCount: 2 },
  ]);
  chunkLengths = [5, 8];
  await assert.rejects(loader.loadFromManifest(validManifest), /holds 5 voxels; expected 4/);

  chunkLengths = [4, 8];
  const loaded = await loader.loadFromManifest(validManifest);
  assert.equal(loaded.voxels.length, 12);

  const brokenFacade = { console };
  brokenFacade.window = brokenFacade;
  brokenFacade.__DicomSlideInternal = {
    volume: { transfer: {}, geometry: {}, loader: {}, webgl: {}, mpr: {} },
  };
  vm.createContext(brokenFacade);
  assert.throws(
    () => vm.runInContext(readRuntime("runtime/volume/volume-viewer.js"), brokenFacade),
    /loaded out of order/
  );

  const fn = () => {};
  const partialFacade = { console };
  partialFacade.window = partialFacade;
  partialFacade.__DicomSlideInternal = {
    volume: {
      transfer: { packTransferFunction: fn },
      geometry: { buildAffineLPS: fn, buildPlaneDefinitions: fn, buildOrbitCamera: fn },
      loader: { loadFromManifest: fn, canLoadManifest: fn },
      webgl: { chooseTextureStride: fn, downsampleNearest: fn },
      mpr: { VolumeViewer: fn },
    },
  };
  vm.createContext(partialFacade);
  assert.throws(
    () => vm.runInContext(readRuntime("runtime/volume/volume-viewer.js"), partialFacade),
    /loaded out of order/,
    "The facade must reject modules missing any callable it exports"
  );

  console.log("OK: volume chunk validation and facade guards passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
