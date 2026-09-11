import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  APPLICATION_ID, MAX_JSON_BYTES, REPOSITORY_URL, createReleaseEntry, hashApk,
  mergeCatalog, parseApkIdentity, parseReleaseTag, readJson, serializeCatalog,
  validateCatalog, validatePublishedRelease,
} from "../scripts/apk-update-catalog.mjs";
import { prepareUpdateCatalog } from "../scripts/prepare-update-catalog.mjs";

const SIGNER = "ab".repeat(32);
const BYTES = Buffer.from("APK fixture: only metadata/IO tests, not a signed Android package");
const HASH = createHash("sha256").update(BYTES).digest("hex");

function publishedRelease(tag = "v0.3.13") {
  const { version } = parseReleaseTag(tag);
  const name = `GameSpace-${version}.apk`;
  return {
    tag_name: tag, draft: false, prerelease: false,
    published_at: "2026-09-11T12:30:00Z", body: "Исправил загрузку.\r\nДобавил проверку обновлений.",
    html_url: `${REPOSITORY_URL}/releases/tag/${tag}`,
    assets: [{
      name, size: BYTES.length, state: "uploaded", digest: `sha256:${HASH}`,
      browser_download_url: `${REPOSITORY_URL}/releases/download/${tag}/${name}`,
    }],
  };
}

function badging(tag = "v0.3.13", newline = "\r\n") {
  const { version, versionCode } = parseReleaseTag(tag);
  return `package: name='${APPLICATION_ID}' versionCode='${versionCode}' versionName='${version}' platformBuildVersionCode='36'${newline}minSdkVersion:'23'${newline}targetSdkVersion:'36'${newline}`;
}

function certificateReport(signer = SIGNER) {
  return `Verifies\r\nNumber of signers: 1\r\nSigner #1 certificate SHA-256 digest: ${signer}\r\n`;
}

function entry(tag = "v0.3.13") {
  return createReleaseEntry(
    validatePublishedRelease(publishedRelease(tag)),
    parseApkIdentity(badging(tag), certificateReport(), SIGNER),
    { size: BYTES.length, sha256: HASH },
  );
}

async function temporaryDirectory(t, parent = os.tmpdir()) {
  const base = path.resolve(parent);
  const directory = await mkdtemp(path.join(base, "gamespace-apk-catalog-"));
  t.after(async () => {
    const resolved = path.resolve(directory);
    const relative = path.relative(base, resolved);
    assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
    await rm(resolved, { recursive: true, force: true });
  });
  return directory;
}

async function preparationFixture(t, parent) {
  const directory = await temporaryDirectory(t, parent);
  const options = {
    apk: path.join(directory, "input with spaces.apk"),
    release: path.join(directory, "release.json"),
    aapt2: path.join(directory, "SDK with spaces", "aapt2"),
    apksignerJar: path.join(directory, "SDK with spaces", "apksigner.jar"),
    java: path.join(directory, "JDK with spaces", "java"),
    expectedSignerSha256: SIGNER, output: path.join(directory, "pages", "apk", "updates.json"),
  };
  await writeFile(options.apk, BYTES);
  await writeFile(options.release, JSON.stringify(publishedRelease()));
  const calls = [];
  async function inspectTool(executable, args) {
    calls.push({ executable, args });
    if (args[0] === "-jar") return certificateReport();
    assert.equal(args[0], "dump");
    return badging();
  }
  return { options, calls, inspectTool, directory };
}

test("canonical tags follow the existing Android versionCode mapping", () => {
  for (const [tag, version, code] of [
    ["v1", "1.0.0", 10000], ["v0.5", "0.5.0", 500], ["v0.6.22", "0.6.22", 622],
    ["v0.3.13", "0.3.13", 313], ["v1.0.1", "1.0.1", 10001],
    ["v214748.36.47", "214748.36.47", 2147483647],
  ]) assert.deepEqual(parseReleaseTag(tag), { tag, version, versionCode: code });
  for (const tag of ["v0", "v01", "v1.0", "v0.5.0", "v0.03.1", "v1.2.3.4", "v1-beta", "v0.3.100", "v0.100", "v214748.36.48", "v9007199254740993", "../v1", "1", null]) {
    assert.throws(() => parseReleaseTag(tag), undefined, String(tag));
  }
});

