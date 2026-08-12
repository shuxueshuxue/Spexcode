import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));

test("graph-delta is an exported browser-safe entry", async () => {
  const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
  assert.equal(manifest.exports["./graph-delta"], "./src/graph-delta.ts");

  const source = await readFile(join(packageRoot, "src/graph-delta.ts"), "utf8");
  assert.doesNotMatch(source, /from\s+["']node:/);
  assert.doesNotMatch(source, /^\s*import\s/m);
});

test("published graph-delta entry classifies the complete current key set", async () => {
  const { unitKeyKind } = await import(join(packageRoot, ".publish/dist/graph-delta.js"));
  assert.deepEqual(unitKeyKind("node:node-1"), { kind: "node", id: "node-1" });
  assert.deepEqual(unitKeyKind("nodes#order"), { kind: "nodes-order" });
  assert.deepEqual(unitKeyKind("sess:session-1"), { kind: "session", id: "session-1" });
  assert.deepEqual(unitKeyKind("sess#order"), { kind: "sessions-order" });
  assert.deepEqual(unitKeyKind("meta"), { kind: "meta" });
  assert.deepEqual(unitKeyKind("future:kind"), { kind: "unknown", key: "future:kind" });
});
