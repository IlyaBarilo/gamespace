import test from "node:test";
import assert from "node:assert/strict";
import { COMPATIBILITY_ARCHIVE_PREFIX, createCompatibilityCheck } from "../src/compatibility-check.js";

const key = id => `${COMPATIBILITY_ARCHIVE_PREFIX}id:${encodeURIComponent(id)}`;
const state = (id, revision = id) => ({ archiveId: id, activeRevision: "legacy-pin", archiveRevision: revision, installedAt: 100, files: 2 });
const a = state("work-a"), b = state("work-b"), demo = state("builtin-demo");
function setup() {
  const entries = new Map();
  const storage = { get length() { return entries.size; }, key: index => [...entries.keys()][index] ?? null,
    getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value), removeItem: key => entries.delete(key) };
  const make = (version = "0.4.0", environment = "Browser 100") => {
    const check = createCompatibilityCheck({ version, storage: () => storage, now: () => 1000 });
    check.bindEnvironment(environment);
    return check;
  };
  return { entries, storage, make };
}
function imported(check, site) {
  check.finishImport(check.beginImport({ source: site.archiveId === "builtin-demo" ? "demo" : "user", format: "ZIP", bytes: 123 }), site);
}
function passed(check, site) { imported(check, site); check.pageLoaded(true, site); check.pageLoaded(false, site); }

test("archive checks restore independent successes and errors, including demo and renamed entries", () => {
  const { make } = setup();
  const check = make();
  passed(check, a);
  imported(check, b); check.fail("game", "script");
  passed(check, demo);
  check.selectArchive({ ...a, archiveDisplayName: "New name" });
  assert.equal(check.snapshot().data.steps.game, "recorded");
  assert.equal(check.snapshot().data.error, undefined);
  check.selectArchive(b);
  assert.equal(check.snapshot().data.error, "script");
  check.selectArchive(demo);
  assert.equal(check.snapshot().data.archiveSource, "demo");
  const restart = make(); restart.selectArchive(b);
  assert.equal(restart.snapshot().data.error, "script");
});

test("failed and interrupted imports preserve installed checks until a successful commit", () => {
  for (const interrupted of [false, true]) {
    const { make } = setup();
    const check = make(); passed(check, a);
    const token = check.beginImport({ source: "user" });
    check.fail("import", "archive", { token, interrupted });
    check.reconcileContent(a);
    assert.equal(check.snapshot().archiveId, null);
    assert.equal(check.snapshot().attempt, true);
    assert.equal(check.snapshot().data.steps.import, interrupted ? "interrupted" : "error");
    assert.equal(make().snapshot().data.steps.import, interrupted ? "interrupted" : "error");
    check.selectArchive(a);
    assert.equal(check.snapshot().data.steps.game, "recorded");
  }
});

test("full replacement and incremental updates invalidate only the affected archive", () => {
  const check = setup().make(); passed(check, a); passed(check, b);
  const replacement = state(a.archiveId, "replaced");
  imported(check, replacement);
  assert.equal(check.snapshot().data.steps.game, "not_performed");
  check.selectArchive(b);
  assert.equal(check.snapshot().data.steps.game, "recorded");
  check.finishImport(check.beginImport({ source: "user" }), state(a.archiveId, "updated"), true);
  assert.equal(check.snapshot().archiveId, a.archiveId);
  assert.equal(check.snapshot().data.steps.import, "not_performed");
  check.selectArchive(b);
  assert.equal(check.snapshot().data.steps.game, "recorded");
});

test("reset and content loss do not discard observations in other archives", () => {
  const check = setup().make(); passed(check, a); passed(check, b);
  check.selectArchive(a); check.reset();
  check.selectArchive(b); assert.equal(check.snapshot().data.steps.game, "recorded");
  check.reconcileContent({ ...b, installedAt: 200 });
  assert.equal(check.snapshot().data.steps.import, "not_performed");
});

test("legacy results migrate only to their exact revision and never overwrite a scoped check", () => {
  const { make, entries } = setup();
  const old = make(); passed(old, a);
  const legacy = JSON.parse(entries.get("gamespace:compatibility-check:v1"));
  delete legacy.archiveId;
  entries.clear(); entries.set("gamespace:compatibility-check:v1", JSON.stringify(legacy));
  const check = make(); check.selectArchive(b);
  assert.equal(check.snapshot().data.steps.import, "not_performed");
  check.selectArchive(a);
  assert.equal(check.snapshot().data.steps.game, "recorded");
  check.reset();
  entries.set("gamespace:compatibility-check:v1", JSON.stringify(legacy));
  const restart = make(); restart.selectArchive(a);
  assert.equal(restart.snapshot().data.steps.import, "not_performed");
});