test("only stable published releases with one fully uploaded versioned APK are accepted", () => {
  for (const modify of [
    (r) => { r.draft = true; }, (r) => { delete r.draft; }, (r) => { r.prerelease = true; },
    (r) => { r.published_at = null; }, (r) => { r.published_at = "2026-02-30T12:00:00Z"; },
    (r) => { r.html_url = r.html_url.replace("IlyaBarilo", "attacker"); },
    (r) => { r.assets = []; }, (r) => { r.assets.push({ ...r.assets[0] }); },
    (r) => { r.assets[0].name = "GameSpace-latest.apk"; },
    (r) => { r.assets[0].state = "starter"; }, (r) => { r.assets[0].size = 0; },
    (r) => { r.assets[0].browser_download_url += "?redirect=other"; },
    (r) => { r.assets[0].browser_download_url = "https://github.com.attacker.invalid/file.apk"; },
    (r) => { r.assets[0].browser_download_url = r.assets[0].browser_download_url.replace("https:", "http:"); },
    (r) => { r.assets[0].digest = "sha256:bad"; },
    (r) => { r.body = "я".repeat(32768); }, (r) => { r.body = {}; },
  ]) {
    const release = publishedRelease();
    modify(release);
    assert.throws(() => validatePublishedRelease(release));
  }
  const old = publishedRelease();
  old.assets[0].digest = null;
  old.body = null;
  assert.equal(validatePublishedRelease(old).asset.digest, null);
  assert.equal(validatePublishedRelease(old).description, "");
});

test("APK identity accepts SDK line endings and requires the expected signing certificate", () => {
  for (const newline of ["\n", "\r\n"]) {
    const identity = parseApkIdentity(badging("v0.3.13", newline), certificateReport(SIGNER.toUpperCase()), SIGNER);
    assert.equal(identity.versionCode, 313);
    assert.equal(identity.minSdk, 23);
    assert.equal(identity.signerSha256, SIGNER);
  }
  assert.equal(parseApkIdentity(badging().replace("minSdkVersion", "sdkVersion"), certificateReport(), SIGNER).minSdk, 23);
  assert.throws(() => parseApkIdentity(badging().replace(APPLICATION_ID, "other.app"), certificateReport(), SIGNER), /другому приложению/);
  assert.throws(() => parseApkIdentity(badging(), certificateReport("cd".repeat(32)), SIGNER), /не совпадает/);
  assert.throws(() => parseApkIdentity(badging(), "Verifies", SIGNER), /одна подпись/);
  assert.throws(() => parseApkIdentity(badging(), certificateReport() + certificateReport(), SIGNER), /одна подпись/);
  assert.throws(() => parseApkIdentity(badging() + "sdkVersion:'24'\n", certificateReport(), SIGNER), /однозначно/);
});

test("APK version, length and SHA-256 must agree with the release", () => {
  const release = validatePublishedRelease(publishedRelease());
  const identity = parseApkIdentity(badging(), certificateReport(), SIGNER);
  const file = { size: BYTES.length, sha256: HASH };
  assert.throws(() => createReleaseEntry(release, { ...identity, version: "0.3.12" }, file), /не соответствуют/);
  assert.throws(() => createReleaseEntry(release, { ...identity, versionCode: 999 }, file), /не соответствуют/);
  assert.throws(() => createReleaseEntry(release, identity, { ...file, size: file.size + 1 }), /Размер/);
  assert.throws(() => createReleaseEntry(release, identity, { ...file, sha256: "00".repeat(32) }), /SHA-256/);
  assert.equal(createReleaseEntry(release, identity, file).description, "Исправил загрузку.\nДобавил проверку обновлений.");
});

test("retrying an older release cannot downgrade latest; ordering is numeric", () => {
  let catalog = mergeCatalog(entry("v0.3.9"));
  catalog = mergeCatalog(entry("v0.3.13"), catalog);
  catalog = mergeCatalog(entry("v0.3.10"), catalog);
  catalog = mergeCatalog(entry("v0.3.9"), catalog);
  assert.equal(catalog.latestVersionCode, 313);
  assert.deepEqual(catalog.releases.map((r) => r.versionCode), [313, 310, 309]);
  assert.deepEqual(mergeCatalog(entry(), catalog), catalog);
});

test("same-version retries may edit notes but cannot replace an APK or its identity", () => {
  const original = entry();
  const previous = mergeCatalog(original);
  assert.equal(mergeCatalog({ ...original, description: "Уточнил описание." }, previous).releases[0].description, "Уточнил описание.");
  for (const modify of [
    (r) => { r.apk.sha256 = "00".repeat(32); }, (r) => { r.apk.signerSha256 = "cd".repeat(32); },
    (r) => { r.apk.size += 1; }, (r) => { r.minSdk += 1; },
    (r) => { r.publishedAt = "2026-09-12T12:30:00Z"; },
  ]) {
    const replacement = structuredClone(original);
    modify(replacement);
    assert.throws(() => mergeCatalog(replacement, previous), /нельзя заменить/);
  }
});

