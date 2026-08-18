"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const zlib = require("node:zlib");

const manifests = new Map();
const chunks = new Map();
global.DicomSlide = { ready: Promise.resolve() };
global.DicomSlideData = {
  registerManifest(caseId, manifest) { manifests.set(caseId, manifest); },
  registerChunk(caseId, index, encoded) { chunks.set(`${caseId}:${index}`, encoded); },
};
global.__DICOM_SLIDE_STUDIES__ = {};
global.OpenJPEGWASM = require(path.resolve(
  __dirname,
  "../../powerpoint/vendor/openjpeg/openjpegwasm_decode.js",
));

require(path.resolve(__dirname, "../../powerpoint/dicom-importer.js"));
const importer = global.DicomSlidesImporter;
assert(importer, "importer API was not registered");

const LONG_VR = new Set(["OB", "OD", "OF", "OL", "OW", "SQ", "UC", "UR", "UT", "UN", "OV", "SV", "UV"]);

function concat(parts) {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function u16(value, little = true) {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value, little);
  return bytes;
}

function u32(value, little = true) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, little);
  return bytes;
}

function textPayload(value, vr) {
  const encoder = new TextEncoder();
  let bytes = encoder.encode(value);
  if (bytes.length % 2) {
    const padded = new Uint8Array(bytes.length + 1);
    padded.set(bytes);
    padded[padded.length - 1] = vr === "UI" ? 0 : 0x20;
    bytes = padded;
  }
  return bytes;
}

function element(group, item, vr, payload, little = true) {
  payload = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
  const tag = concat([u16(group, little), u16(item, little)]);
  const vrBytes = new TextEncoder().encode(vr);
  if (LONG_VR.has(vr)) {
    return concat([tag, vrBytes, new Uint8Array(2), u32(payload.length, little), payload]);
  }
  return concat([tag, vrBytes, u16(payload.length, little), payload]);
}

function usElement(group, item, value) {
  return element(group, item, "US", u16(value));
}

function makeDicom({
  instance = 1,
  z = 0,
  studyUid = "1.2.3.4.5",
  seriesUid = "1.2.3.4.5.6",
  bitsStored = 16,
  highBit = 15,
  pixelValues = [1024, 1025, 1026, 1027],
  rescaleIntercept = -1024,
  includeFileMeta = true,
  transferSyntax = "1.2.840.10008.1.2.1",
} = {}) {
  const preamble = new Uint8Array(132);
  preamble.set(new TextEncoder().encode("DICM"), 128);
  const meta = [
    element(0x0002, 0x0010, "UI", textPayload(transferSyntax, "UI")),
  ];
  const pixels = new Uint8Array(8);
  const pixelView = new DataView(pixels.buffer);
  pixelValues.forEach((value, index) => pixelView.setUint16(index * 2, value, true));
  const dataset = [
    element(0x0008, 0x0060, "CS", textPayload("CT", "CS")),
    element(0x0008, 0x0080, "LO", textPayload("Hospital Example", "LO")),
    element(0x0008, 0x1030, "LO", textPayload("Browser Import Test", "LO")),
    element(0x0008, 0x103e, "LO", textPayload("Axial CT", "LO")),
    element(0x0010, 0x0010, "PN", textPayload("Jane^Doe", "PN")),
    element(0x0010, 0x0020, "LO", textPayload("PATIENT-123", "LO")),
    element(0x0020, 0x000d, "UI", textPayload(studyUid, "UI")),
    element(0x0020, 0x000e, "UI", textPayload(seriesUid, "UI")),
    element(0x0020, 0x0011, "IS", textPayload("1", "IS")),
    element(0x0020, 0x0013, "IS", textPayload(String(instance), "IS")),
    element(0x0020, 0x0032, "DS", textPayload(`0\\0\\${z}`, "DS")),
    element(0x0020, 0x0037, "DS", textPayload("1\\0\\0\\0\\1\\0", "DS")),
    usElement(0x0028, 0x0002, 1),
    element(0x0028, 0x0004, "CS", textPayload("MONOCHROME2", "CS")),
    usElement(0x0028, 0x0010, 2),
    usElement(0x0028, 0x0011, 2),
    element(0x0028, 0x0030, "DS", textPayload("1\\1", "DS")),
    usElement(0x0028, 0x0100, 16),
    usElement(0x0028, 0x0101, bitsStored),
    usElement(0x0028, 0x0102, highBit),
    usElement(0x0028, 0x0103, 0),
    element(0x0028, 0x1050, "DS", textPayload("40", "DS")),
    element(0x0028, 0x1051, "DS", textPayload("400", "DS")),
    element(0x0028, 0x1052, "DS", textPayload(String(rescaleIntercept), "DS")),
    element(0x0028, 0x1053, "DS", textPayload("1", "DS")),
    element(0x7fe0, 0x0010, "OW", pixels),
  ];
  return includeFileMeta ? concat([preamble, ...meta, ...dataset]) : concat(dataset);
}

