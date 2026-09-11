import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { APPLICATION_ID, MAX_JSON_BYTES, REPOSITORY_URL, parseReleaseTag } from "../scripts/apk-update-catalog.mjs";
import { readPublishedCache, restoreUpdateCatalog } from "../scripts/restore-update-catalog.mjs";

const SIGNER = "ab".repeat(32);
const bytesFor = (tag) => Buffer.from(`test APK ${tag}`);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

function releaseFor(tag) {
  const { version } = parseReleaseTag(tag);
  return {
    tag_name: tag, draft: false, prerelease: false,
    html_url: `${REPOSITORY_URL}/releases/tag/${tag}`,
    published_at: "2026-09-11T12:00:00Z", body: `Описание ${version}`,
    assets: [`GameSpace-${version}.apk`, "GameSpace-latest.apk", `gamespace-pwa-${version}.tar.gz`].map((name) => ({
      name, state: "uploaded", size: bytesFor(tag).length,
      digest: `sha256:${hash(bytesFor(tag))}`,
      browser_download_url: `${REPOSITORY_URL}/releases/download/${tag}/${name}`,
    })),
  };
}

async function fixture(t, tags = ["v0.3.14", "v0.3.13"]) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "gamespace-catalog-recovery-"));
  t.after(async () => {
    const relative = path.relative(path.resolve(os.tmpdir()), path.resolve(directory));
    assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
    await rm(directory, { recursive: true, force: true });
  });
  const releases = Object.fromEntries(tags.map((tag) => [tag, releaseFor(tag)]));
  const options = {
    repository: "IlyaBarilo/gamespace", currentTag: "v0.3.14", expectedSignerSha256: SIGNER,
    aapt2: path.join(directory, "aapt2"), apksignerJar: path.join(directory, "apksigner.jar"),
    java: "java", workDirectory: path.join(directory, "work"), output: path.join(directory, "pages", "apk", "updates.json"),
  };
  const calls = [], notices = [];
  const state = { tags: [...tags], releases };
  const flag = (args, name) => args[args.indexOf(name) + 1];
  async function run(executable, args) {
    calls.push([executable, ...args]);
    if (executable === "gh") {
      if (args[0] === "release" && args[1] === "list") {
        if (state.failList) throw new Error("GitHub list unavailable");
        return JSON.stringify(state.tags.map((tagName) => ({ tagName })));
      }
      if (args[0] === "api") {
        const tag = args[1].split("/").at(-1);
        if (state.failMetadata === tag) throw new Error("GitHub metadata unavailable");
        return JSON.stringify(state.releases[tag]);
      }
      if (args[0] === "release" && args[1] === "download") {
        const tag = args[2], name = flag(args, "--pattern");
        if (state.failDownload === tag) throw new Error("Download interrupted");
        let bytes = bytesFor(tag);
        if (state.corruptVersioned === tag && name !== "GameSpace-latest.apk") bytes = Buffer.from("changed");
        if (state.corruptBoth === tag) bytes = Buffer.alloc(bytes.length, 0);
        await writeFile(path.join(flag(args, "--dir"), name), bytes);
        return "";
      }
      assert.fail(`Unexpected GitHub operation: ${args.join(" ")}`);
    }
    const tag = (await readFile(args.at(-1), "utf8")).replace("test APK ", "");
    if (args[0] === "-jar") {
      if (state.failSignature === tag) throw new Error("SDK rejected the signature");
      const signer = state.wrongSigner === tag ? "cd".repeat(32) : SIGNER;
      return `Verifies\nSigner #1 certificate SHA-256 digest: ${signer}\n`;
    }
    assert.equal(args[0], "dump");
    const { version, versionCode } = parseReleaseTag(tag);
    return `package: name='${APPLICATION_ID}' versionCode='${versionCode}' versionName='${version}'\nminSdkVersion:'23'\n`;
  }
  return { options, state, calls, notices, run, restore: (dependencies = {}) => restoreUpdateCatalog(options, { run, notice: (text) => notices.push(text), ...dependencies }) };
}

test("first catalog is reconstructed from ready assets without fetching a Pages endpoint", async (t) => {
  const f = await fixture(t);
  const catalog = await f.restore();
  assert.equal(catalog.latestVersionCode, 314);
  assert.deepEqual(catalog.releases.map((r) => r.version), ["0.3.14", "0.3.13"]);
  assert.deepEqual(JSON.parse(await readFile(f.options.output, "utf8")), catalog);
  assert.ok(f.calls.filter((call) => call[0] === "gh").every((call) => call[1] === "api" || ["list", "download"].includes(call[2])));
  assert.equal(f.calls.filter((call) => call[1] === "release" && call[2] === "download").length, 4);
});

