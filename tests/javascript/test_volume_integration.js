#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..", "..");
const context = {
  console,
  performance,
  setTimeout,
  clearTimeout,
  requestAnimationFrame: (callback) => callback(),
};
context.window = context;
vm.createContext(context);
const runtimeScripts = [
  "runtime/core/data-registry.js",
  "runtime/volume/transfer-functions.js",
  "runtime/volume/geometry.js",
  "runtime/volume/volume-loader.js",
  "runtime/volume/webgl-renderer.js",
  "runtime/volume/mpr-viewer.js",
  "runtime/volume/volume-viewer.js",
];
const portugueseRuntimeProse = /\b(?:Módulo volumétrico|Arrasto|janela padrão|série|séries|sombreamento|usuário|botão|domínio|opacidade|câmera|faixa dinâmica|qualidade plena|não inicializado)\b/iu;
const runtimeProseFiles = [...runtimeScripts, "runtime/core/viewer.js"];
for (const filename of runtimeProseFiles) {
  const source = fs.readFileSync(path.join(root, filename), "utf8");
  assert.doesNotMatch(source, portugueseRuntimeProse, `${filename} still contains Portuguese prose`);
}
for (const filename of runtimeScripts) {
  vm.runInContext(fs.readFileSync(path.join(root, filename), "utf8"), context, { filename });
}
const api = context.DicomSlideVolume;
assert.ok(api, "DicomSlideVolume was not exported");

const identityManifest = {
  pixelType: "int16-le",
  sortMode: "spatial",
  dimensions: { columns: 4, rows: 3, slices: 2 },
  spacing: { column: 0.5, row: 0.75, slice: 2 },
  orientationLPS: [1, 0, 0, 0, 1, 0],
  chunks: [{ index: 0, firstSlice: 0, sliceCount: 2 }],
};
assert.equal(api.canLoadManifest(identityManifest).supported, true);
assert.equal(api.canLoadManifest({ ...identityManifest, pixelType: "rgb8" }).supported, false);
assert.equal(api.canLoadManifest({ ...identityManifest, sortMode: "instance" }).supported, false);

const affine = Array.from(api.buildAffineLPS(identityManifest));
assert.deepEqual(affine, [
  0.5, 0, 0, 0,
  0, 0.75, 0, 0,
  0, 0, 2, 0,
  0, 0, 0, 1,
]);
const planes = api.buildPlaneDefinitions(affine, "LPS");
assert.deepEqual(JSON.parse(JSON.stringify(planes)), {
  axial: {
    fixed: { axis: 2, sign: 1 },
    u: { axis: 0, sign: 1, screenSign: 1 },
    v: { axis: 1, sign: 1, screenSign: 1 },
  },
  coronal: {
    fixed: { axis: 1, sign: 1 },
    u: { axis: 0, sign: 1, screenSign: 1 },
    v: { axis: 2, sign: 1, screenSign: -1 },
  },
  sagittal: {
    fixed: { axis: 0, sign: 1 },
    u: { axis: 1, sign: 1, screenSign: 1 },
    v: { axis: 2, sign: 1, screenSign: -1 },
  },
});

const incompleteAxisPlanes = api.buildPlaneDefinitions([
  1, 1, 1, 0,
  0, 0, 0, 0,
  0, 0, 0, 0,
  0, 0, 0, 1,
], "LPS");
assert.deepEqual(
  JSON.parse(JSON.stringify(incompleteAxisPlanes)),
  JSON.parse(JSON.stringify(planes)),
  "Incomplete world-to-voxel mappings must fall back to the identity axes"
);

assert.equal(api.chooseTextureStride([512, 512, 234], 2048, 24 * 1024 * 1024), 2);
assert.equal(api.chooseTextureStride([256, 256, 100], 2048, 24 * 1024 * 1024), 1);
assert.equal(api.chooseTextureStride([4096, 16, 16], 2048, Number.MAX_SAFE_INTEGER), 2);