function encapsulatedPixelData(encodedFrame) {
  const padding = encodedFrame.length % 2 ? new Uint8Array(1) : new Uint8Array(0);
  const fragment = concat([encodedFrame, padding]);
  return concat([
    u16(0x7fe0), u16(0x0010), new TextEncoder().encode("OB"), u16(0), u32(0xffffffff),
    u16(0xfffe), u16(0xe000), u32(0),
    u16(0xfffe), u16(0xe000), u32(fragment.length), fragment,
    u16(0xfffe), u16(0xe0dd), u32(0),
  ]);
}

function makeJpeg2000Dicom({
  rgb = false,
  precision = rgb ? 8 : 12,
  pixelRepresentation = 0,
  transferSyntax = "1.2.840.10008.1.2.4.91",
} = {}) {
  const preamble = new Uint8Array(132);
  preamble.set(new TextEncoder().encode("DICM"), 128);
  const monochromeFrames = {
    8: "/0//UQApAAAAAAACAAAAAgAAAAAAAAAAAAAAAgAAAAIAAAAAAAAAAAABBwEB/1IADAAAAAEAAAQEAAH/XAAEQED/ZAAlAAFDcmVhdGVkIGJ5IE9wZW5KUEVHIHZlcnNpb24gMi41LjT/kAAKAAAAAAAWAAH/k9+AKAejbvo7/9k=",
    10: "/0//UQApAAAAAAACAAAAAgAAAAAAAAAAAAAAAgAAAAIAAAAAAAAAAAABCQEB/1IADAAAAAEAAAQEAAH/XAAEQFD/ZAAlAAFDcmVhdGVkIGJ5IE9wZW5KUEVHIHZlcnNpb24gMi41LjT/kAAKAAAAAAAWAAH/k9+wKAZH4VJ//9k=",
    12: "/0//UQApAAAAAAACAAAAAgAAAAAAAAAAAAAAAgAAAAIAAAAAAAAAAAABCwEB/1IADAAAAAEAAAQEAAH/XAAEQGD/ZAAlAAFDcmVhdGVkIGJ5IE9wZW5KUEVHIHZlcnNpb24gMi41LjT/kAAKAAAAAAAZAAH/k9/gIAeAEydHPmZf/9k=",
  };
  const encodedFrame = new Uint8Array(Buffer.from(
    rgb
      ? "/0//UQAvAAAAAAACAAAAAQAAAAAAAAAAAAAAAgAAAAEAAAAAAAAAAAADBwEBBwEBBwEB/1IADAAAAAEBAAQEAAH/XAAEQED/ZAAlAAFDcmVhdGVkIGJ5IE9wZW5KUEVHIHZlcnNpb24gMi41LjT/kAAKAAAAAAAZAAH/k8+0CAhbwCEBwCEI/9k="
      : monochromeFrames[precision],
    "base64",
  ));
  const rows = rgb ? 1 : 2;
  const columns = 2;
  const bits = precision <= 8 ? 8 : 16;
  const bitsStored = precision;
  const description = rgb ? "3D MIP" : "AVEC I.V.";
  return concat([
    preamble,
    element(0x0002, 0x0010, "UI", textPayload(transferSyntax, "UI")),
    element(0x0008, 0x0060, "CS", textPayload(rgb ? "OT" : "CT", "CS")),
    element(0x0008, 0x0080, "LO", textPayload("Hospital Example", "LO")),
    element(0x0008, 0x1030, "LO", textPayload("JPEG 2000 Study", "LO")),
    element(0x0008, 0x103e, "LO", textPayload(description, "LO")),
    element(0x0010, 0x0010, "PN", textPayload("Jane^Doe", "PN")),
    element(0x0010, 0x0020, "LO", textPayload("PATIENT-123", "LO")),
    element(0x0020, 0x000d, "UI", textPayload(rgb ? "2.16.840.4.1" : "2.16.840.5.1", "UI")),
    element(0x0020, 0x000e, "UI", textPayload(rgb ? "2.16.840.4.1.1" : "2.16.840.5.1.1", "UI")),
    element(0x0020, 0x0011, "IS", textPayload("1", "IS")),
    element(0x0020, 0x0013, "IS", textPayload("1", "IS")),
    usElement(0x0028, 0x0002, rgb ? 3 : 1),
    element(0x0028, 0x0004, "CS", textPayload(rgb ? "RGB" : "MONOCHROME2", "CS")),
    ...(rgb ? [usElement(0x0028, 0x0006, 0)] : []),
    usElement(0x0028, 0x0010, rows),
    usElement(0x0028, 0x0011, columns),
    usElement(0x0028, 0x0100, bits),
    usElement(0x0028, 0x0101, bitsStored),
    usElement(0x0028, 0x0102, bitsStored - 1),
    usElement(0x0028, 0x0103, pixelRepresentation),
    element(0x0028, 0x1052, "DS", textPayload("0", "DS")),
    element(0x0028, 0x1053, "DS", textPayload("1", "DS")),
    encapsulatedPixelData(encodedFrame),
  ]);
}

