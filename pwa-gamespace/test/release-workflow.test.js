import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, realpathSync, existsSync, copyFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const workflow = readFileSync(new URL("../../.github/workflows/publish-pwa-pages.yml", import.meta.url), "utf8").replaceAll("\r\n", "\n");
const fixtureSource = fileURLToPath(new URL("../test-support/release-workflow-fixture.mjs", import.meta.url));
const bash = process.platform === "win32" ? path.join(process.env.ProgramFiles || "C:/Program Files", "Git/bin/bash.exe") : "bash";
const shellAvailable = spawnSync(bash, ["--version"], { windowsHide: true }).status === 0;
const shellOptions = { skip: shellAvailable ? false : "Bash is required to execute release workflow scenarios" };

function step(name) {
  const start = workflow.indexOf(`      - name: ${name}\n`);
  assert.notEqual(start, -1, `Missing workflow step: ${name}`);
  const remaining = workflow.slice(start);
  const end = remaining.indexOf("\n      - name:");
  const block = end < 0 ? remaining : remaining.slice(0, end);
  const match = /        run: \|\n((?:          [^\n]*\n|\n)+)/.exec(block);
  assert.ok(match, `Missing script: ${name}`);
  return match[1].replace(/^          /gm, "");
}

function fixture(t, options = {}) {
  const directory = realpathSync(mkdtempSync(path.join(os.tmpdir(), "gs-release-test-")));
  const parent = realpathSync(os.tmpdir());
  t.after(() => {
    assert.equal(path.dirname(realpathSync(directory)), parent);
    assert.ok(path.basename(directory).startsWith("gs-release-test-"));
    rmSync(directory, { recursive: true, force: true });
  });
  const assets = ["gamespace-pwa-0.4.0.tar.gz", "GameSpace-0.4.0.apk", "GameSpace-latest.apk"];
  const prepared = { [assets[0]]: "verified PWA", [assets[1]]: "verified APK", [assets[2]]: "verified APK" };
  const statePath = path.join(directory, "state.json");
  const state = {
    tags: ["v0.4", "v0.3.13", "v0.3.12"],
    releases: { "v0.4": {}, "v0.3.13": {}, "v0.3.12": { "gamespace-pwa-0.3.12.tar.gz": "old PWA" } },
    calls: [], ...options,
  };
  writeFileSync(statePath, JSON.stringify(state));
  mkdirSync(path.join(directory, "release-assets"));
  for (const [name, value] of Object.entries(prepared)) writeFileSync(path.join(directory, "release-assets", name), value);
  const runner = path.join(directory, "runner"); mkdirSync(runner);
  const slash = value => value.replaceAll("\\", "/");
  function run(name) {
    const prelude = `
      gh() { command node "$FIXTURE_SCRIPT" gh "$@"; }
      jq() { command node "$FIXTURE_SCRIPT" jq "$@"; }
      tar() { command node "$FIXTURE_SCRIPT" tar "$@"; }
      node() { command node "$FIXTURE_SCRIPT" node "$@"; }
    `;
    return spawnSync(bash, ["--noprofile", "--norc", "-c", prelude + step(name)], {
      cwd: directory, encoding: "utf8", windowsHide: true, timeout: 30_000,
      // Relative to the isolated fixture cwd: Git Bash need not traverse Windows drive parents.
      env: { ...process.env, GH_TOKEN: "fixture-only", GH_REPO: "fixture/repository", RELEASE_TAG: "v0.4", RELEASE_VERSION: "0.4.0", RUNNER_TEMP: "runner", FIXTURE_SCRIPT: slash(fixtureSource), FIXTURE_STATE: statePath, MSYS_NO_PATHCONV: "1" },
    });
  }
  return { run, directory, assets, prepared, state: () => JSON.parse(readFileSync(statePath)), writeState: next => writeFileSync(statePath, JSON.stringify(next)) };
}

const validate = "Require a published stable release";
const prepare = "Restore published immutable PWA releases and prepare the current package";
const publish = "Attach and verify files only after both builds pass";