test("a malformed previous catalog fails instead of silently starting over", () => {
  for (const modify of [
    (c) => { c.schemaVersion = 2; }, (c) => { c.applicationId = "other.app"; },
    (c) => { c.channel = "beta"; }, (c) => { c.latestVersionCode = 1; },
    (c) => { c.releases = []; }, (c) => { c.releases.push(c.releases[0]); },
    (c) => { c.releases[0].apk.url += "#bad"; },
    (c) => { c.releases[0].versionCode = 314; },
    (c) => { c.releases[0].minSdk = -1; },
  ]) {
    const catalog = mergeCatalog(entry());
    modify(catalog);
    assert.throws(() => mergeCatalog(entry("v0.3.14"), catalog));
  }
  assert.throws(() => validateCatalog(null));
});

test("catalog retains the newest 100 entries and has bounded UTF-8 size with CRLF", () => {
  let catalog = null;
  for (let code = 1; code <= 101; code++) {
    const version = `v0.${Math.floor(code / 100)}${code % 100 ? `.${code % 100}` : ""}`;
    catalog = mergeCatalog(entry(version), catalog);
  }
  assert.equal(catalog.releases.length, 100);
  assert.equal(catalog.latestVersionCode, 101);
  assert.equal(catalog.releases.at(-1).versionCode, 2);
  const text = serializeCatalog(catalog);
  assert.ok(!/(?<!\r)\n/.test(text));
  assert.deepEqual(JSON.parse(text), catalog);
  for (const release of catalog.releases) release.description = "x".repeat(32768);
  assert.throws(() => serializeCatalog(catalog), /1 МиБ/);
});

test("hashing reads actual bytes; JSON rejects oversized files and invalid UTF-8", async (t) => {
  const directory = await temporaryDirectory(t);
  const apk = path.join(directory, "payload.apk");
  await writeFile(apk, BYTES);
  assert.deepEqual(await hashApk(apk), { size: BYTES.length, sha256: HASH });
  const json = path.join(directory, "input.json");
  await writeFile(json, Buffer.alloc(MAX_JSON_BYTES + 1, 32));
  await assert.rejects(readJson(json), /1 МиБ/);
  await writeFile(json, Buffer.from([0xff, 0xfe]));
  await assert.rejects(readJson(json));
  await writeFile(json, Buffer.from([0xef, 0xbb, 0xbf, 0x7b, 0x7d]));
  assert.deepEqual(await readJson(json), {});
});

test("preparation verifies through SDK tools, writes a fresh catalog, and preserves inputs", async (t) => {
  const { options, inspectTool, calls } = await preparationFixture(t);
  const canonicalApk = await realpath(options.apk);
  const before = await stat(options.apk);
  const catalog = await prepareUpdateCatalog(options, { inspectTool });
  assert.equal(catalog.latestVersionCode, 313);
  assert.deepEqual(JSON.parse(await readFile(options.output, "utf8")), catalog);
  assert.deepEqual(await readFile(options.apk), BYTES);
  assert.equal((await stat(options.apk)).mtimeMs, before.mtimeMs);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].args.slice(0, 5), ["-jar", options.apksignerJar, "verify", "--verbose", "--print-certs"]);
  assert.deepEqual(calls[1].args.slice(0, 2), ["dump", "badging"]);
  // Windows TEMP can use a short name or different casing for the same file.
  for (const call of calls) assert.equal(call.args.at(-1), canonicalApk);
});

test("relative APK paths resolve to the same input for both SDK tools", async (t) => {
  // Windows cannot make a relative path between the workspace and TEMP on different drives.
  const { options, inspectTool, calls } = await preparationFixture(t, process.cwd());
  const canonicalApk = await realpath(options.apk);
  options.apk = path.relative(process.cwd(), options.apk);
  assert.ok(!path.isAbsolute(options.apk));
  await prepareUpdateCatalog(options, { inspectTool });
  assert.equal(calls.length, 2);
  for (const call of calls) assert.equal(call.args.at(-1), canonicalApk);
  assert.deepEqual(await readFile(canonicalApk), BYTES);
});

test("signature-tool failure stops preparation before a catalog is created", async (t) => {
  const { options } = await preparationFixture(t);
  await assert.rejects(prepareUpdateCatalog(options, {
    inspectTool: async () => { throw new Error("APK signature verification failed"); },
  }), /signature verification failed/);
  await assert.rejects(stat(options.output), { code: "ENOENT" });
});

test("a same-size payload change is caught by the release digest", async (t) => {
  const { options, inspectTool } = await preparationFixture(t);
  const corrupt = Buffer.from(BYTES);
  corrupt[0] ^= 1;
  await writeFile(options.apk, corrupt);
  await assert.rejects(prepareUpdateCatalog(options, { inspectTool }), /SHA-256/);
  await assert.rejects(stat(options.output), { code: "ENOENT" });
});

test("missing or damaged previous catalogs fail without creating an output", async (t) => {
  const { options, inspectTool, directory } = await preparationFixture(t);
  options.previous = path.join(directory, "previous.json");
  await assert.rejects(prepareUpdateCatalog(options, { inspectTool }), { code: "ENOENT" });
  await writeFile(options.previous, "{}");
  await assert.rejects(prepareUpdateCatalog(options, { inspectTool }), /формат каталога/);
  await assert.rejects(stat(options.output), { code: "ENOENT" });
});