assert.ok(api.VIEW_MODES, "Explicit 2D/MPR/3D mode catalog is missing");
assert.ok(api.MPR_TOOLS, "MPR tool catalog is missing");
assert.ok(api.VOLUME_TOOLS, "3D tool catalog is missing");
assert.equal(typeof api.applyVolumetricToolDrag, "function", "Volumetric tool drag reducer is missing");
assert.ok(api.TRANSFER_FUNCTIONS, "3D transfer-function catalog is missing");
assert.equal(typeof api.getTransferFunction, "function", "Transfer-function resolver is missing");
assert.equal(typeof api.sampleTransferStops, "function", "Transfer-stop interpolation is missing");
assert.equal(typeof api.packTransferFunction, "function", "Transfer-function uniform packer is missing");
assert.equal(typeof api.selectTransferFunction, "function", "Transfer-function state selector is missing");
assert.deepEqual(JSON.parse(JSON.stringify(api.VIEW_MODES)), ["stack", "mpr", "volume"]);
assert.deepEqual(JSON.parse(JSON.stringify(api.MPR_TOOLS)), ["crosshair", "window", "pan", "zoom", "scroll"]);
assert.deepEqual(JSON.parse(JSON.stringify(api.VOLUME_TOOLS)), ["window", "pan", "zoom", "rotate"]);

const toolState = {
  mprCenter: 100,
  mprWidth: 200,
  mprTransforms: {
    axial: { panX: 2, panY: 3, zoom: 1 },
    coronal: { panX: 0, panY: 0, zoom: 1 },
    sagittal: { panX: 0, panY: 0, zoom: 1 },
  },
  volumeCenter: 300,
  volumeWidth: 600,
  volumePanX: 4,
  volumePanY: 5,
  quality: 224,
  yaw: 0.5,
  pitch: 0.25,
  zoom: 1.5,
};
// W/L drag follows cornerstone3D WindowLevelTool semantics: one multiplier for
// both axes — horizontal adds to width and vertical adds to center.
api.applyVolumetricToolDrag(toolState, {
  mode: "volume", tool: "window", center: 300, width: 600, multiplier: 3,
}, 10, -4);
assert.equal(toolState.volumeWidth, 630);
assert.equal(toolState.volumeCenter, 288);
api.applyVolumetricToolDrag(toolState, {
  mode: "mpr", tool: "window", center: 100, width: 200, multiplier: 0.5,
}, -6, 8);
assert.equal(toolState.mprWidth, 197);
assert.equal(toolState.mprCenter, 104);
// Without a valid multiplier, use cornerstone3D's default of 4.
api.applyVolumetricToolDrag(toolState, {
  mode: "mpr", tool: "window", center: 104, width: 197,
}, 1, 1);
assert.equal(toolState.mprWidth, 201);
assert.equal(toolState.mprCenter, 108);
toolState.mprCenter = 100;
toolState.mprWidth = 200;
toolState.volumeCenter = 300;
toolState.volumeWidth = 600;

// The multiplier comes from central-slice dynamic range / 1024 (rounded above
// 1), bounded by the declared range; a uniform slice uses the default of 4.
{
  const dims = [4, 4, 3];
  const plane = dims[0] * dims[1];
  const voxels = new Int16Array(plane * dims[2]);
  voxels[plane] = -1024;
  voxels[plane + 1] = 1976; // central slice: range 3000 → 3000/1024 ≈ 2.93 → 3
  assert.equal(api.computeWindowLevelMultiplier(voxels, dims, [-1024, 3071]), 3);
  assert.equal(api.computeWindowLevelMultiplier(voxels, dims, [-100, 156]), 0.25);
  const flat = new Int16Array(plane * dims[2]).fill(7);
  assert.equal(api.computeWindowLevelMultiplier(flat, dims, [-1024, 3071]), 4);
}

// MPR scroll: vertical drag traverses plane slices (about 8 px per slice).
toolState.crosshair = [10, 20, 30];
api.applyVolumetricToolDrag(toolState, {
  mode: "mpr", tool: "scroll", plane: "axial", axis: 2, axisSize: 100, slice: 30,
}, 0, 33);
assert.equal(toolState.crosshair[2], 34);
api.applyVolumetricToolDrag(toolState, {
  mode: "mpr", tool: "scroll", plane: "axial", axis: 2, axisSize: 100, slice: 30,
}, 0, -9999);
assert.equal(toolState.crosshair[2], 0, "MPR scrolling must clamp to the axis bounds");

