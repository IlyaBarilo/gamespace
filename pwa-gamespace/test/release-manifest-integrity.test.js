import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { verifyManifestDirectory } from "../scripts/release-utils.mjs";

test("detects a Pages file changed after the release manifest was created", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "gamespace-pages-integrity-"));
  const original = Buffer.from("{\"version\":\"0.3.1\"}\r\n", "utf8");
  const manifest = {
    files: [{
      path: "version.json",
      size: original.length,
      sha256: createHash("sha256").update(original).digest("hex"),
    }],
  };

  try {
    await writeFile(path.join(directory, "version.json"), original);
    await assert.doesNotReject(verifyManifestDirectory(directory, manifest));

    await writeFile(path.join(directory, "version.json"), "{\"version\":\"0.3.1\"}\n", "utf8");
    await assert.rejects(verifyManifestDirectory(directory, manifest), /изменён после подготовки выпуска/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