test("release publication starts both verified builds and gates assets and Pages on success", () => {
  assert.match(workflow, /on:\n  release:\n    types: \[published\]/);
  assert.match(workflow, /env:\n  GH_REPO: \$\{\{ github.repository \}\}/);
  assert.match(workflow, /RELEASE_TAG: \$\{\{ github.event.release.tag_name \|\| inputs.tag \}\}/);
  assert.match(workflow, /publish:\n[^]*?needs: \[validate, pwa, apk\]/);
  assert.match(workflow, /pages:\n[^]*?needs: \[validate, pwa, apk, publish\]/);
  assert.match(workflow, /deploy:\n[^]*?needs: pages/);
  assert.match(workflow, /run: npm test/);
  assert.match(workflow, /run: npm run test:e2e/);
  assert.match(workflow, /test-diagnostics.ps1/);
  assert.match(workflow, /-RequireExistingKeystore/);
  assert.doesNotMatch(workflow, /--clobber|gh release edit|--draft=false/);
});

test("only the final job uploads Pages, using the highest verified version and workflow tooling", () => {
  const pages = workflow.slice(workflow.indexOf("\n  pages:"), workflow.indexOf("\n  deploy:"));
  const pwa = workflow.slice(workflow.indexOf("\n  pwa:"), workflow.indexOf("\n  apk:"));
  assert.doesNotMatch(pwa, /upload-pages-artifact|pages:assemble/);
  assert.match(pwa, /name: pwa-release-packages/);
  assert.match(pwa, /include-hidden-files: true/);
  assert.match(pages, /ref: \$\{\{ github.workflow_sha \}\}/);
  assert.match(pages, /APK_SIGNER_SHA256: \$\{\{ needs.apk.outputs.signer_sha256 \}\}/);
  assert.match(pages, /PAGES_VERSION: \$\{\{ steps.apk_catalog.outputs.latest_version \}\}/);
  assert.match(pages, /assemble-pages.mjs "\$PAGES_VERSION"/);
  assert.match(pages, /assemble-pages.mjs "\$PAGES_VERSION" --apk-catalog "\$RUNNER_TEMP\/apk-catalog-output\/updates.json"/);
  assert.ok(pages.indexOf("restore-update-catalog.mjs") < pages.indexOf("assemble-pages.mjs"));
  assert.ok(pages.indexOf("assemble-pages.mjs") < pages.indexOf("upload-pages-artifact"));
  assert.equal((workflow.match(/uses: actions\/upload-pages-artifact/g) || []).length, 1);
});

test("CI verifies the APK catalog with a test APK and never uses release signing secrets", () => {
  const ci = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
  assert.match(ci, /-AllowTestSigning/);
  assert.match(ci, /GAMESPACE_CATALOG_TEST_APK/);
  assert.match(ci, /restore-update-catalog.test.mjs/);
  assert.doesNotMatch(ci, /secrets\.|contents: write|pages: write|gh release upload/);
});

test("release validation accepts publication and rejects draft, prerelease and API failure", shellOptions, async t => {
  for (const [name, options, success] of [["published", {}, true], ["draft", { draft: true }, false], ["prerelease", { prerelease: true }, false], ["API failure", { failView: true }, false]]) {
    await t.test(name, t => {
      const f = fixture(t, options); const result = f.run(validate);
      assert.equal(result.status === 0, success, result.stderr);
    });
  }
});

test("first publication builds the missing PWA and skips releases without packages", shellOptions, t => {
  const f = fixture(t); const result = f.run(prepare);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(existsSync(path.join(f.directory, f.assets[0])));
  assert.ok(existsSync(path.join(f.directory, "release-packages/0.3.12/release.json")));
  assert.equal(existsSync(path.join(f.directory, "release-packages/0.3.13")), false);
  assert.equal(f.state().calls.filter(call => call[1] === "scripts/prepare-release.mjs").length, 1);
});

test("PWA retry reuses exact published archive bytes and verifies the tagged source", shellOptions, t => {
  const f = fixture(t, { releases: { "v0.4": { "gamespace-pwa-0.4.0.tar.gz": "immutable original PWA" } }, tags: ["v0.4"] });
  const result = f.run(prepare);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(path.join(f.directory, f.assets[0]), "utf8"), "immutable original PWA");
  assert.equal(f.state().calls.some(call => call[1] === "scripts/prepare-release.mjs"), false);
  assert.ok(f.state().calls.some(call => call[1] === "scripts/verify-release-source.mjs"));
});

