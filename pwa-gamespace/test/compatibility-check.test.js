import test from "node:test";
import assert from "node:assert/strict";
import { createCompatibilityCheck } from "../src/compatibility-check.js";
import { createCompatibilityReport } from "../src/compatibility-report.js";
import { readCompatibilityEnvironment, readCompatibilityStorage, realPwaLaunchMode } from "../src/compatibility-environment.js";

const site = { activeRevision: "demo", installedAt: 100, files: 45 };
function setup() {
  const entries = new Map();
  const storage = { getItem: key => entries.get(key), setItem: (key, value) => entries.set(key, value) };
  let now = 1000;
  const make = (version = "0.4.0", environment = "Browser 100") => {
    const check = createCompatibilityCheck({ version, storage: () => storage, now: () => now });
    check.bindEnvironment(environment);
    return check;
  };
  return { make, storage, advance: value => { now += value; } };
}
const report = check => createCompatibilityReport({ ...check.snapshot().data, formedAtMs: 10000, utcOffsetMinutes: 0, launchMode: "installed" });

test("existing content is not an observed import; full import and storefront transition are required", async () => {
  const { make, advance } = setup();
  const check = make();
  check.reconcileContent(site);
  check.pageLoaded(true, site);
  assert.equal(check.snapshot().data.steps.import, "not_performed");
  const token = check.beginImport({ source: "demo", bytes: 1859372, format: "7z" });
  advance(8000);
  check.finishImport(token, site);
  check.pageLoaded(false, site);
  assert.equal(check.snapshot().data.steps.game, "not_performed");
  check.pageLoaded(true, site);
  check.pageLoaded(false, site);
  assert.equal(check.snapshot().data.importDurationMs, 8000);
  assert.match(await report(check), /ИТОГ: базовая проверка пройдена/);
  assert.equal(make().snapshot().data.steps.game, "recorded");
  assert.equal(make("0.4.1").snapshot().data.steps.game, "not_performed");
});

test("stale attempts cannot overwrite a new attempt or turn a failed import into success", async () => {
  const { make } = setup();
  const check = make();
  const old = check.beginImport({ source: "demo" });
  const current = check.beginImport({ source: "user" });
  check.fail("import", "demo", { token: old });
  check.finishImport(old, site);
  assert.equal(check.snapshot().pending, true);
  check.fail("import", "archive", { token: current });
  check.finishImport(current, site);
  assert.equal(check.snapshot().data.steps.import, "error");
  assert.match(await report(check), /код: GS-ARCHIVE/);
});

test("page errors survive later load events and frozen report text remains unchanged", async () => {
  for (const [category, code] of [["demo", "GS-DEMO"], ["page", "GS-PAGE"], ["script", "GS-SCRIPT"], ["resource", "GS-RESOURCE"], ["timeout", "GS-LOAD-TIMEOUT"]]) {
    const { make } = setup();
    const check = make();
    const token = check.beginImport({ source: "demo" });
    if (category !== "demo") { check.finishImport(token, site); check.pageLoaded(true, site); }
    const frozen = await report(check);
    check.fail(category === "demo" ? "import" : "game", category);
    check.pageLoaded(false, site);
    assert.match(await report(check), new RegExp(`код: ${code};`));
    assert.match(await report(check), /ИТОГ: базовая проверка завершилась ошибкой/);
    assert.doesNotMatch(frozen, /ОШИБКА:/);
    assert.equal(make().snapshot().data.error, category);
  }
});

test("errors may be reported even when an earlier import was not observed", async () => {
  const check = setup().make();
  check.fail("storefront", "page");
  assert.match(await report(check), /импорт: не выполнено; загрузка витрины: ошибка/);
});

test("changed content, environment and incremental updates require a fresh full check", () => {
  for (const operation of [check => check.reconcileContent({ ...site, installedAt: 200 }), check => check.bindEnvironment("other")]) {
    const check = setup().make();
    check.finishImport(check.beginImport({ source: "demo" }), site);
    operation(check);
    assert.equal(check.snapshot().data.steps.import, "not_performed");
  }
  const check = setup().make();
  check.finishImport(check.beginImport({ source: "user" }), site, true);
  assert.equal(check.snapshot().data.steps.import, "not_performed");
});

test("pending restart stays unconfirmed; unavailable storage retains current observations", async () => {
  const { make, storage } = setup();
  const check = make();
  const token = check.beginImport({ source: "demo" });
  assert.equal(make().snapshot().data.steps.import, "not_checked");
  storage.setItem = () => { throw new Error("unavailable"); };
  check.finishImport(token, site);
  assert.equal(check.snapshot().data.steps.import, "success");
  assert.match(check.snapshot().warning, /не удалось сохранить/);
  check.fail("storefront", "page");
  assert.match(await report(check), /код: GS-PAGE/);
});

test("environment uses observed details; reduced Android UA is not trusted", async () => {
  const reduced = { userAgent: "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36" };
  const unknown = await readCompatibilityEnvironment(reduced);
  assert.equal(unknown.baseOs, "Android");
  assert.equal(unknown.baseOsVersion, null);
  assert.equal(unknown.model, null);
  const observed = await readCompatibilityEnvironment({ ...reduced, userAgentData: { platform: "Android", getHighEntropyValues: async () => ({ platform: "Android", platformVersion: "15.0.0", model: "Test Phone" }) } });
  assert.equal(observed.baseOsVersion, "15.0.0");
  assert.equal(observed.model, "Test Phone");
  assert.equal(observed.systemName, null);
  assert.equal(realPwaLaunchMode({}, () => ({ matches: false })), "browser");
  assert.equal(realPwaLaunchMode({ standalone: true }), "installed");
  assert.equal(await readCompatibilityStorage({ storage: { persisted: async () => false } }), "ordinary");
  assert.equal(await readCompatibilityStorage({}), null);
});
