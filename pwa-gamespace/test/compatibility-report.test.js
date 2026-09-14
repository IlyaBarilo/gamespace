import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  COMPATIBILITY_FORM_URL, compatibilityCode, createCompatibilityReport,
  formatCompatibilityBody, formatCompatibilityBytes, normalizeCompatibilityText,
} from "../src/compatibility-report.js";

const vectors = JSON.parse(await readFile(new URL("../../docs/fixtures/compatibility-report-gs1.json", import.meta.url), "utf8"));

for (const fixture of vectors.cases) {
  test(`GS1 reference report: ${fixture.name}`, async () => {
    assert.equal(formatCompatibilityBody(fixture.input), fixture.body);
    assert.equal(await createCompatibilityReport(fixture.input), fixture.text);
    assert.equal(await compatibilityCode(fixture.body), fixture.code);
    assert.equal(createHash("sha256").update(normalizeCompatibilityText(fixture.body)).digest("hex"), fixture.sha256);
    assert.doesNotMatch(fixture.body, /\r\n\r\n/);
  });
}

test("only the agreed whitespace is ignored; punctuation, zero-width characters and Unicode composition matter", async () => {
  for (const fixture of vectors.normalization) {
    assert.equal(await compatibilityCode(fixture.text), fixture.code);
    assert.equal(createHash("sha256").update(normalizeCompatibilityText(fixture.text)).digest("hex"), fixture.sha256);
  }
  assert.equal(vectors.normalization[0].sha256, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  const body = vectors.cases[0].body;
  assert.equal(await compatibilityCode(body.replace(/\r\n/g, "   \n\t")), vectors.cases[0].code);
  for (const altered of [body.replace("0.4.0", "0.4.1"), body + ".", body.replace("Xiaomi", "xiaomi"), body + "\u200b", body + "\ufeff"]) {
    assert.notEqual(await compatibilityCode(altered), vectors.cases[0].code);
  }
  assert.notEqual(vectors.normalization[4].code, vectors.normalization[5].code);
});

test("bounded integer sizes are identical for APK/PWA including 40 GB and the JS safe limit", () => {
  for (const fixture of vectors.numbers) assert.equal(formatCompatibilityBytes(fixture.bytes), fixture.expected);
  for (const invalid of [-1, NaN, Infinity, 1.5, "1024", 9007199254740992]) assert.throws(() => formatCompatibilityBytes(invalid));
});

test("snapshot survives changes to input while hashing and never exports extra private fields", async () => {
  const input = structuredClone(vectors.cases[0].input);
  input.archivePath = "C:\\private\\archive.7z";
  input.diagnosticLog = "private log";
  const pending = createCompatibilityReport(input);
  input.model = "changed";
  input.steps.import = "error";
  assert.equal(await pending, vectors.cases[0].text);
});

test("reject inconsistent states, unknown enums and malformed Unicode instead of emitting false success", async () => {
  const good = vectors.cases[0].input;
  const invalid = [
    { launchMode: "browser" }, { appVersion: "v0.4" }, { variant: "EXE" },
    { utcOffsetMinutes: 841 }, { formedAtMs: -1 }, { formedAtMs: 253402300800000 },
    { error: "quota" }, { model: "\ud800" }, { model: "x".repeat(513) },
    { archiveFormat: "RAR" }, { archiveFiles: -1 },
    { steps: { ...good.steps, import: "not_checked" } },
    { steps: { ...good.steps, game: "success" } },
    { steps: { launch: "success", import: "error", storefront: "error", game: "not_checked" } },
  ];
  for (const patch of invalid) await assert.rejects(createCompatibilityReport({ ...good, ...patch }));
  await assert.rejects(compatibilityCode("\udc00"));
});

test("safe error catalogue and default unknown values", () => {
  const input = { ...vectors.cases[0].input, steps: { launch: "success", import: "error" } };
  assert.match(formatCompatibilityBody(input), /код: GS-CHECK-ERROR/);
  assert.throws(() => formatCompatibilityBody({ ...input, error: "/private/path/raw exception" }));
  assert.equal(COMPATIBILITY_FORM_URL, vectors.formUrl);
});