test("source mismatch stops PWA release preparation", shellOptions, t => {
  const f = fixture(t, { failSourceVerification: true });
  const result = f.run(prepare);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Tagged source does not match/);
  assert.equal(existsSync(path.join(f.directory, f.assets[0])), false);
});

test("release catalog failure cannot silently publish Pages without previous versions", shellOptions, t => {
  const f = fixture(t, { failList: true });
  const result = f.run(prepare);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Cannot read release catalog/);
  assert.equal(f.state().calls.some(call => call[1] === "scripts/prepare-release.mjs"), false);
});

test("published assets are uploaded once and verified by downloading all three files", shellOptions, t => {
  const f = fixture(t); const result = f.run(publish);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(f.state().releases["v0.4"], f.prepared);
  assert.equal(f.state().calls.filter(call => call[0] === "gh" && call[2] === "download").length, 3);
});

test("an upload interrupted after one file can resume without replacing that file", shellOptions, t => {
  const f = fixture(t, { failUploadAfter: 1 });
  assert.notEqual(f.run(publish).status, 0);
  const interrupted = f.state();
  assert.equal(Object.keys(interrupted.releases["v0.4"]).length, 1);
  interrupted.failUploadAfter = null; f.writeState(interrupted);
  const retry = f.run(publish);
  assert.equal(retry.status, 0, retry.stderr);
  assert.deepEqual(f.state().releases["v0.4"], f.prepared);
  const uploads = f.state().calls.filter(call => call[0] === "gh" && call[2] === "upload");
  assert.equal(uploads[1].length, 6, "retry uploads only the two missing files");
});

test("existing conflicting asset stops publication before any new upload", shellOptions, t => {
  const f = fixture(t, { releases: { "v0.4": { "GameSpace-0.4.0.apk": "different published APK" } } });
  assert.notEqual(f.run(publish).status, 0);
  assert.equal(f.state().calls.some(call => call[2] === "upload"), false);
});

test("corrupt downloaded upload fails verification before Pages deployment", shellOptions, t => {
  const f = fixture(t, { corruptVerificationDownload: true });
  assert.notEqual(f.run(publish).status, 0);
  assert.deepEqual(f.state().releases["v0.4"], f.prepared);
});

function pagesFixture(t, versions = ["0.3.9", "0.3.14"]) {
  const f = fixture(t);
  const root = path.join(f.directory, "pwa-gamespace");
  mkdirSync(path.join(root, "scripts"), { recursive: true });
  for (const name of ["assemble-pages.mjs", "release-utils.mjs", "verify-runtime.mjs", "verify-releases.mjs", "verify-pages-size.mjs"]) {
    copyFileSync(new URL(`../scripts/${name}`, import.meta.url), path.join(root, "scripts", name));
  }
  const runtime = "// immutable fixture runtime\r\n";
  const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
  mkdirSync(path.join(root, "public"));
  writeFileSync(path.join(root, "public/sw-runtime-v1.js"), runtime);
  writeFileSync(path.join(root, "runtime-lock.json"), JSON.stringify({
    files: { "public/sw-runtime-v1.js": digest(runtime) }, releaseFiles: { "sw-runtime-v1.js": digest(runtime) },
  }));
  for (const version of versions) {
    const release = path.join(root, "release-packages", version);
    mkdirSync(release, { recursive: true });
    const contents = { "index.html": `<!doctype html><title>${version}</title>`, "sw-runtime-v1.js": runtime };
    const files = Object.entries(contents).map(([name, text]) => {
      writeFileSync(path.join(release, name), text);
      return { path: name, size: Buffer.byteLength(text), sha256: digest(text) };
    });
    writeFileSync(path.join(release, "release.json"), JSON.stringify({
      schema: 1, product: "gamespace-pwa", version, runtime: "sw-runtime-v1.js",
      date: "2026-09-11", description: "Fixture release", files,
      totalSize: files.reduce((sum, file) => sum + file.size, 0),
    }));
  }
  const catalog = '{"fixture":"verified APK catalog"}\r\n';
  mkdirSync(path.join(f.directory, "runner/apk-catalog-output"));
  writeFileSync(path.join(f.directory, "runner/apk-catalog-output/updates.json"), catalog);
  function run() {
    // Execute the real assembly scripts with miniature, independently hashed releases.
    const env = { ...process.env, RUNNER_TEMP: "runner", PAGES_VERSION: "0.3.14" };
    delete env.GAMESPACE_RELEASES_DIRECTORY;
    delete env.GAMESPACE_PAGES_OUTPUT_DIRECTORY;
    return spawnSync(bash, ["--noprofile", "--norc", "-c", step("Assemble Pages with the latest verified APK and PWA release")], {
      cwd: f.directory, encoding: "utf8", windowsHide: true, timeout: 30000, env,
    });
  }
  return { root, run, catalog };
}