function implicitElement(group, item, payload) {
  payload = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
  return concat([u16(group), u16(item), u32(payload.length), payload]);
}

function makeImplicitDicom({ includeFileMeta = true } = {}) {
  const preamble = new Uint8Array(132);
  preamble.set(new TextEncoder().encode("DICM"), 128);
  const pixels = new Uint8Array(8);
  const pixelView = new DataView(pixels.buffer);
  [10, 20, 30, 40].forEach((value, index) => pixelView.setUint16(index * 2, value, true));
  const dataset = [
    implicitElement(0x0008, 0x0060, textPayload("CT", "CS")),
    implicitElement(0x0008, 0x1030, textPayload("Implicit Study", "LO")),
    implicitElement(0x0008, 0x103e, textPayload("Implicit Series", "LO")),
    implicitElement(0x0020, 0x000d, textPayload("2.16.840.1.1", "UI")),
    implicitElement(0x0020, 0x000e, textPayload("2.16.840.1.1.1", "UI")),
    implicitElement(0x0020, 0x0011, textPayload("1", "IS")),
    implicitElement(0x0020, 0x0013, textPayload("1", "IS")),
    implicitElement(0x0020, 0x0032, textPayload("0\\0\\0", "DS")),
    implicitElement(0x0020, 0x0037, textPayload("1\\0\\0\\0\\1\\0", "DS")),
    implicitElement(0x0028, 0x0002, u16(1)),
    implicitElement(0x0028, 0x0004, textPayload("MONOCHROME2", "CS")),
    implicitElement(0x0028, 0x0010, u16(2)),
    implicitElement(0x0028, 0x0011, u16(2)),
    implicitElement(0x0028, 0x0030, textPayload("1\\1", "DS")),
    implicitElement(0x0028, 0x0100, u16(16)),
    implicitElement(0x0028, 0x0101, u16(16)),
    implicitElement(0x0028, 0x0102, u16(15)),
    implicitElement(0x0028, 0x0103, u16(0)),
    implicitElement(0x0028, 0x1052, textPayload("-10", "DS")),
    implicitElement(0x0028, 0x1053, textPayload("2", "DS")),
    implicitElement(0x7fe0, 0x0010, pixels),
  ];
  return includeFileMeta
    ? concat([preamble, element(0x0002, 0x0010, "UI", textPayload("1.2.840.10008.1.2", "UI")), ...dataset])
    : concat(dataset);
}

function usElementEndian(group, item, value, little) {
  return element(group, item, "US", u16(value, little), little);
}

