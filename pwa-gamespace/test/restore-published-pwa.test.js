import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { restorePublishedPwa, validateTarListing } from "../scripts/restore-published-pwa.mjs";
import { requiredReleaseLicenseFiles, requiredReleaseThirdPartyLicenseFiles, requiredReleaseThirdPartySourceFiles } from "../scripts/release-utils.mjs";
import { APPLICATION_ID, REPOSITORY_URL, createReleaseEntry, mergeCatalog, parseReleaseTag } from "../../apk-gamespace/scripts/apk-update-catalog.mjs";

const execute = promisify(execFile);
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const runtime = await readFile(new URL("../public/sw-runtime-v1.js", import.meta.url));
const repository = "IlyaBarilo/gamespace";

async function fixture(t, change = () => {}) {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "gs-fast-deploy-")));
  const parent = await realpath(os.tmpdir());
  t.after(async () => {
    assert.equal(path.dirname(await realpath(directory)), parent);
    assert.ok(path.basename(directory).startsWith("gs-fast-deploy-"));
    await rm(directory, { recursive: true, force: true });
  });
  const releases = {}, archives = {}, calls = [];
  let catalog = null;
  for (const tag of ["v0.3.25", "v0.3.26"]) {
    const version = parseReleaseTag(tag);
    const source = path.join(directory, version.version);
    await mkdir(source);
    const contents = { "index.html": Buffer.from(`<!doctype html><title>${tag}</title>\r\n`), "sw-runtime-v1.js": runtime };
    for (const name of requiredReleaseLicenseFiles) contents[name] = Buffer.from(`License ${name}\r\n`);
    for (const name of requiredReleaseThirdPartyLicenseFiles) contents[`third_party/licenses/${name}`] = Buffer.from("License\r\n");
    for (const name of requiredReleaseThirdPartySourceFiles) contents[name] = Buffer.from("Source fixture\r\n");
    const manifest = { schema: 1, product: "gamespace-pwa", licenseBundle: 1, version: version.version,
      runtime: "sw-runtime-v1.js", date: "2026-10-26", description: "Published fixture" };
    change(contents, manifest, tag);
    manifest.files = Object.entries(contents).map(([name, bytes]) => ({ path: name, size: bytes.length, sha256: hash(bytes) }));
    manifest.totalSize = manifest.files.reduce((total, file) => total + file.size, 0);
    if (manifest.extraFile) { contents["extra.js"] = Buffer.from("unexpected"); delete manifest.extraFile; }
    for (const [name, bytes] of Object.entries(contents)) {
      await mkdir(path.dirname(path.join(source, name)), { recursive: true });
      await writeFile(path.join(source, name), bytes);
    }
    await writeFile(path.join(source, "release.json"), JSON.stringify(manifest));
    const name = `gamespace-pwa-${version.version}.tar.gz`;
    const archive = path.join(directory, name);
    await execute("tar", ["-czf", archive, "-C", source, "."], { windowsHide: true });
    archives[tag] = archive;
    const apk = Buffer.from(`APK ${tag}`);
    releases[tag] = { tag_name: tag, draft: false, prerelease: false, body: "Fixture",
      published_at: "2026-10-26T00:00:00Z", html_url: `${REPOSITORY_URL}/releases/tag/${tag}`,
      assets: [`GameSpace-${version.version}.apk`, "GameSpace-latest.apk", name].map(assetName => ({
        name: assetName, state: "uploaded", browser_download_url: `${REPOSITORY_URL}/releases/download/${tag}/${assetName}`,
        size: assetName === name ? 0 : apk.length, digest: `sha256:${hash(apk)}`,
      })) };
    const pwa = releases[tag].assets[2];
    pwa.size = (await stat(archive)).size;
    pwa.digest = `sha256:${hash(await readFile(archive))}`;
    const identity = { applicationId: APPLICATION_ID, ...version, minSdk: 23, signerSha256: "ab".repeat(32) };
    const entry = createReleaseEntry({ ...version, publishedAt: releases[tag].published_at, description: "Fixture",
      releaseUrl: releases[tag].html_url, asset: { name: releases[tag].assets[0].name,
        url: releases[tag].assets[0].browser_download_url, size: apk.length, digest: hash(apk) } }, identity,
    { size: apk.length, sha256: hash(apk) });
    catalog = mergeCatalog(entry, catalog);
  }
  const catalogPath = path.join(directory, "updates.json");
  await writeFile(catalogPath, JSON.stringify(catalog));
  const options = { repository, currentTag: "v0.3.25", catalog: catalogPath,
    packagesDirectory: path.join(directory, "packages"), workDirectory: path.join(directory, "work") };
  const state = {};
  async function run(command, args) {
    calls.push([command, ...args]);
    if (command === "gh") {
      if (args[0] === "api") return JSON.stringify(releases[args[1].split("/").at(-1)]);
      assert.deepEqual(args.slice(0, 2), ["release", "download"]);
      const to = path.join(args[args.indexOf("--dir") + 1], args[args.indexOf("--pattern") + 1]);
      await copyFile(archives[args[2]], to);
      if (state.corruptDownload) await writeFile(to, Buffer.from("corrupt"));
      return "";
    }
    assert.equal(command, "tar");
    return (await execute(command, args, { encoding: "utf8", windowsHide: true })).stdout;
  }
  return { directory, options, releases, archives, calls, state, restore: () => restorePublishedPwa(options, { run, notice() {} }) };
}

