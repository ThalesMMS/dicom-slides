#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const textExtensions = new Set([
  ".bat", ".cff", ".command", ".css", ".html", ".js", ".json", ".md", ".py", ".txt",
]);
// `.superpowers/sdd` is ignored transient execution state, not shipped content.
const ignoredDirectories = new Set([".git", ".superpowers", "LICENSES", "chunks"]);
const ignoredFiles = new Set([
  "LICENSE",
  "exams/library/mri-dir-t1-mr/LICENSE.txt",
]);
const portugueseProse = /\b(?:apresentaç(?:ão|ões)|visualizador|exames?|séries?|licenças?|projeto|dados|arquivos?|imagens?|cortes?|carregando|estudos?|matriz|geometria|origem|crédito|formato|faixa completa|partes moles|pulmão|osso|pré-congelamento|após congelamento|sem-descricao|janela|janelado|ferramenta|usuário|botão|arrasto|sombreamento|domínio|opacidade|câmera|qualidade|padrão|pesquisa realizada|resposta curta|como citar|não destinado|não|são|está|estão|começam|própri[ao]|revela|recomenda|apenas|também|mantém|devolve|continua|abaixo|acima|segue|ainda|entre|quando|onde|mesmo|sem|sintétic[ao]|multissérie|avaliação|diagnóstico|TC abdominal|TC normal)\b/iu;

// These definitions are detector fixtures, not prose. Exempt only their lines.
function isDetectorDefinition(relative, line) {
  return (
    (relative === "tests/javascript/test_english_content.js" && line.startsWith("const portugueseProse =")) ||
    (relative === "tests/javascript/test_volume_integration.js" && line.startsWith("const portugueseRuntimeProse ="))
  );
}

assert.ok(isDetectorDefinition("tests/javascript/test_english_content.js", "const portugueseProse ="));
assert.ok(isDetectorDefinition("tests/javascript/test_volume_integration.js", "const portugueseRuntimeProse ="));
assert.equal(isDetectorDefinition("tests/javascript/test_english_content.js", "const otherProse ="), false);

function collect(directory, output = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) collect(absolute, output);
    else output.push(absolute);
  }
  return output;
}

const violations = [];
for (const filename of collect(root)) {
  const relative = path.relative(root, filename).replaceAll("\\", "/");
  // Planning records quote legacy source strings as translation fixtures.
  if (relative.startsWith("docs/superpowers/")) continue;
  if (ignoredFiles.has(relative)) continue;
  if (!textExtensions.has(path.extname(filename).toLowerCase())) continue;
  const lines = fs.readFileSync(filename, "utf8").split(/\r?\n/);
  lines.forEach((line, index) => {
    if (isDetectorDefinition(relative, line)) return;
    if (portugueseProse.test(line) || /lang=["']pt-BR["']/i.test(line)) {
      violations.push(`${relative}:${index + 1}: ${line.trim()}`);
    }
  });
}

assert.deepEqual(
  violations,
  [],
  `Project-authored Portuguese prose remains:\n${violations.join("\n")}`
);
console.log("OK: project-authored human-readable text is English");
