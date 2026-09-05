import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, realpathSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
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
      env: { ...process.env, GH_TOKEN: "fixture-only", GH_REPO: "fixture/repository", RELEASE_TAG: "v0.4", RELEASE_VERSION: "0.4.0", RUNNER_TEMP: slash(runner), FIXTURE_SCRIPT: slash(fixtureSource), FIXTURE_STATE: statePath, MSYS_NO_PATHCONV: "1" },
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
  assert.match(workflow, /deploy:\n[^]*?needs: \[publish, pwa\]/);
  assert.match(workflow, /run: npm test/);
  assert.match(workflow, /run: npm run test:e2e/);
  assert.match(workflow, /test-diagnostics.ps1/);
  assert.match(workflow, /-RequireExistingKeystore/);
  assert.doesNotMatch(workflow, /--clobber|gh release edit|--draft=false/);
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