test("APK changes during SDK inspection invalidate the whole result", async (t) => {
  const { options, inspectTool } = await preparationFixture(t);
  await assert.rejects(prepareUpdateCatalog(options, {
    inspectTool: async (executable, args) => {
      if (args[0] === "dump") await writeFile(options.apk, Buffer.concat([BYTES, Buffer.from("changed")]));
      return inspectTool(executable, args);
    },
  }), /изменился во время проверки/);
  await assert.rejects(stat(options.output), { code: "ENOENT" });
});

test("existing output files are never overwritten", async (t) => {
  const { options, inspectTool } = await preparationFixture(t);
  await mkdir(path.dirname(options.output), { recursive: true });
  await writeFile(options.output, "user-owned output");
  await assert.rejects(prepareUpdateCatalog(options, { inspectTool }), { code: "EEXIST" });
  assert.equal(await readFile(options.output, "utf8"), "user-owned output");
});

test("CLI reports missing/duplicate arguments without running SDK tools", () => {
  const script = fileURLToPath(new URL("../scripts/prepare-update-catalog.mjs", import.meta.url));
  for (const args of [[], ["--unknown", "x"], ["--apk", "x", "--apk", "y"]]) {
    const result = spawnSync(process.execPath, [script, ...args], { encoding: "utf8", windowsHide: true });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Каталог APK не создан/);
  }
  const help = spawnSync(process.execPath, [script, "--help"], { encoding: "utf8", windowsHide: true });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /--expected-signer-sha256/);
});

test("real Android SDK verifies an existing signed APK and rejects a damaged copy", {
  skip: !process.env.GAMESPACE_CATALOG_TEST_APK,
}, async (t) => {
  const directory = await temporaryDirectory(t);
  const execute = promisify(execFile);
  const apk = path.resolve(process.env.GAMESPACE_CATALOG_TEST_APK);
  const aapt2 = process.env.GAMESPACE_CATALOG_TEST_AAPT2;
  const apksignerJar = process.env.GAMESPACE_CATALOG_TEST_APKSIGNER_JAR;
  const java = process.env.GAMESPACE_CATALOG_TEST_JAVA || "java";
  assert.ok(aapt2 && apksignerJar, "Configure SDK paths for the integration test.");
  const before = await stat(apk);
  const originalHash = await hashApk(apk);
  const sdkOptions = { encoding: "utf8", windowsHide: true, timeout: 120000, maxBuffer: 2 * 1024 * 1024 };
  const { stdout: signature } = await execute(java, ["-jar", apksignerJar, "verify", "--verbose", "--print-certs", apk], sdkOptions);
  const { stdout: packageInfo } = await execute(aapt2, ["dump", "badging", apk], sdkOptions);
  const signer = /Signer #1 certificate SHA-256 digest: ([0-9a-f]+)/i.exec(signature)[1];
  const identity = parseApkIdentity(packageInfo, signature, signer);
  const parts = identity.version.split(".");
  while (parts.length > 1 && parts.at(-1) === "0") parts.pop();
  const release = publishedRelease(`v${parts.join(".")}`);
  release.assets[0].size = originalHash.size;
  release.assets[0].digest = `sha256:${originalHash.sha256}`;
  const metadata = path.join(directory, "release.json");
  await writeFile(metadata, JSON.stringify(release));
  const options = {
    apk, aapt2, apksignerJar, java, expectedSignerSha256: signer,
    release: metadata, output: path.join(directory, "valid", "updates.json"),
  };
  const catalog = await prepareUpdateCatalog(options);
  assert.equal(catalog.releases[0].apk.sha256, originalHash.sha256);
  assert.equal(catalog.releases[0].version, identity.version);
  await assert.rejects(prepareUpdateCatalog({
    ...options, expectedSignerSha256: "00".repeat(32), output: path.join(directory, "wrong-signer", "updates.json"),
  }), /Подпись APK не совпадает/);
  const damaged = path.join(directory, "damaged.apk");
  // Corrupt the ZIP header in an isolated copy, leaving the user's original APK untouched.
  const bytes = await readFile(apk);
  bytes.fill(0, 0, Math.min(64, bytes.length));
  await writeFile(damaged, bytes);
  const damagedOutput = path.join(directory, "damaged", "updates.json");
  await assert.rejects(prepareUpdateCatalog({ ...options, apk: damaged, output: damagedOutput }));
  await assert.rejects(stat(damagedOutput), { code: "ENOENT" });
  assert.deepEqual(await hashApk(apk), originalHash);
  assert.equal((await stat(apk)).mtimeMs, before.mtimeMs);
});
