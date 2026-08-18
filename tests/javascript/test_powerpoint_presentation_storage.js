#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..", "..");
const storagePath = path.join(root, "powerpoint", "presentation-storage.js");
assert.ok(fs.existsSync(storagePath), "PowerPoint presentation storage module must exist");
const source = fs.readFileSync(storagePath, "utf8");

function namespaceFromXml(xml) {
  const match = String(xml).match(/\sxmlns=(['"])([^'"]+)\1/);
  if (!match) throw new Error("Fake Office host received XML without a default namespace.");
  return match[2];
}

class MemoryCustomXmlPart {
  constructor(collection, id, xml) {
    this.collection = collection;
    this.id = id;
    this.namespaceUri = namespaceFromXml(xml);
    this.xml = xml;
    this.isNullObject = false;
  }

  load() {
    return this;
  }

  getXml() {
    return { value: this.xml };
  }

  delete() {
    if (this.collection.deleteFails) throw new Error("PowerPoint refused to delete custom XML.");
    this.collection.parts.delete(this.id);
  }
}

class MemoryScopedCollection {
  constructor(collection, namespaceUri) {
    this.collection = collection;
    this.namespaceUri = namespaceUri;
  }

  get items() {
    return Array.from(this.collection.parts.values())
      .filter((part) => part.namespaceUri === this.namespaceUri);
  }

  load() {
    return this;
  }

  getCount() {
    return { value: this.items.length };
  }
}

class MemoryCustomXmlParts {
  constructor(transformXml = (xml) => xml, deleteFails = false) {
    this.parts = new Map();
    this.nextId = 1;
    this.transformXml = transformXml;
    this.deleteFails = deleteFails;
  }

  add(xml) {
    const id = `custom-xml-${this.nextId}`;
    this.nextId += 1;
    const part = new MemoryCustomXmlPart(this, id, this.transformXml(String(xml)));
    this.parts.set(id, part);
    return part;
  }

  getByNamespace(namespaceUri) {
    return new MemoryScopedCollection(this, namespaceUri);
  }
}

function literalPackage(studyId = "local-brain-mri") {
  const caseId = `${studyId}--series-1`;
  return {
    id: studyId,
    schemaVersion: 1,
    createdAt: "2026-08-18T12:00:00.000Z",
    study: {
      format: "dicom-slide-study/1",
      studyId,
      title: "Brain & <MRI> — T1",
      studyInstanceUID: "1.2.3.4.5",
      seriesCount: 1,
      series: [{
        id: "series-1",
        caseId,
        number: "1",
        title: "T1 > post-contrast",
        modality: "MR",
        slices: 2,
        rows: 2,
        columns: 2,
        sortMode: "instance-number",
        manifest: "series/series-1/manifest.js",
      }],
      source: {
        importedLocally: true,
        dicomFileCount: 2,
        selectedFileCount: 2,
        ignoredFileCount: 0,
        phiTagsRemoved: true,
        burnedInAnnotation: false,
      },
      baseUrl: `dicom-slides-local://${studyId}/`,
    },
    manifests: {
      [caseId]: {
        format: "dicom-slide-volume/1",
        caseId,
        title: "T1 > post-contrast",
        dimensions: { rows: 2, columns: 2, slices: 2 },
        chunks: [{ file: "chunks/chunk-0000.js", firstSlice: 0, slices: 2, compressedBytes: 8 }],
      },
    },
    chunks: {
      [caseId]: ["H4sIAAAAA" + "A".repeat(300000) + "=="],
    },
    warnings: ["Metadata text contained & and <characters>; ]]> remained data."],
    totalCompressedBytes: 8,
    totalPixelBytes: 16,
  };
}

function createHarness({ supported = true, transformXml, deleteFails = false } = {}) {
  const customXmlParts = new MemoryCustomXmlParts(transformXml, deleteFails);
  let syncCount = 0;
  const context = vm.createContext({
    AbortController,
    DOMException,
    TextDecoder,
    TextEncoder,
    console,
    crypto: crypto.webcrypto,
    Office: {
      context: {
        requirements: {
          isSetSupported(name, version) {
            return supported && name === "PowerPointApi" && version === "1.7";
          },
        },
      },
    },
    PowerPoint: {
      async run(callback) {
        return callback({
          presentation: { customXmlParts },
          async sync() { syncCount += 1; },
        });
      },
    },
  });
  context.window = context;
  context.globalThis = context;
  vm.runInContext(source, context, { filename: "powerpoint/presentation-storage.js" });
  return {
    api: context.DicomSlidesPresentationStorage,
    customXmlParts,
    get syncCount() { return syncCount; },
  };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

async function testPackageRoundTripsThroughPresentationCustomXmlParts() {
  const harness = createHarness();
  const packageRecord = literalPackage();

  const reference = await harness.api.writePackage(packageRecord);

  assert.equal(reference.schemaVersion, 1);
  assert.equal(reference.studyId, packageRecord.study.studyId);
  assert.ok(reference.partCount > 1, "a large package must be split across bounded custom XML parts");
  assert.match(reference.namespaceUri, /^https:\/\/thalesmms\.github\.io\/dicom-slides\/powerpoint\/package\/1\//);
  assert.equal(harness.customXmlParts.parts.size, reference.partCount);
  assert.ok(harness.syncCount >= 2, "writes must be synchronized in bounded batches and then counted");

  const restored = await harness.api.readPackage(reference);
  assert.deepEqual(plain(restored), packageRecord, "the presentation must contain the complete importer package");
}

async function testCorruptFragmentIsRejectedInsteadOfReturned() {
  const harness = createHarness();
  const reference = await harness.api.writePackage(literalPackage());
  const first = Array.from(harness.customXmlParts.parts.values())
    .find((part) => part.namespaceUri === reference.namespaceUri);
  first.xml = first.xml.replace("H4sIAAAAA", "H4sIAAAAB");

  await assert.rejects(
    harness.api.readPackage(reference),
    /fragment.*digest|digest.*fragment/i,
    "one mutated pixel fragment must invalidate the embedded generation",
  );
}

async function testMissingPartIsRejectedBeforeJsonParsing() {
  const harness = createHarness();
  const reference = await harness.api.writePackage(literalPackage());
  const part = Array.from(harness.customXmlParts.parts.values())
    .find((candidate) => candidate.namespaceUri === reference.namespaceUri);
  part.delete();

  await assert.rejects(
    harness.api.readPackage(reference),
    /expected .* parts|part count|incomplete/i,
    "a partial generation must never be accepted",
  );
}

async function testDeleteTargetsOnlyOneGenerationNamespace() {
  const harness = createHarness();
  const first = await harness.api.writePackage(literalPackage("local-study-a"));
  const secondPackage = literalPackage("local-study-b");
  const second = await harness.api.writePackage(secondPackage);
  harness.customXmlParts.add('<foreign xmlns="https://example.test/foreign">keep me</foreign>');

  assert.equal(await harness.api.deletePackage(first), true);
  assert.equal(
    Array.from(harness.customXmlParts.parts.values()).some((part) => part.namespaceUri === first.namespaceUri),
    false,
  );
  assert.deepEqual(plain(await harness.api.readPackage(second)), secondPackage);
  assert.equal(
    Array.from(harness.customXmlParts.parts.values()).some((part) => part.namespaceUri === "https://example.test/foreign"),
    true,
    "deleting one DICOM package must preserve unrelated custom XML",
  );
}

async function testUnsupportedHostFailsBeforeWriting() {
  const harness = createHarness({ supported: false });

  assert.equal(harness.api.isSupported(), false);
  await assert.rejects(
    harness.api.writePackage(literalPackage()),
    /PowerPointApi 1\.7/i,
  );
  assert.equal(harness.customXmlParts.parts.size, 0);
}

async function testWriteRejectsHostMutationBeforeReturningReference() {
  let mutated = false;
  const harness = createHarness({
    transformXml(xml) {
      if (mutated || !xml.includes("H4sIAAAAA")) return xml;
      mutated = true;
      return xml.replace("H4sIAAAAA", "H4sIAAAAB");
    },
  });

  await assert.rejects(
    harness.api.writePackage(literalPackage()),
    /fragment.*digest|digest.*fragment/i,
    "writePackage must read back and verify the host-stored XML before returning its reference",
  );
  assert.equal(harness.customXmlParts.parts.size, 0, "a failed read-back must clean the rejected generation");
}

async function testFailedWriteCleanupReturnsARecoverableReference() {
  let mutated = false;
  const harness = createHarness({
    deleteFails: true,
    transformXml(xml) {
      if (mutated || !xml.includes("H4sIAAAAA")) return xml;
      mutated = true;
      return xml.replace("H4sIAAAAA", "H4sIAAAAB");
    },
  });

  await assert.rejects(
    harness.api.writePackage(literalPackage()),
    (error) => /cleanup also failed/i.test(error.message)
      && error.cleanupReference?.namespaceUri?.startsWith(harness.api.namespaceBase),
    "an undeleted failed generation must remain addressable for a cleanup journal",
  );
}

(async () => {
  await testPackageRoundTripsThroughPresentationCustomXmlParts();
  await testCorruptFragmentIsRejectedInsteadOfReturned();
  await testMissingPartIsRejectedBeforeJsonParsing();
  await testDeleteTargetsOnlyOneGenerationNamespace();
  await testUnsupportedHostFailsBeforeWriting();
  await testWriteRejectsHostMutationBeforeReturningReference();
  await testFailedWriteCleanupReturnsARecoverableReference();
  console.log("PowerPoint embedded presentation storage tests passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