api.applyVolumetricToolDrag(toolState, {
  mode: "mpr", tool: "pan", plane: "axial", panX: 2, panY: 3,
}, 10, -4);
assert.deepEqual(JSON.parse(JSON.stringify(toolState.mprTransforms.axial)), { panX: 12, panY: -1, zoom: 1 });
assert.equal(toolState.mprCenter, 100);
assert.equal(toolState.mprWidth, 200);

api.applyVolumetricToolDrag(toolState, {
  mode: "volume", tool: "rotate", yaw: 0.5, pitch: 0.25,
}, 10, -5);
assert.equal(toolState.yaw, 0.42);
assert.equal(toolState.pitch, 0.29);
assert.equal(toolState.volumePanX, 4);
assert.equal(toolState.volumePanY, 5);

api.applyVolumetricToolDrag(toolState, {
  mode: "volume", tool: "pan", panX: 4, panY: 5,
}, 8, -3);
assert.equal(toolState.volumePanX, 12);
assert.equal(toolState.volumePanY, 2);
assert.equal(toolState.zoom, 1.5);

assert.deepEqual(
  JSON.parse(JSON.stringify(api.TRANSFER_FUNCTIONS.map((preset) => preset.id))),
  ["angio", "airways", "bones-skin-1", "bones-skin-2", "bones-skin-3", "bones-bw", "skin-bw"]
);
assert.equal(api.DEFAULT_TRANSFER_FUNCTION_ID, "bones-skin-1");
assert.equal(api.getTransferFunction("missing").id, "bones-skin-1");

// Stops remain in modality units (HU), not normalized 0..1, and interpolation
// continues clamping out-of-range values at the endpoints.
assert.deepEqual(JSON.parse(JSON.stringify(api.TRANSFER_HU_DOMAIN)), [-1000, 1800]);
assert.equal(api.sampleTransferStops([{ position: 0, value: 0 }, { position: 1, value: 1 }], 0.25), 0.25);
assert.equal(api.sampleTransferStops([{ position: 150, value: 0 }, { position: 700, value: 0.65 }], -300), 0);
assert.equal(api.sampleTransferStops([{ position: 150, value: 0 }, { position: 700, value: 0.65 }], 5000), 0.65);
assert.equal(api.sampleTransferStops([{ position: 300, value: 0.2 }, { position: 700, value: 0.6 }], 500), 0.4);
assert.deepEqual(
  JSON.parse(JSON.stringify(api.sampleTransferStops([
    { position: 0, value: [0, 0, 0] },
    { position: 1, value: [1, 0.5, 0.25] },
  ], 0.5))),
  [0.5, 0.25, 0.125]
);

const packedBones = api.packTransferFunction("bones-skin-1");
assert.strictEqual(
  api.packTransferFunction("bones-skin-1"),
  packedBones,
  "Repeated transfer-function packs should reuse the same typed arrays"
);
assert.strictEqual(
  api.packTransferFunction("bones-skin-1", { minimum: 0, maximum: 2800 }),
  api.packTransferFunction("bones-skin-1", { minimum: 0, maximum: 2800 }),
  "Equivalent domain values should share a cached transfer-function pack"
);
assert.notStrictEqual(api.packTransferFunction("bones-skin-1", null, 1), packedBones);
assert.equal(packedBones.colorCount, 5);
assert.equal(packedBones.opacityCount, 7);
assert.equal(packedBones.colorStops.length, 32);
assert.equal(packedBones.opacityStops.length, 16);
assert.equal(packedBones.shading, true);
assert.equal(packedBones.gradientOpacityScale, 220);
// Isis model (#1588): color and opacity normalize to 0..1 over the shared native
// preset domain (-1000..1800 for "Bones and skin 1"), and the windowed value
// indexes the entire LUT — W/L sweeps the preset through the volume.
assert.equal(packedBones.colorStops[3], 0);
assert.equal(packedBones.colorStops[4 * 4 + 3], 1);
assert.ok(Math.abs(packedBones.colorStops[1 * 4 + 3] - (800 / 2800)) < 1e-6);
assert.ok(Math.abs(packedBones.opacityStops[0] - (750 / 2800)) < 1e-6);
// The preset supplies its own window (applyPreset): domain -1000..1800 → C 400/W 2800.
assert.deepEqual(JSON.parse(JSON.stringify(packedBones.window)), { center: 400, width: 2800 });
assert.deepEqual(JSON.parse(JSON.stringify(api.transferFunctionWindow("bones-skin-1"))), { center: 400, width: 2800 });
// Angio: color 100..700 and opacity 150..500 → shared domain 100..700.
assert.deepEqual(JSON.parse(JSON.stringify(api.transferFunctionDomain("angio"))), { minimum: 100, maximum: 700, span: 600 });
// Color uses linear light; white remains white and gray becomes darker.
assert.equal(api.srgbToLinear(1), 1);
assert.equal(api.srgbToLinear(0), 0);
assert.ok(api.srgbToLinear(0.5) < 0.25);