function makeBigEndianDicom() {
  const preamble = new Uint8Array(132);
  preamble.set(new TextEncoder().encode("DICM"), 128);
  const pixels = new Uint8Array(8);
  const pixelView = new DataView(pixels.buffer);
  [100, 200, 300, 400].forEach((value, index) => pixelView.setUint16(index * 2, value, false));
  const little = false;
  return concat([
    preamble,
    element(0x0002, 0x0010, "UI", textPayload("1.2.840.10008.1.2.2", "UI")),
    element(0x0008, 0x0060, "CS", textPayload("MR", "CS"), little),
    element(0x0008, 0x1030, "LO", textPayload("Big Endian Study", "LO"), little),
    element(0x0008, 0x103e, "LO", textPayload("Big Endian Series", "LO"), little),
    element(0x0020, 0x000d, "UI", textPayload("2.16.840.2.1", "UI"), little),
    element(0x0020, 0x000e, "UI", textPayload("2.16.840.2.1.1", "UI"), little),
    element(0x0020, 0x0011, "IS", textPayload("1", "IS"), little),
    element(0x0020, 0x0013, "IS", textPayload("1", "IS"), little),
    element(0x0020, 0x0032, "DS", textPayload("0\\0\\0", "DS"), little),
    element(0x0020, 0x0037, "DS", textPayload("1\\0\\0\\0\\1\\0", "DS"), little),
    usElementEndian(0x0028, 0x0002, 1, little),
    element(0x0028, 0x0004, "CS", textPayload("MONOCHROME2", "CS"), little),
    usElementEndian(0x0028, 0x0010, 2, little),
    usElementEndian(0x0028, 0x0011, 2, little),
    element(0x0028, 0x0030, "DS", textPayload("1\\1", "DS"), little),
    usElementEndian(0x0028, 0x0100, 16, little),
    usElementEndian(0x0028, 0x0101, 16, little),
    usElementEndian(0x0028, 0x0102, 15, little),
    usElementEndian(0x0028, 0x0103, 0, little),
    element(0x7fe0, 0x0010, "OW", pixels, little),
  ]);
}

function makePlanarRgbDicom() {
  const preamble = new Uint8Array(132);
  preamble.set(new TextEncoder().encode("DICM"), 128);
  const planar = Uint8Array.from([1, 2, 3, 4, 5, 6]);
  return concat([
    preamble,
    element(0x0002, 0x0010, "UI", textPayload("1.2.840.10008.1.2.1", "UI")),
    element(0x0008, 0x0060, "CS", textPayload("OT", "CS")),
    element(0x0008, 0x1030, "LO", textPayload("RGB Study", "LO")),
    element(0x0008, 0x103e, "LO", textPayload("Planar RGB", "LO")),
    element(0x0020, 0x000d, "UI", textPayload("2.16.840.3.1", "UI")),
    element(0x0020, 0x000e, "UI", textPayload("2.16.840.3.1.1", "UI")),
    element(0x0020, 0x0011, "IS", textPayload("1", "IS")),
    element(0x0020, 0x0013, "IS", textPayload("1", "IS")),
    usElement(0x0028, 0x0002, 3),
    element(0x0028, 0x0004, "CS", textPayload("RGB", "CS")),
    usElement(0x0028, 0x0006, 1),
    usElement(0x0028, 0x0010, 1),
    usElement(0x0028, 0x0011, 2),
    usElement(0x0028, 0x0100, 8),
    usElement(0x0028, 0x0101, 8),
    usElement(0x0028, 0x0102, 7),
    usElement(0x0028, 0x0103, 0),
    element(0x7fe0, 0x0010, "OB", planar),
  ]);
}

function fileLike(name, bytes, type = "application/dicom") {
  return {
    name,
    type,
    size: bytes.length,
    arrayBufferCalls: 0,
    async arrayBuffer() {
      this.arrayBufferCalls += 1;
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
}

function zipEntry(name, data, method, localOffset) {
  const nameBytes = new TextEncoder().encode(name);
  const compressed = method === 8 ? new Uint8Array(zlib.deflateRawSync(data)) : data;
  const local = concat([
    u32(0x04034b50), u16(20), u16(0x0800), u16(method), u16(0), u16(0), u32(0),
    u32(compressed.length), u32(data.length), u16(nameBytes.length), u16(0), nameBytes, compressed,
  ]);
  const central = concat([
    u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(method), u16(0), u16(0), u32(0),
    u32(compressed.length), u32(data.length), u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0),
    u32(0), u32(localOffset), nameBytes,
  ]);
  return { local, central };
}

function makeZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const built = zipEntry(entry.name, entry.data, entry.method, offset);
    locals.push(built.local);
    centrals.push(built.central);
    offset += built.local.length;
  }
  const central = concat(centrals);
  const eocd = concat([
    u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
    u32(central.length), u32(offset), u16(0),
  ]);
  return concat([...locals, central, eocd]);
}