test("fast deployment restores immutable packages, keeps newer releases and never builds or uploads", async t => {
  const f = await fixture(t);
  const before = hash(await readFile(f.archives["v0.3.26"]));
  assert.equal(await f.restore(), "0.3.26");
  for (const version of ["0.3.25", "0.3.26"]) {
    assert.deepEqual(await readFile(path.join(f.options.packagesDirectory, version, "sw-runtime-v1.js")), runtime);
    assert.equal(JSON.parse(await readFile(path.join(f.options.packagesDirectory, version, "release.json"))).version, version);
  }
  assert.equal(hash(await readFile(f.archives["v0.3.26"])), before);
  assert.ok(f.calls.every(([command, action, subcommand]) => command === "tar" || action === "api" || (action === "release" && subcommand === "download")));
});

test("archive corruption fails before extraction", async t => {
  const f = await fixture(t); f.state.corruptDownload = true;
  await assert.rejects(f.restore(), /SHA-256/);
  assert.equal(f.calls.some(call => call[0] === "tar"), false);
});

test("missing digests and changed APK metadata cannot be silently reused", async t => {
  for (const change of [release => { release.assets[2].digest = null; }, release => { release.assets[0].size++; }, release => { release.draft = true; }]) {
    const f = await fixture(t); change(f.releases["v0.3.26"]);
    await assert.rejects(f.restore(), /контрольной суммы|изменился|стабильный/);
    assert.equal(f.calls.some(call => call[0] === "tar" && call[1] === "-xzf"), false);
  }
});

test("valid GitHub archive digests do not excuse a wrong version, changed runtime or extra payload", async t => {
  for (const change of [
    (_, manifest) => { manifest.version = "0.3.24"; },
    contents => { contents["sw-runtime-v1.js"] = Buffer.from("changed runtime"); },
    (_, manifest) => { manifest.extraFile = true; },
  ]) {
    const f = await fixture(t, change);
    await assert.rejects(f.restore(), /версии|runtime|Состав/);
  }
});

test("existing package directories are never overwritten", async t => {
  const f = await fixture(t);
  const target = path.join(f.options.packagesDirectory, "0.3.26");
  await mkdir(target, { recursive: true }); await writeFile(path.join(target, "keep.txt"), "KEEP");
  await assert.rejects(f.restore(), /EEXIST/);
  assert.equal(await readFile(path.join(target, "keep.txt"), "utf8"), "KEEP");
});

test("tar validation rejects traversal, links, special files and duplicate destinations", () => {
  assert.doesNotThrow(() => validateTarListing("./\n./assets/\n./assets/app.js\n", "drwx root\ndrwx assets\n-rw app.js\n"));
  for (const name of ["../outside", "/outside", "C:/outside", "assets/../../outside", "assets\\outside", "assets/a:stream"]) {
    assert.throws(() => validateTarListing(`${name}\n`, "-rw file\n"), /путь/);
  }
  for (const type of ["l", "h", "c", "p"]) assert.throws(() => validateTarListing("./link\n", `${type} file\n`), /ссылку/);
  assert.throws(() => validateTarListing("./a\na\n", "-rw a\n-rw a\n"), /Повтор/);
});

test("fast workflow verifies published files with a separate trusted certificate and preserves tag-only deployment", async () => {
  const workflow = (await readFile(new URL("../../.github/workflows/deploy-published-release.yml", import.meta.url), "utf8")).replaceAll("\r\n", "\n");
  assert.match(workflow, /group: gamespace-release/);
  assert.match(workflow, /GITHUB_REF_TYPE.*tag/);
  assert.match(workflow, /vars.APK_SIGNER_SHA256/);
  assert.match(workflow, /--expected-signer-sha256 "\$APK_SIGNER_SHA256"/);
  assert.match(workflow, /restore-published-pwa.mjs/);
  assert.match(workflow, /steps.catalog.outputs.latest_version/);
  assert.match(workflow, /deploy:\n[^]*?needs: prepare/);
  assert.doesNotMatch(workflow, /npm (?:ci|test|run build)|build-apk|gh release upload|--clobber|secrets\./);
  const prepare = workflow.slice(0, workflow.indexOf("\n  deploy:"));
  assert.doesNotMatch(prepare, /contents: write|pages: write|id-token: write/);
});

test("fast deployment fails early on a branch or absent certificate and accepts an older target from newer tooling", async () => {
  const workflow = (await readFile(new URL("../../.github/workflows/deploy-published-release.yml", import.meta.url), "utf8")).replaceAll("\r\n", "\n");
  const block = workflow.slice(workflow.indexOf("      - name: Validate deployment source and trusted certificate"));
  const script = /        run: \|\n((?:          [^\n]*\n|\n)+)/.exec(block)[1].replace(/^          /gm, "");
  const bash = process.platform === "win32" ? path.join(process.env.ProgramFiles || "C:/Program Files", "Git/bin/bash.exe") : "bash";
  const options = { cwd: fileURLToPath(new URL("../../", import.meta.url)), encoding: "utf8", windowsHide: true,
    env: { ...process.env, GH_REPO: repository, GITHUB_REF_TYPE: "tag", GITHUB_REF_NAME: "v0.3.27", RELEASE_TAG: "v0.3.26", APK_SIGNER_SHA256: "ab".repeat(32) } };
  await execute(bash, ["--noprofile", "--norc", "-c", script], options);
  for (const changes of [{ GITHUB_REF_TYPE: "branch" }, { APK_SIGNER_SHA256: "" }, { RELEASE_TAG: "v0.3.25.1" }]) {
    await assert.rejects(execute(bash, ["--noprofile", "--norc", "-c", script], { ...options, env: { ...options.env, ...changes } }));
  }
});
