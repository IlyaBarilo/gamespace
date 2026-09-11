import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, realpath, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { assemblePages } from "../scripts/assemble-pages.mjs";
import { measurePagesSize } from "../scripts/verify-pages-size.mjs";

async function fixture(t) {
  const parent = await realpath(os.tmpdir());
  const directory = await mkdtemp(path.join(parent, "gs-pages-retention-"));
  t.after(async () => {
    const resolved = await realpath(directory);
    assert.equal(path.dirname(resolved), parent);
    assert.ok(path.basename(resolved).startsWith("gs-pages-retention-"));
    await rm(resolved, { recursive: true, force: true });
  });
  const releasesRoot = path.join(directory, "packages");
  await mkdir(releasesRoot);
  const notices = [];
  let sequence = 0;
  async function release(version, padding = 0) {
    const root = path.join(releasesRoot, version);
    await mkdir(root);
    const contents = {
      "index.html": `<title>${version}</title>` + "x".repeat(padding),
      "sw-runtime-v1.js": "// immutable fixture runtime\r\n",
      "LICENSE.txt": "Fixture license\r\n",
    };
    const files = [];
    for (const [name, text] of Object.entries(contents)) {
      const bytes = Buffer.from(text);
      await writeFile(path.join(root, name), bytes);
      files.push({ path: name, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
    }
    await writeFile(path.join(root, "release.json"), JSON.stringify({
      schema: 1, product: "gamespace-pwa", version, runtime: "sw-runtime-v1.js",
      date: "2026-09-11", description: `Описание ${version}: кириллица учитывается в байтах.`,
      totalSize: files.reduce((sum, file) => sum + file.size, 0), files,
    }));
  }
  const build = (options = {}) => assemblePages("0.3.12", {
    releasesRoot, outputRoot: path.join(directory, `pages-${++sequence}`),
    notice: text => notices.push(text), ...options,
  });
  return { directory, releasesRoot, release, build, notices };
}

test("exact budget for three releases includes root, manifests, UTF-8 metadata and licenses", async t => {
  const f = await fixture(t);
  for (const version of ["0.3.12", "0.3.11", "0.3.10"]) await f.release(version);
  const baseline = await f.build();
  for (const version of ["0.3.9", "0.3.8"]) await f.release(version);
  const result = await f.build({ limit: baseline.bytes });
  assert.deepEqual(result.versions, ["0.3.12", "0.3.11", "0.3.10"]);
  assert.equal(result.bytes, baseline.bytes);
  assert.equal((await measurePagesSize(result.directory)).bytes, baseline.bytes);
  assert.deepEqual((await readdir(path.join(result.directory, "releases"))).sort(), result.versions.slice().sort());
  const catalog = JSON.parse(await readFile(path.join(result.directory, "versions.json"), "utf8"));
  assert.deepEqual(catalog.versions.map(release => release.version), result.versions);
  assert.match(f.notices.at(-2), /добавление 0\.3\.9/);
});

test("history stops at the first optional oversized release even when an older smaller one would fit", async t => {
  const f = await fixture(t);
  for (const version of ["0.3.12", "0.3.11", "0.3.10", "0.3.9"]) await f.release(version);
  const baseline = await f.build();
  await f.release("0.3.8", 10000);
  await f.release("0.3.7");
  const result = await f.build({ limit: baseline.bytes + 2000 });
  assert.deepEqual(result.versions, ["0.3.12", "0.3.11", "0.3.10", "0.3.9"]);
  assert.match(f.notices.at(-2), /добавление 0\.3\.8/);
  assert.ok((await measurePagesSize(path.join(f.releasesRoot, "0.3.7"))).bytes < 1500);
  for (const version of ["0.3.8", "0.3.7"]) {
    await assert.rejects(stat(path.join(result.directory, "releases", version)), { code: "ENOENT" });
    assert.ok((await stat(path.join(f.releasesRoot, version, "index.html"))).isFile());
  }
});

test("APK catalog is budgeted before optional history and is copied byte for byte", async t => {
  const f = await fixture(t);
  for (const version of ["0.3.12", "0.3.11", "0.3.10", "0.3.9"]) await f.release(version);
  const baseline = await f.build();
  const apkCatalog = path.join(f.directory, "updates.json");
  const bytes = Buffer.from('{"fixture":"APK metadata"}\r\n');
  await writeFile(apkCatalog, bytes);
  const result = await f.build({ apkCatalog, limit: baseline.bytes });
  assert.deepEqual(result.versions, ["0.3.12", "0.3.11", "0.3.10"]);
  assert.deepEqual(await readFile(path.join(result.directory, "apk", "updates.json")), bytes);
  assert.deepEqual(await readFile(apkCatalog), bytes);
  assert.ok(result.bytes <= baseline.bytes);
});

test("oversized mandatory three abort before output is created and cannot fall back to two", async t => {
  const f = await fixture(t);
  for (const version of ["0.3.12", "0.3.11", "0.3.10"]) await f.release(version);
  const generous = await f.build();
  await f.release("0.3.9");
  // One byte below the complete minimum must not silently drop a mandatory release.
  const outputRoot = path.join(f.directory, "rejected");
  await assert.rejects(f.build({ limit: generous.bytes - 1, outputRoot }), /Обязательные последние 3 версии.*Публикация остановлена/);
  await assert.rejects(stat(outputRoot), { code: "ENOENT" });
  assert.ok((await stat(generous.directory)).isDirectory(), "previously prepared site remains intact");
});

test("one or two existing releases remain publishable while the maximum stays ten", async t => {
  const f = await fixture(t);
  await f.release("0.3.12");
  assert.deepEqual((await f.build()).versions, ["0.3.12"]);
  await f.release("0.3.11");
  assert.equal((await f.build()).versions.length, 2);
  for (let patch = 1; patch <= 10; patch++) await f.release(`0.3.${patch}`);
  const result = await f.build();
  assert.deepEqual(result.versions, Array.from({ length: 10 }, (_, i) => `0.3.${12 - i}`));
  const source = await readFile(path.join(f.releasesRoot, "0.3.12", "sw-runtime-v1.js"));
  assert.deepEqual(await readFile(path.join(result.directory, "sw-runtime-v1.js")), source);
  await assert.rejects(f.build({ outputRoot: path.dirname(result.directory) }), /уже существует/);
});
