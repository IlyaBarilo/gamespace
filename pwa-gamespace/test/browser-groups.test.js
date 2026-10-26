import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
test("every browser scenario belongs to exactly one isolated CI group", () => {
  const output = execFileSync(process.execPath, ["node_modules/@playwright/test/cli.js", "test", "--list", "--reporter=json"], {
    cwd: root, encoding: "utf8", windowsHide: true, timeout: 30_000, maxBuffer: 8 * 1024 * 1024,
  });
  const report = JSON.parse(output);
  assert.deepEqual(report.config.projects.map(project => project.name), ["interface", "runtime", "fps"]);
  const seen = new Set(), files = new Set(), counts = { interface: 0, runtime: 0, fps: 0 };
  function visit(suite, parents = []) {
    const titles = [...parents, suite.title];
    for (const spec of suite.specs || []) {
      const key = JSON.stringify([spec.file, spec.line, titles, spec.title]);
      assert.equal(seen.has(key), false, `Duplicate browser scenario: ${key}`);
      seen.add(key);
      files.add(path.basename(spec.file));
      assert.equal(spec.tests.length, 1);
      const expected = spec.file.endsWith("release-runtime.spec.js") ? "runtime"
        : /fps(?:-position)?\.spec\.js$/.test(spec.file) ? "fps" : "interface";
      assert.equal(spec.tests[0].projectName, expected);
      counts[expected]++;
    }
    for (const child of suite.suites || []) visit(child, titles);
  }
  for (const suite of report.suites) visit(suite);
  assert.deepEqual([...files].sort(), readdirSync(path.join(root, "e2e")).filter(file => file.endsWith(".spec.js")).sort());
  assert.ok(Object.values(counts).every(count => count > 0));
});

test("CI and release share all three browser jobs, with one worker and failure artifacts", () => {
  const reusable = readFileSync(new URL("../../.github/workflows/browser-tests.yml", import.meta.url), "utf8");
  for (const name of ["ci.yml", "publish-pwa-pages.yml"]) {
    const workflow = readFileSync(new URL(`../../.github/workflows/${name}`, import.meta.url), "utf8");
    assert.match(workflow, /uses: \.\/\.github\/workflows\/browser-tests.yml/);
  }
  assert.match(reusable, /group: \[interface, runtime, fps\]/);
  assert.match(reusable, /fail-fast: false/);
  assert.match(reusable, /--project="\$TEST_GROUP"/);
  assert.match(reusable, /if: failure\(\)/);
  assert.doesNotMatch(reusable, /secrets\.|contents: write|pages: write/);
  assert.match(readFileSync(path.join(root, "playwright.config.js"), "utf8"), /workers: 1/);
});