// Shift translates only opacity points (shiftVolumeOpacityPoints), in volume
// units converted to normalized preset space.
const shifted = api.packTransferFunction("bones-skin-1", null, 100);
assert.ok(Math.abs(shifted.opacityStops[0] - (850 / 2800)) < 1e-6);
assert.equal(shifted.colorStops[3], 0, "The shift must not move the color ramp");

// A non-HU series remaps the canonical domain over the volume range: normalized
// stops remain unchanged while native window and gradient threshold scale.
const remapped = api.packTransferFunction("bones-skin-1", { minimum: 0, maximum: 2800 });
assert.equal(api.transferDomainMapping({ minimum: 0, maximum: 2800 }).scale, 1);
assert.ok(Math.abs(remapped.opacityStops[0] - (750 / 2800)) < 1e-6);
assert.deepEqual(JSON.parse(JSON.stringify(remapped.window)), { center: 1400, width: 2800 });
assert.equal(remapped.gradientOpacityScale, 220);
const halved = api.packTransferFunction("bones-skin-1", { minimum: 0, maximum: 1400 });
assert.deepEqual(JSON.parse(JSON.stringify(halved.window)), { center: 700, width: 1400 });
assert.equal(halved.gradientOpacityScale, 110);

const shadingState = { transferFunctionId: "bones-skin-1", shading: true };
api.selectTransferFunction(shadingState, "airways");
assert.equal(shadingState.shading, false, "Selecting a preset must adopt its recommended shading");
api.selectTransferFunction(shadingState, "angio");
assert.equal(shadingState.shading, true);
// It also adopts the preset's native window (domain 100..700 → C 400/W 600).
assert.equal(shadingState.volumeCenter, 400);
assert.equal(shadingState.volumeWidth, 600);

const transferState = {
  transferFunctionId: "angio",
  volumeCenter: 400,
  volumeWidth: 800,
  quality: 224,
  yaw: 1,
  pitch: 0.2,
  zoom: 2,
  volumePanX: 7,
  volumePanY: -3,
};
const preservedTransferState = [
  transferState.quality,
  transferState.yaw,
  transferState.pitch,
  transferState.zoom,
  transferState.volumePanX,
  transferState.volumePanY,
];
api.selectTransferFunction(transferState, "bones-bw");
assert.equal(transferState.transferFunctionId, "bones-bw");
// The camera is preserved; W/L returns to the new preset's native domain
// (150..1800 → C 975/W 1650), as in OHIF applyPreset.
assert.equal(transferState.volumeCenter, 975);
assert.equal(transferState.volumeWidth, 1650);
assert.deepEqual([
  transferState.quality,
  transferState.yaw,
  transferState.pitch,
  transferState.zoom,
  transferState.volumePanX,
  transferState.volumePanY,
], preservedTransferState);

