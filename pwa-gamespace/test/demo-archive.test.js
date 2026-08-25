import test from "node:test";
import assert from "node:assert/strict";
import { verifyDemoArchive } from "../scripts/verify-demo-archive.mjs";

test("demo.7z contains every demo source file with the correct size", async () => {
  const result = await verifyDemoArchive();
  assert.ok(result.files > 0);
  assert.ok(result.directories > 0);
  assert.ok(result.uncompressedBytes > 0);
});