async function gunzipBase64(encoded) {
  const compressed = new Uint8Array(Buffer.from(encoded, "base64"));
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function main() {
  const first = makeDicom({ instance: 1, z: 0 });
  const second = makeDicom({ instance: 2, z: 1 });
  const parsed = importer.testing.parseDicomBuffer(first, "slice-1.dcm", true);
  assert.equal(parsed.modality, "CT");
  assert.equal(parsed.rows, 2);
  assert.equal(parsed.columns, 2);
  assert.equal(parsed.patientName, "Jane^Doe");
  assert.equal(importer.testing.supportedRecordReason(parsed), null);

  const progress = [];
  const result = await importer.importFiles([
    fileLike("slice-2.dcm", second),
    fileLike("slice-1.dcm", first),
  ], {
    chunkSize: 1,
    persist: false,
    onProgress(detail) { progress.push(detail); },
  });

  assert.equal(result.persisted, false);
  assert.equal(result.study.seriesCount, 1);
  assert.equal(result.study.source.dicomFileCount, 2);
  assert.equal(result.study.source.phiTagsRemoved, true);
  assert(result.warnings.some((warning) => warning.includes("Identifying metadata")));
  assert(progress.some((item) => item.phase === "complete"));
  for (let index = 1; index < progress.length; index += 1) {
    assert(progress[index].progress >= progress[index - 1].progress, "progress must be monotonic");
  }

  const serialized = JSON.stringify(result.package);
  assert(!serialized.includes("Jane^Doe"), "Patient Name leaked into converted package");
  assert(!serialized.includes("PATIENT-123"), "Patient ID leaked into converted package");
  assert(!serialized.includes("Hospital Example"), "Institution Name leaked into converted package");

  const series = result.study.series[0];
  const manifest = manifests.get(series.caseId);
  assert(manifest, "manifest was not registered");
  assert.deepEqual(manifest.dimensions, { columns: 2, rows: 2, slices: 2 });
  assert.equal(manifest.sortMode, "spatial");
  assert.equal(manifest.valueRange.minimum, 0);
  assert.equal(manifest.valueRange.maximum, 3);
  assert.equal(manifest.chunks.length, 2);

  const raw = await gunzipBase64(chunks.get(`${series.caseId}:0`));
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  assert.deepEqual([0, 1, 2, 3], [0, 1, 2, 3].map((_, index) => view.getInt16(index * 2, true)));

  const localUrl = importer.localStudyUrl(result.study.studyId);
  assert(importer.isLocalStudyUrl(localUrl));
  assert.equal(importer.studyIdFromLocalUrl(localUrl), result.study.studyId);
  assert.equal((await importer.ensureRegistered(result.study.studyId)).studyId, result.study.studyId);

  const implicitResult = await importer.importFiles([
    fileLike("implicit.dcm", makeImplicitDicom()),
  ], { chunkSize: 1, persist: false });
  const implicitSeries = implicitResult.study.series[0];
  const implicitRaw = await gunzipBase64(chunks.get(`${implicitSeries.caseId}:0`));
  const implicitView = new DataView(implicitRaw.buffer, implicitRaw.byteOffset, implicitRaw.byteLength);
  assert.deepEqual([10, 30, 50, 70], [0, 1, 2, 3].map((index) => implicitView.getInt16(index * 2, true)));

  const implicitWithoutMeta = makeImplicitDicom({ includeFileMeta: false });
  const parsedImplicitWithoutMeta = importer.testing.parseDicomBuffer(implicitWithoutMeta, "implicit-no-meta.dcm", true);
  assert.equal(parsedImplicitWithoutMeta.transferSyntaxUID, "1.2.840.10008.1.2");
  assert.equal(parsedImplicitWithoutMeta.rows, 2);
  assert.equal(parsedImplicitWithoutMeta.columns, 2);

  const shiftedBitsResult = await importer.importFiles([
    fileLike("shifted-bits.dcm", makeDicom({
      bitsStored: 12,
      highBit: 14,
      pixelValues: [8, 16, 24, 32],
      rescaleIntercept: 0,
    })),
  ], { chunkSize: 1, persist: false });
  const shiftedSeries = shiftedBitsResult.study.series[0];
  const shiftedRaw = await gunzipBase64(chunks.get(`${shiftedSeries.caseId}:0`));
  const shiftedView = new DataView(shiftedRaw.buffer, shiftedRaw.byteOffset, shiftedRaw.byteLength);
  assert.deepEqual([1, 2, 3, 4], [0, 1, 2, 3].map((index) => shiftedView.getInt16(index * 2, true)));

  await assert.rejects(
    importer.importFiles([
      fileLike("invalid-high-bit.dcm", makeDicom({ bitsStored: 12, highBit: 10, rescaleIntercept: 0 })),
    ], { chunkSize: 1, persist: false }),
    /High Bit/i,
  );

  await assert.rejects(
    importer.importFiles([
      fileLike("int16-overflow.dcm", makeDicom({ pixelValues: [65535, 0, 1, 2], rescaleIntercept: 0 })),
    ], { chunkSize: 1, persist: false }),
    /signed 16-bit range/i,
  );

  const readOnceFile = fileLike("read-once.dcm", makeDicom({ rescaleIntercept: 0 }));
  await importer.importFiles([readOnceFile], { chunkSize: 1, persist: false });
  assert.equal(readOnceFile.arrayBufferCalls, 1, "a converted source must be read only once");

  const bigResult = await importer.importFiles([
    fileLike("big-endian.dcm", makeBigEndianDicom()),
  ], { chunkSize: 1, persist: false });
  const bigSeries = bigResult.study.series[0];
  const bigRaw = await gunzipBase64(chunks.get(`${bigSeries.caseId}:0`));
  const bigView = new DataView(bigRaw.buffer, bigRaw.byteOffset, bigRaw.byteLength);
  assert.deepEqual([100, 200, 300, 400], [0, 1, 2, 3].map((index) => bigView.getInt16(index * 2, true)));

  const rgbResult = await importer.importFiles([
    fileLike("planar-rgb.dcm", makePlanarRgbDicom()),
  ], { chunkSize: 1, persist: false });
  const rgbSeries = rgbResult.study.series[0];
  const rgbManifest = manifests.get(rgbSeries.caseId);
  assert.equal(rgbManifest.pixelType, "rgb8");
  const rgbRaw = await gunzipBase64(chunks.get(`${rgbSeries.caseId}:0`));
  assert.deepEqual(Array.from(rgbRaw), [1, 3, 5, 2, 4, 6]);

  const jpeg2000MonoResult = await importer.importFiles([
    fileLike("avec-iv.dcm", makeJpeg2000Dicom()),
  ], { chunkSize: 1, persist: false });
  const jpeg2000MonoSeries = jpeg2000MonoResult.study.series[0];
  const jpeg2000MonoManifest = manifests.get(jpeg2000MonoSeries.caseId);
  const jpeg2000MonoRaw = await gunzipBase64(chunks.get(`${jpeg2000MonoSeries.caseId}:0`));
  const jpeg2000MonoView = new DataView(
    jpeg2000MonoRaw.buffer,
    jpeg2000MonoRaw.byteOffset,
    jpeg2000MonoRaw.byteLength,
  );
  assert.equal(jpeg2000MonoManifest.valueRange.minimum, 0);
  assert.equal(jpeg2000MonoManifest.valueRange.maximum, 4095);
  assert.deepEqual(
    [0, 1, 1024, 4095],
    [0, 1, 2, 3].map((index) => jpeg2000MonoView.getInt16(index * 2, true)),
  );

  const jpeg2000TenBitResult = await importer.importFiles([
    fileLike("ten-bit.dcm", makeJpeg2000Dicom({ precision: 10 })),
  ], { chunkSize: 1, persist: false });
  const jpeg2000TenBitSeries = jpeg2000TenBitResult.study.series[0];
  const jpeg2000TenBitRaw = await gunzipBase64(chunks.get(`${jpeg2000TenBitSeries.caseId}:0`));
  const jpeg2000TenBitView = new DataView(
    jpeg2000TenBitRaw.buffer,
    jpeg2000TenBitRaw.byteOffset,
    jpeg2000TenBitRaw.byteLength,
  );
  assert.deepEqual(
    [0, 1, 2, 3].map((index) => jpeg2000TenBitView.getInt16(index * 2, true)),
    [0, 0, 127, 255],
  );

  const jpeg2000RgbResult = await importer.importFiles([
    fileLike("3d-mip.dcm", makeJpeg2000Dicom({ rgb: true })),
  ], { chunkSize: 1, persist: false });
  const jpeg2000RgbSeries = jpeg2000RgbResult.study.series[0];
  const jpeg2000RgbManifest = manifests.get(jpeg2000RgbSeries.caseId);
  const jpeg2000RgbRaw = await gunzipBase64(chunks.get(`${jpeg2000RgbSeries.caseId}:0`));
  assert.equal(jpeg2000RgbManifest.pixelType, "rgb8");
  assert.deepEqual(Array.from(jpeg2000RgbRaw), [1, 2, 3, 4, 5, 6]);

  const zip = makeZip([
    { name: "stored/slice-1.dcm", data: first, method: 0 },
    { name: "deflated/slice-2.dcm", data: second, method: 8 },
  ]);
  const zipSources = await importer.testing.zipSourcesFromFile(fileLike("study.zip", zip, "application/zip"));
  assert.equal(zipSources.length, 2);
  assert.deepEqual(await zipSources[0].read(), first);
  assert.deepEqual(await zipSources[1].read(), second);

  for (const sizeOffset of [20, 24]) {
    const zip64Entry = makeZip([{ name: "slice.dcm", data: first, method: 0 }]);
    const zip64View = new DataView(zip64Entry.buffer, zip64Entry.byteOffset, zip64Entry.byteLength);
    const eocdOffset = zip64Entry.length - 22;
    const centralOffset = zip64View.getUint32(eocdOffset + 16, true);
    zip64View.setUint32(centralOffset + sizeOffset, 0xffffffff, true);
    await assert.rejects(
      importer.testing.zipSourcesFromFile(fileLike("zip64-entry.zip", zip64Entry, "application/zip")),
      /ZIP64 is not supported/,
    );
  }

  await assert.rejects(
    importer.importFiles([
      fileLike("study-a.dcm", first),
      fileLike("study-b.dcm", makeDicom({ studyUid: "9.9.9", seriesUid: "9.9.9.1" })),
    ], { persist: false }),
    /multiple Study Instance UIDs/
  );

  const jpeg2000Meta = importer.testing.parseDicomBuffer(
    makeJpeg2000Dicom(),
    "jpeg2000-meta.dcm",
    true,
  );
  assert.equal(importer.testing.supportedRecordReason(jpeg2000Meta), null);
  const jpeg2000LosslessMeta = importer.testing.parseDicomBuffer(
    makeJpeg2000Dicom({ transferSyntax: "1.2.840.10008.1.2.4.90" }),
    "jpeg2000-lossless-meta.dcm",
    true,
  );
  assert.equal(importer.testing.supportedRecordReason(jpeg2000LosslessMeta), null);

  const signedEightBitJpeg2000Meta = importer.testing.parseDicomBuffer(
    makeJpeg2000Dicom({ precision: 8, pixelRepresentation: 1 }),
    "signed-eight-bit-jpeg2000.dcm",
    true,
  );
  assert.match(
    importer.testing.supportedRecordReason(signedEightBitJpeg2000Meta),
    /signed 8-bit JPEG 2000 is not supported by the local decoder/i,
  );

  await assert.rejects(
    importer.importFiles([
      fileLike("jpeg-ls.dcm", makeDicom({ transferSyntax: "1.2.840.10008.1.2.4.80" })),
    ], { persist: false }),
    (error) => {
      assert.match(error.message, /compressed or unsupported transfer syntax/);
      assert.doesNotMatch(error.message, /Identifying metadata/);
      return true;
    },
  );

  console.log("PowerPoint browser DICOM importer tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