test("retry of an old release keeps the newest version and includes a tag missing from the list", async (t) => {
  const f = await fixture(t, ["v0.3.14", "v0.3.9"]);
  f.options.currentTag = "v0.3.9";
  f.state.tags = ["v0.3.14"];
  const catalog = await f.restore();
  assert.equal(catalog.latestVersionCode, 314);
  assert.deepEqual(catalog.releases.map((r) => r.tag), ["v0.3.14", "v0.3.9"]);
});

test("incomplete older releases are skipped, while an incomplete current release is fatal", async (t) => {
  const f = await fixture(t);
  f.state.releases["v0.3.13"].assets.pop();
  assert.deepEqual((await f.restore()).releases.map((r) => r.tag), ["v0.3.14"]);
  assert.equal(f.notices.length, 1);
  const g = await fixture(t);
  g.state.releases["v0.3.14"].assets[1].state = "starter";
  await assert.rejects(g.restore(), /всех трёх/);
  await assert.rejects(stat(g.options.output), { code: "ENOENT" });
});

test("missing legacy APK assets do not enter the catalog and unsupported tags are not requested", async (t) => {
  const f = await fixture(t);
  f.state.releases["v0.3.13"].assets = [f.state.releases["v0.3.13"].assets[2]];
  f.state.tags.push("v0.3.0", "../../bad", "nightly");
  assert.equal((await f.restore()).releases.length, 1);
  assert.ok(!f.calls.some((call) => call[1] === "api" && /bad|nightly|v0\.3\.0$/.test(call[2])));
});

test("list, metadata and download failures never become an empty or shortened catalog", async (t) => {
  for (const [property, value] of [["failList", true], ["failMetadata", "v0.3.13"], ["failDownload", "v0.3.13"]]) {
    const f = await fixture(t);
    f.state[property] = value;
    await assert.rejects(f.restore(), /unavailable|interrupted/);
    await assert.rejects(stat(f.options.output), { code: "ENOENT" });
  }
});

test("a release changing to draft or prerelease aborts the snapshot", async (t) => {
  for (const property of ["draft", "prerelease"]) {
    const f = await fixture(t);
    f.state.releases["v0.3.13"][property] = true;
    await assert.rejects(f.restore(), /Статус или тег/);
    await assert.rejects(stat(f.options.output), { code: "ENOENT" });
  }
});

test("conflicting APK copies and corrupted GitHub digests stop publication", async (t) => {
  const f = await fixture(t);
  f.state.corruptVersioned = "v0.3.13";
  await assert.rejects(f.restore(), /различаются/);
  await assert.rejects(stat(f.options.output), { code: "ENOENT" });
  const g = await fixture(t);
  g.state.releases["v0.3.13"].assets[1].digest = `sha256:${"00".repeat(32)}`;
  await assert.rejects(g.restore(), /SHA-256/);
});

test("the certificate comes from the trusted build, never from remote release metadata", async (t) => {
  for (const property of ["wrongSigner", "failSignature"]) {
    const f = await fixture(t);
    f.state[property] = "v0.3.13";
    await assert.rejects(f.restore(), /Подпись APK|SDK rejected/);
    await assert.rejects(stat(f.options.output), { code: "ENOENT" });
  }
});

test("fork URLs, changed tags and duplicate assets cannot be advertised", async (t) => {
  for (const change of [
    (r) => { r.tag_name = "v0.3.15"; },
    (r) => { r.assets.push({ ...r.assets[1] }); },
    (r) => { r.assets[0].browser_download_url = "https://attacker.invalid/GameSpace.apk"; },
  ]) {
    const f = await fixture(t);
    change(f.state.releases["v0.3.14"]);
    await assert.rejects(f.restore());
    await assert.rejects(stat(f.options.output), { code: "ENOENT" });
  }
  const f = await fixture(t);
  f.options.repository = "other/repository";
  await assert.rejects(f.restore(), /официального репозитория/);
  assert.equal(f.calls.length, 0);
});

test("the published catalog is never overwritten by local preparation", async (t) => {
  const f = await fixture(t);
  await mkdir(path.dirname(f.options.output), { recursive: true });
  await writeFile(f.options.output, "previous published bytes");
  await assert.rejects(f.restore(), { code: "EEXIST" });
  assert.equal(await readFile(f.options.output, "utf8"), "previous published bytes");
});