const source = new Int16Array([
  0, 1, 2, 3,
  4, 5, 6, 7,
  8, 9, 10, 11,
  12, 13, 14, 15,
]);
const reduced = api.downsampleNearest(source, [4, 2, 2], 2);
assert.deepEqual(Array.from(reduced.dimensions), [2, 1, 1]);
assert.deepEqual(Array.from(reduced.voxels), [0, 2]);

const camera = api.buildOrbitCamera({ offsetDirection: [0, -1, 0], up: [0, 0, 1] }, 0.4, -0.25);
assert.equal(camera.rotation.length, 9);
assert.ok(Array.from(camera.rotation).every(Number.isFinite));
const right = Array.from(camera.rotation.slice(0, 3));
const up = Array.from(camera.rotation.slice(3, 6));
const forward = Array.from(camera.rotation.slice(6, 9));
const dot = (a, b) => a.reduce((sum, value, index) => sum + value * b[index], 0);
const length = (a) => Math.sqrt(dot(a, a));
assert.ok(Math.abs(length(right) - 1) < 1e-5);
assert.ok(Math.abs(length(up) - 1) < 1e-5);
assert.ok(Math.abs(length(forward) - 1) < 1e-5);
assert.ok(Math.abs(dot(right, up)) < 1e-5);
assert.ok(Math.abs(dot(right, forward)) < 1e-5);
assert.ok(Math.abs(dot(up, forward)) < 1e-5);

for (const manifestPath of [
  "exams/library/visible-human-abdomen-ct/series/frozen-ct/manifest.json",
  "exams/library/mri-dir-t1-mr/series/series-1-t1post1-4d84985/manifest.json",
]) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, manifestPath), "utf8"));
  const capability = api.canLoadManifest(manifest);
  assert.equal(capability.supported, true, `${manifest.caseId}: ${capability.reason || "unsupported"}`);
  const realPlanes = api.buildPlaneDefinitions(api.buildAffineLPS(manifest), "LPS");
  for (const definition of Object.values(realPlanes)) {
    const axes = [definition.fixed.axis, definition.u.axis, definition.v.axis];
    assert.equal(new Set(axes).size, 3, `${manifest.caseId}: plane axes must be distinct`);
  }
}

const mriDirStudyPath = path.join(root, "exams/library/mri-dir-t1-mr/study.json");
const mriDirStudy = JSON.parse(fs.readFileSync(mriDirStudyPath, "utf8"));
assert.deepEqual(
  mriDirStudy.series.map((series) => String(series.number)),
  ["1", "2", "3", "4"],
  "MRI-DIR must publish every series in Series Number order"
);
assert.deepEqual(
  mriDirStudy.series.map((series) => series.slices),
  [14, 14, 14, 14],
  "MRI-DIR series image counts must match the source study"
);
assert.equal(
  mriDirStudy.series.reduce((total, series) => total + series.slices, 0),
  56,
  "MRI-DIR must publish all 56 source images"
);
for (const series of mriDirStudy.series) {
  const manifestPath = path.join(root, "exams/library/mri-dir-t1-mr", series.manifest.replace(/\.js$/, ".json"));
  assert.ok(fs.existsSync(manifestPath), `Missing MRI-DIR manifest: ${manifestPath}`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert.equal(manifest.caseId, series.caseId);
  assert.equal(manifest.dimensions.slices, series.slices);
  assert.equal(manifest.source.studyDescription, "MRI HEAD WITHOUT CON");
  assert.equal(api.canLoadManifest(manifest).supported, true, `${manifest.caseId} must support MPR/3D`);
  for (const chunk of manifest.chunks) {
    const chunkPath = path.join(path.dirname(manifestPath), chunk.script);
    assert.ok(fs.existsSync(chunkPath), `Missing MRI-DIR chunk: ${chunkPath}`);
  }
}

const visibleHumanStudy = JSON.parse(fs.readFileSync(
  path.join(root, "exams/library/visible-human-abdomen-ct/study.json"),
  "utf8"
));
assert.deepEqual(visibleHumanStudy.series.map((series) => series.slices), [100, 301]);
assert.equal(visibleHumanStudy.source.attribution, "Courtesy of the U.S. National Library of Medicine");

console.log("OK: multi-series volume integration, tools, transfer functions, geometry, and downsampling passed");