test("final Pages assembly preserves old PWA bytes and keeps the APK catalog outside immutable packages", shellOptions, t => {
  const f = pagesFixture(t);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  const output = path.join(f.root, "pages-output/0.3.14");
  assert.match(readFileSync(path.join(output, "index.html"), "utf8"), /0\.3\.14/);
  assert.match(readFileSync(path.join(output, "releases/0.3.9/index.html"), "utf8"), /0\.3\.9/);
  assert.equal(JSON.parse(readFileSync(path.join(output, "latest.json"), "utf8")).version, "0.3.14");
  assert.equal(readFileSync(path.join(output, "apk/updates.json"), "utf8"), f.catalog);
  for (const version of ["0.3.9", "0.3.14"]) {
    assert.equal(existsSync(path.join(output, "releases", version, "apk")), false);
    assert.deepEqual(readFileSync(path.join(output, "releases", version, "sw-runtime-v1.js")), readFileSync(path.join(f.root, "release-packages", version, "sw-runtime-v1.js")));
  }
});

test("a corrupted PWA package stops final assembly before any Pages artifact is prepared", shellOptions, t => {
  const f = pagesFixture(t);
  writeFileSync(path.join(f.root, "release-packages/0.3.9/index.html"), "corrupted");
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.equal(existsSync(path.join(f.root, "pages-output")), false);
});

test("PWA history restoration downloads only ten newest packages plus an old current tag", shellOptions, t => {
  const tags = ["v0.4", ...Array.from({ length: 15 }, (_, i) => `v0.5.${i + 1}`)];
  const releases = Object.fromEntries(tags.map(tag => [tag, {
    [`gamespace-pwa-${tag === "v0.4" ? "0.4.0" : tag.slice(1)}.tar.gz`]: `immutable ${tag}`,
  }]));
  const f = fixture(t, { tags: tags.slice(1), releases });
  const result = f.run(prepare);
  assert.equal(result.status, 0, result.stderr);
  const downloaded = f.state().calls.filter(call => call[0] === "gh" && call[2] === "download").map(call => call[3]);
  assert.deepEqual(downloaded, [...Array.from({ length: 10 }, (_, i) => `v0.5.${15 - i}`), "v0.4"]);
  assert.equal(readFileSync(path.join(f.directory, f.assets[0]), "utf8"), "immutable v0.4");
  assert.deepEqual(f.state().releases, releases, "history in GitHub Releases is never deleted");
});

test("Pages keeps ten numerically newest packages without changing source archives", shellOptions, t => {
  const versions = Array.from({ length: 14 }, (_, i) => `0.3.${i + 1}`);
  const f = pagesFixture(t, versions);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  const output = path.join(f.root, "pages-output/0.3.14");
  const catalog = JSON.parse(readFileSync(path.join(output, "versions.json"), "utf8"));
  assert.deepEqual(catalog.versions.map(r => r.version), versions.slice(-10).reverse());
  for (const version of versions) {
    const source = path.join(f.root, "release-packages", version, "index.html");
    assert.ok(existsSync(source));
    const published = path.join(output, "releases", version, "index.html");
    if (Number(version.split(".")[2]) <= 4) assert.equal(existsSync(published), false);
    else assert.deepEqual(readFileSync(published), readFileSync(source));
  }
  assert.match(result.stdout, /Размер Pages:/);
});
