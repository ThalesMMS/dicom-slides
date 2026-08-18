(function (global) {
  "use strict";

  const API_SET = "PowerPointApi";
  const API_VERSION = "1.7";
  const SCHEMA_VERSION = 1;
  const FORMAT = "dicom-slides-powerpoint-package/1";
  const BASE_NAMESPACE = "https://thalesmms.github.io/dicom-slides/powerpoint/package/1";
  const FRAGMENT_CHARACTERS = 256 * 1024;
  const OFFICE_BATCH_SIZE = 4;

  function isSupported() {
    try {
      return typeof global.PowerPoint?.run === "function"
        && global.Office?.context?.requirements?.isSetSupported?.(API_SET, API_VERSION) === true;
    } catch (_) {
      return false;
    }
  }

  function requireSupport() {
    if (!isSupported()) {
      throw new Error("Embedding DICOM studies requires PowerPointApi 1.7 or later.");
    }
    if (!global.crypto?.subtle || typeof global.TextEncoder !== "function") {
      throw new Error("This PowerPoint WebView cannot verify embedded DICOM study data.");
    }
  }

  function abortIfRequested(signal) {
    if (!signal?.aborted) return;
    if (typeof global.DOMException === "function") {
      throw new global.DOMException("Embedding canceled.", "AbortError");
    }
    const error = new Error("Embedding canceled.");
    error.name = "AbortError";
    throw error;
  }

  function report(callback, progress, message, detail = {}) {
    if (typeof callback !== "function") return;
    callback(Object.assign({
      phase: "embed",
      progress: Math.max(0, Math.min(1, Number(progress) || 0)),
      message,
    }, detail));
  }

  function bytesToHex(bytes) {
    return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  }

  async function sha256Text(value) {
    const bytes = new global.TextEncoder().encode(String(value));
    const digest = await global.crypto.subtle.digest("SHA-256", bytes);
    return bytesToHex(new Uint8Array(digest));
  }

  function generationId() {
    if (typeof global.crypto?.randomUUID === "function") return global.crypto.randomUUID().toLowerCase();
    if (typeof global.crypto?.getRandomValues !== "function") {
      throw new Error("This PowerPoint WebView cannot create an embedded package identifier.");
    }
    const bytes = new Uint8Array(16);
    global.crypto.getRandomValues(bytes);
    return bytesToHex(bytes);
  }

  function splitText(value) {
    const text = String(value);
    const fragments = [];
    for (let start = 0; start < text.length;) {
      let end = Math.min(text.length, start + FRAGMENT_CHARACTERS);
      if (end < text.length) {
        const finalCodeUnit = text.charCodeAt(end - 1);
        if (finalCodeUnit >= 0xd800 && finalCodeUnit <= 0xdbff) end -= 1;
      }
      fragments.push(text.slice(start, end));
      start = end;
    }
    return fragments.length ? fragments : [""];
  }

  function escapeXmlText(value) {
    return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  }

  function escapeXmlAttribute(value) {
    return escapeXmlText(value).replaceAll('"', "&quot;").replaceAll("'", "&apos;");
  }

  function decodeXmlEntities(value) {
    return String(value).replace(/&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos);/gi, (entity, name) => {
      const normalized = name.toLowerCase();
      if (normalized === "amp") return "&";
      if (normalized === "lt") return "<";
      if (normalized === "gt") return ">";
      if (normalized === "quot") return '"';
      if (normalized === "apos") return "'";
      const codePoint = normalized.startsWith("#x")
        ? Number.parseInt(normalized.slice(2), 16)
        : Number.parseInt(normalized.slice(1), 10);
      if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
        throw new Error(`Invalid XML entity ${entity}.`);
      }
      return String.fromCodePoint(codePoint);
    });
  }

  function parseAttributes(source) {
    const attributes = {};
    const pattern = /([A-Za-z_][\w:.-]*)\s*=\s*(["'])([\s\S]*?)\2/g;
    let match;
    while ((match = pattern.exec(source))) attributes[match[1]] = decodeXmlEntities(match[3]);
    return attributes;
  }

  function parseWithDom(xml) {
    if (typeof global.DOMParser !== "function") return null;
    const document = new global.DOMParser().parseFromString(String(xml), "application/xml");
    if (document.querySelector?.("parsererror")) throw new Error("The embedded DICOM XML is invalid.");
    const root = document.documentElement;
    if (!root || root.localName !== "dicomSlidesPackage") {
      throw new Error("The embedded DICOM XML has an unexpected root element.");
    }
    const payload = root.getElementsByTagNameNS(root.namespaceURI, "payload")[0]
      || root.getElementsByTagName("payload")[0];
    if (!payload) throw new Error("The embedded DICOM XML has no payload.");
    return {
      namespaceUri: root.namespaceURI,
      format: root.getAttribute("format"),
      schemaVersion: root.getAttribute("schemaVersion"),
      studyId: root.getAttribute("studyId"),
      generationId: root.getAttribute("generationId"),
      index: root.getAttribute("index"),
      count: root.getAttribute("count"),
      packageSha256: root.getAttribute("packageSha256"),
      fragmentSha256: root.getAttribute("fragmentSha256"),
      payload: payload.textContent || "",
    };
  }

  function parseWithoutDom(xml) {
    const rootMatch = String(xml).match(
      /<((?:[A-Za-z_][\w.-]*:)?dicomSlidesPackage)\b([^>]*)>([\s\S]*)<\/\1\s*>/,
    );
    if (!rootMatch) throw new Error("The embedded DICOM XML has an unexpected root element.");
    const attributes = parseAttributes(rootMatch[2]);
    const prefix = rootMatch[1].includes(":") ? rootMatch[1].split(":", 1)[0] : "";
    const namespaceUri = attributes[prefix ? `xmlns:${prefix}` : "xmlns"] || "";
    const payloadMatch = rootMatch[3].match(
      /<((?:[A-Za-z_][\w.-]*:)?payload)\b[^>]*>([\s\S]*?)<\/\1\s*>/,
    );
    if (!payloadMatch) throw new Error("The embedded DICOM XML has no payload.");
    return Object.assign({
      namespaceUri,
      payload: decodeXmlEntities(payloadMatch[2]),
    }, attributes);
  }

  function parseChunkXml(xml) {
    return parseWithDom(xml) || parseWithoutDom(xml);
  }

  function integerAttribute(value, label) {
    if (!/^\d+$/.test(String(value || ""))) throw new Error(`The embedded DICOM ${label} is invalid.`);
    return Number(value);
  }

  function assertPackageRecord(packageRecord) {
    const studyId = String(packageRecord?.study?.studyId || "");
    if (!packageRecord || typeof packageRecord !== "object" || !studyId || packageRecord.id !== studyId) {
      throw new Error("Invalid DICOM package record for presentation storage.");
    }
    return studyId;
  }

  function validateReference(reference) {
    if (!reference || typeof reference !== "object" || reference.schemaVersion !== SCHEMA_VERSION) {
      throw new Error("The embedded DICOM package reference is invalid.");
    }
    const generation = String(reference.generationId || "");
    const namespaceUri = String(reference.namespaceUri || "");
    const partCount = Number(reference.partCount);
    if (!/^[a-f0-9-]{16,64}$/.test(generation)
        || namespaceUri !== `${BASE_NAMESPACE}/${generation}`
        || !String(reference.studyId || "")
        || !Number.isInteger(partCount) || partCount < 1 || partCount > 10000
        || !/^[a-f0-9]{64}$/.test(String(reference.packageSha256 || ""))) {
      throw new Error("The embedded DICOM package reference is invalid.");
    }
    return {
      schemaVersion: SCHEMA_VERSION,
      studyId: String(reference.studyId),
      generationId: generation,
      namespaceUri,
      partCount,
      packageSha256: String(reference.packageSha256),
    };
  }

  function chunkXml(metadata, payload) {
    return `<dicomSlidesPackage xmlns="${escapeXmlAttribute(metadata.namespaceUri)}"`
      + ` format="${FORMAT}" schemaVersion="${SCHEMA_VERSION}"`
      + ` studyId="${escapeXmlAttribute(metadata.studyId)}"`
      + ` generationId="${escapeXmlAttribute(metadata.generationId)}"`
      + ` index="${metadata.index}" count="${metadata.count}"`
      + ` packageSha256="${metadata.packageSha256}" fragmentSha256="${metadata.fragmentSha256}">`
      + `<payload>${escapeXmlText(payload)}</payload></dicomSlidesPackage>`;
  }

  async function deleteNamespace(reference) {
    const normalized = validateReference(reference);
    return global.PowerPoint.run(async (context) => {
      const scoped = context.presentation.customXmlParts.getByNamespace(normalized.namespaceUri);
      scoped.load("items");
      await context.sync();
      const parts = Array.from(scoped.items || []);
      for (let start = 0; start < parts.length; start += OFFICE_BATCH_SIZE) {
        parts.slice(start, start + OFFICE_BATCH_SIZE).forEach((part) => part.delete());
        await context.sync();
      }
      return parts.length > 0;
    });
  }

  async function writePackage(packageRecord, options = {}) {
    requireSupport();
    abortIfRequested(options.signal);
    const studyId = assertPackageRecord(packageRecord);
    const serialized = JSON.stringify(packageRecord);
    const fragments = splitText(serialized);
    if (fragments.length > 10000) {
      throw new Error("The DICOM package is too large for presentation storage.");
    }
    const packageSha256 = await sha256Text(serialized);
    const currentGenerationId = generationId();
    const reference = {
      schemaVersion: SCHEMA_VERSION,
      studyId,
      generationId: currentGenerationId,
      namespaceUri: `${BASE_NAMESPACE}/${currentGenerationId}`,
      partCount: fragments.length,
      packageSha256,
    };
    report(options.onProgress, 0, "Embedding study in presentation…", { partCount: fragments.length });
    try {
      await global.PowerPoint.run(async (context) => {
        const parts = context.presentation.customXmlParts;
        for (let start = 0; start < fragments.length; start += OFFICE_BATCH_SIZE) {
          abortIfRequested(options.signal);
          const end = Math.min(fragments.length, start + OFFICE_BATCH_SIZE);
          const documents = [];
          for (let index = start; index < end; index += 1) {
            documents.push(chunkXml({
              ...reference,
              index,
              count: fragments.length,
              fragmentSha256: await sha256Text(fragments[index]),
            }, fragments[index]));
          }
          documents.forEach((xml) => parts.add(xml));
          await context.sync();
          const written = end;
          report(
            options.onProgress,
            written / fragments.length * 0.95,
            `Embedding study in presentation: ${written}/${fragments.length}`,
            { partCount: fragments.length, partsWritten: written },
          );
        }
        const count = parts.getByNamespace(reference.namespaceUri).getCount();
        await context.sync();
        if (count.value !== fragments.length) {
          throw new Error(`PowerPoint stored ${count.value} of ${fragments.length} DICOM package parts.`);
        }
      });
      await readPackage(reference, { signal: options.signal });
      report(options.onProgress, 1, "Study embedded in presentation.", { partCount: fragments.length });
      return reference;
    } catch (error) {
      try {
        await deleteNamespace(reference);
      } catch (cleanupError) {
        const combined = new Error(`${error.message} Cleanup also failed: ${cleanupError.message}`);
        combined.cause = error;
        combined.cleanupReference = reference;
        throw combined;
      }
      throw error;
    }
  }

  async function readPackage(reference, options = {}) {
    requireSupport();
    const normalized = validateReference(reference);
    abortIfRequested(options.signal);
    const parsedDocuments = await global.PowerPoint.run(async (context) => {
      const scoped = context.presentation.customXmlParts.getByNamespace(normalized.namespaceUri);
      scoped.load("items");
      await context.sync();
      const parts = Array.from(scoped.items || []);
      if (parts.length !== normalized.partCount) {
        throw new Error(`Embedded DICOM package is incomplete: expected ${normalized.partCount} parts, found ${parts.length}.`);
      }
      const documents = [];
      for (let start = 0; start < parts.length; start += OFFICE_BATCH_SIZE) {
        abortIfRequested(options.signal);
        const results = parts.slice(start, start + OFFICE_BATCH_SIZE).map((part) => part.getXml());
        await context.sync();
        results.forEach((result) => documents.push(parseChunkXml(result.value)));
        const read = Math.min(parts.length, start + OFFICE_BATCH_SIZE);
        report(
          options.onProgress,
          read / parts.length * 0.8,
          `Restoring study from presentation: ${read}/${parts.length}`,
          { partCount: parts.length, partsRead: read },
        );
      }
      return documents;
    });

    const fragments = new Array(normalized.partCount);
    for (let position = 0; position < parsedDocuments.length; position += 1) {
      abortIfRequested(options.signal);
      const parsed = parsedDocuments[position];
      const index = integerAttribute(parsed.index, "part index");
      const count = integerAttribute(parsed.count, "part count");
      if (parsed.namespaceUri !== normalized.namespaceUri
          || parsed.format !== FORMAT
          || integerAttribute(parsed.schemaVersion, "schema version") !== SCHEMA_VERSION
          || parsed.studyId !== normalized.studyId
          || parsed.generationId !== normalized.generationId
          || count !== normalized.partCount
          || parsed.packageSha256 !== normalized.packageSha256
          || index < 0 || index >= normalized.partCount
          || fragments[index] !== undefined) {
        throw new Error("The embedded DICOM package metadata is inconsistent.");
      }
      const fragmentDigest = await sha256Text(parsed.payload);
      if (fragmentDigest !== parsed.fragmentSha256) {
        throw new Error(`Embedded DICOM fragment ${index} failed its digest check.`);
      }
      fragments[index] = parsed.payload;
      report(
        options.onProgress,
        0.8 + (position + 1) / parsedDocuments.length * 0.15,
        `Verifying embedded study: ${position + 1}/${parsedDocuments.length}`,
      );
    }
    if (fragments.some((fragment) => fragment === undefined)) {
      throw new Error("The embedded DICOM package is incomplete.");
    }
    const serialized = fragments.join("");
    if (await sha256Text(serialized) !== normalized.packageSha256) {
      throw new Error("The embedded DICOM package failed its digest check.");
    }
    let packageRecord;
    try {
      packageRecord = JSON.parse(serialized);
    } catch (_) {
      throw new Error("The embedded DICOM package contains invalid JSON.");
    }
    if (assertPackageRecord(packageRecord) !== normalized.studyId) {
      throw new Error("The embedded DICOM package belongs to a different study.");
    }
    report(options.onProgress, 1, "Study restored from presentation.");
    return packageRecord;
  }

  async function deletePackage(reference) {
    requireSupport();
    return deleteNamespace(reference);
  }

  global.DicomSlidesPresentationStorage = Object.freeze({
    version: "1.0.0",
    schemaVersion: SCHEMA_VERSION,
    namespaceBase: BASE_NAMESPACE,
    isSupported,
    writePackage,
    readPackage,
    deletePackage,
  });
})(typeof window !== "undefined" ? window : globalThis);
