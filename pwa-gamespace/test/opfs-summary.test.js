import test from "node:test";
import assert from "node:assert/strict";
import { summarizeDirectory } from "../src/opfs.js";

function file(size) {
  return { kind: "file", async getFile() { return { size }; } };
}

function directory(entries) {
  return {
    kind: "directory",
    async *entries() {
      yield* Object.entries(entries);
    },
  };
}

test("counts files and bytes stored in nested OPFS directories", async () => {
  const root = directory({
    "index.html": file(120),
    assets: directory({
      "app.js": file(350),
      images: directory({ "logo.png": file(530) }),
    }),
  });

  assert.deepEqual(await summarizeDirectory(root), { files: 3, bytes: 1000 });
});