async function cacheFixture(t) {
  const f = await fixture(t);
  const cache = await f.restore();
  f.options.output = path.join(path.dirname(f.options.output), "next", "updates.json");
  f.options.usePublishedCache = true;
  f.calls.length = 0;
  const fetchCatalog = async (url, options) => {
    assert.equal(url, "https://ilyabarilo.github.io/gamespace/apk/updates.json");
    assert.equal(options.redirect, "error");
    assert.equal(options.credentials, "omit");
    assert.equal(options.headers, undefined, "GitHub token is never sent to Pages");
    return new Response(JSON.stringify(cache));
  };
  return { ...f, cache, cached: () => f.restore({ fetchCatalog }) };
}

const downloads = f => f.calls.filter(call => call[1] === "release" && call[2] === "download");

test("matching published entries avoid all APK downloads and SDK calls, but refresh descriptions", async t => {
  const f = await cacheFixture(t);
  f.state.releases["v0.3.13"].body = "Новое описание";
  const catalog = await f.cached();
  assert.equal(catalog.releases[1].description, "Новое описание");
  assert.equal(downloads(f).length, 0);
  assert.ok(f.calls.every(call => call[0] === "gh"));
  assert.equal(f.calls.filter(call => call[1] === "api").length, 2);
});

test("a new release downloads only its two APK copies while older entries use the cache", async t => {
  const f = await cacheFixture(t);
  f.options.currentTag = "v0.3.15";
  f.state.releases["v0.3.15"] = releaseFor("v0.3.15");
  const catalog = await f.cached();
  assert.equal(catalog.latestVersionCode, 315);
  assert.equal(catalog.releases.length, 3);
  assert.equal(downloads(f).length, 2);
  assert.ok(downloads(f).every(call => call[3] === "v0.3.15"));
});

test("cache reuse requires both GitHub digests and the trusted certificate", async t => {
  for (const change of [
    f => { delete f.state.releases["v0.3.13"].assets[0].digest; },
    f => { delete f.state.releases["v0.3.13"].assets[1].digest; },
    f => { f.cache.releases[1].apk.sha256 = "00".repeat(32); },
    f => { f.cache.releases[1].apk.signerSha256 = "cd".repeat(32); },
    f => { f.cache.releases[1].apk.size++; },
    f => { f.cache.releases[1].publishedAt = "2026-09-10T12:00:00Z"; },
  ]) {
    const f = await cacheFixture(t); change(f);
    assert.equal((await f.cached()).releases.length, 2);
    assert.equal(downloads(f).length, 2);
    assert.ok(downloads(f).every(call => call[3] === "v0.3.13"));
  }
});

test("a missing or invalid cache rebuilds the full history instead of shortening it", async t => {
  for (const fetchCatalog of [
    async () => { throw new Error("network unavailable"); },
    async () => new Response("not found", { status: 404 }),
    async () => new Response('{"schema":999}'),
  ]) {
    const f = await cacheFixture(t);
    assert.equal((await f.restore({ fetchCatalog })).releases.length, 2);
    assert.equal(downloads(f).length, 4);
    assert.ok(f.notices.some(text => text.includes("полная проверка")));
  }
});

test("live release failures remain fatal even with a complete cache", async t => {
  const f = await cacheFixture(t);
  f.state.failMetadata = "v0.3.13";
  await assert.rejects(f.cached(), /metadata unavailable/);
  await assert.rejects(stat(f.options.output), { code: "ENOENT" });
  const g = await cacheFixture(t);
  g.state.releases["v0.3.13"].assets[1].digest = `sha256:${"00".repeat(32)}`;
  await assert.rejects(g.cached(), /SHA-256/);
  await assert.rejects(stat(g.options.output), { code: "ENOENT" });
});

test("cached releases removed or made incomplete on GitHub do not remain advertised", async t => {
  const f = await cacheFixture(t);
  f.state.tags = ["v0.3.14"];
  assert.equal((await f.cached()).releases.length, 1);
  const g = await cacheFixture(t);
  g.state.releases["v0.3.13"].assets.pop();
  assert.equal((await g.cached()).releases.length, 1);
});

test("published cache reads are bounded and reject invalid UTF-8", async () => {
  for (const response of [
    new Response("small", { headers: { "content-length": String(MAX_JSON_BYTES + 1) } }),
    new Response(new Uint8Array(MAX_JSON_BYTES + 1)),
    new Response(new Uint8Array([0xc3, 0x28])),
  ]) {
    const notices = [];
    assert.equal(await readPublishedCache({ fetchCatalog: async () => response, notice: text => notices.push(text) }), null);
    assert.equal(notices.length, 1);
  }
});
