import test from "node:test";
import assert from "node:assert/strict";

import {
  allLicenseDocuments,
  fetchLicenseDocument,
  resolveLicenseDocumentUrl,
} from "../src/license-documents.js";

test("license catalog contains the complete release document set", () => {
  const documents = allLicenseDocuments();
  const paths = documents.map((document) => document.path);
  assert.equal(documents.length, 15);
  assert.equal(new Set(paths).size, paths.length);
  assert.ok(paths.includes("LICENSE.txt"));
  assert.ok(paths.includes("DEMO_CONTENT_LICENSE.md"));
  assert.ok(paths.includes("third_party/licenses/APACHE-2.0.txt"));
  assert.ok(paths.includes("third_party/licenses/ZIP-JS-BSD-3-CLAUSE.txt"));
});

test("license document paths stay inside the current PWA scope", () => {
  assert.equal(
    resolveLicenseDocumentUrl("third_party/licenses/APACHE-2.0.txt", "https://example.test/gamespace/index.html").href,
    "https://example.test/gamespace/third_party/licenses/APACHE-2.0.txt",
  );
  for (const unsafe of ["/LICENSE", "../LICENSE", "third_party\\licenses\\LICENSE.txt", "third_party//LICENSE.txt"]) {
    assert.throws(() => resolveLicenseDocumentUrl(unsafe, "https://example.test/gamespace/"));
  }
});

test("license loader rejects an HTML fallback instead of displaying the application page", async () => {
  await assert.rejects(
    fetchLicenseDocument("LICENSE.txt", {
      baseUrl: "https://example.test/gamespace/",
      fetchImpl: async () => new Response("<!doctype html><title>GameSpace</title>", {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }),
    }),
    /не вернул запрошенный/,
  );
});