test("deletion and interrupted-delete cleanup remove only records absent from the archive catalog", () => {
  const { make, entries } = setup();
  const check = make(); passed(check, a); passed(check, b); passed(check, demo);
  check.forgetArchive(a.archiveId);
  assert.equal(entries.has(key(a.archiveId)), false);
  check.retainArchives([demo.archiveId]);
  assert.equal(entries.has(key(b.archiveId)), false);
  check.selectArchive(demo);
  assert.equal(check.snapshot().data.steps.game, "recorded");
  check.forgetArchive(demo.archiveId);
  check.selectArchive(demo);
  assert.equal(check.snapshot().data.steps.import, "not_performed");
});

test("unavailable persistence keeps separate in-memory results without mixing archives", () => {
  const { make, storage } = setup();
  const check = make(); passed(check, a);
  storage.setItem = () => { throw new Error("quota"); };
  imported(check, b); check.fail("storefront", "page");
  check.selectArchive(a);
  assert.equal(check.snapshot().data.steps.game, "recorded");
  check.selectArchive(b);
  assert.equal(check.snapshot().data.error, "page");
  assert.match(check.snapshot().warning, /не удалось сохранить/);
});

test("another window's current mirror and stale page events cannot replace this archive's result", () => {
  const { make } = setup();
  const first = make(); passed(first, a); passed(first, b); first.selectArchive(a);
  const second = make(); second.selectArchive(b); second.fail("game", "resource");
  assert.equal(first.snapshot().archiveId, a.archiveId);
  assert.equal(first.snapshot().data.steps.game, "recorded");
  second.pageLoaded(true, a); second.pageLoaded(false, a);
  assert.equal(second.snapshot().data.error, "resource");
  first.selectArchive(b);
  assert.equal(first.snapshot().data.error, "resource");
});

test("version or environment changes require fresh observations in every archive", () => {
  for (const [version, environment] of [["0.4.1", "Browser 100"], ["0.4.0", "Browser 101"]]) {
    const { make } = setup(); const check = make(); passed(check, a); passed(check, b);
    const changed = make(version, environment);
    for (const site of [a, b]) { changed.selectArchive(site); assert.equal(changed.snapshot().data.steps.import, "not_performed"); }
  }
});


test("migration survives a reload before archive selection; a newer demo check survives stale deletion", () => {
  const { make, entries } = setup();
  const old = make(); passed(old, a);
  const legacy = JSON.parse(entries.get("gamespace:compatibility-check:v1")); delete legacy.archiveId;
  entries.clear(); entries.set("gamespace:compatibility-check:v1", JSON.stringify(legacy));
  make();
  const restarted = make(); restarted.selectArchive(a);
  assert.equal(restarted.snapshot().data.steps.game, "recorded");
  const newerDemo = state(demo.archiveId, "newer-demo"); passed(restarted, newerDemo);
  restarted.forgetArchive(demo.archiveId, `${demo.archiveRevision}:${demo.installedAt}`);
  restarted.selectArchive(newerDemo);
  assert.equal(restarted.snapshot().data.steps.game, "recorded");
});

test("a completed attempt does not remain pending or alias an archive in the memory fallback", () => {
  const { make, storage } = setup();
  const check = make(); storage.setItem = () => { throw new Error("denied"); };
  passed(check, a);
  check.selectArchive(null);
  assert.equal(check.snapshot().data.steps.import, "not_performed");
  check.selectArchive(a);
  assert.equal(check.snapshot().data.steps.game, "recorded");
});


test("resetting a failed standalone attempt keeps it empty without resurfacing another archive's success", () => {
  const check = setup().make(); passed(check, a);
  const token = check.beginImport({ source: "user" }); check.fail("import", "archive", { token });
  check.reset(); check.reconcileContent(a);
  assert.equal(check.snapshot().data.steps.import, "not_performed");
  assert.equal(check.snapshot().archiveId, null);
  check.selectArchive(a);
  assert.equal(check.snapshot().data.steps.game, "recorded");
});


test("a write failure keeps untouched persisted archives readable in a newly opened window", () => {
  const { make, storage } = setup(); const writer = make();
  passed(writer, a); passed(writer, b); passed(writer, demo);
  const current = make(); current.selectArchive(a);
  storage.setItem = () => { throw new Error("quota"); };
  current.fail("game", "script");
  assert.equal(current.snapshot().data.error, "script");
  current.selectArchive(b);
  assert.equal(current.snapshot().data.steps.game, "recorded");
  assert.equal(current.snapshot().data.error, undefined);
  current.selectArchive(a);
  assert.equal(current.snapshot().data.error, "script");
});

test("one corrupt check cannot erase or invalidate the checks of other archives", () => {
  const { make, entries } = setup(); const writer = make();
  passed(writer, a); passed(writer, b); passed(writer, demo);
  entries.set(key(a.archiveId), "not JSON");
  entries.set("gamespace:compatibility-check:v1", "not JSON");
  const current = make(); current.selectArchive(a);
  assert.equal(current.snapshot().data.steps.import, "not_performed");
  current.selectArchive(b);
  assert.equal(current.snapshot().data.steps.game, "recorded");
});
