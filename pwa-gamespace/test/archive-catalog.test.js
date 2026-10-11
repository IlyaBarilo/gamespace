import test from "node:test";
import assert from "node:assert/strict";
import { catalogContentState, createArchiveCatalog, detachCatalogArchive, storeArchiveInCatalog, summarizeArchiveCatalog, DEMO_ARCHIVE_ID, validateArchiveCatalog } from "../src/archive-catalog.js";
import { compatibilityContentKey } from "../src/compatibility-check.js";

const state = id => ({ archiveId: id, activeRevision: id, revisionPath: `gamespace/archives/${id}`, archiveName: "work.zip", installedAt: 123, files: 2, writtenBytes: 100 });

test("duplicate archive names have independent content and totals", () => {
  let catalog = createArchiveCatalog();
  catalog = storeArchiveInCatalog(catalog, state("one"));
  catalog = storeArchiveInCatalog(catalog, state("two"));
  assert.equal(catalog.entries.length, 3);
  assert.equal(catalog.entries[0].id, DEMO_ARCHIVE_ID);
  assert.notEqual(catalog.entries[1].state.revisionPath, catalog.entries[2].state.revisionPath);
  assert.deepEqual(summarizeArchiveCatalog(catalog), { bytes: 200, files: 4, installed: 2 });
  assert.equal(catalogContentState(catalog).archiveId, "two");
});

test("migration retains existing files and pins the legacy revision for the old shell", () => {
  const previous = { ...state("old"), archiveId: undefined, revisionPath: "gamespace/revisions/old" };
  let catalog = createArchiveCatalog(previous);
  assert.equal(catalog.entries[1].state.revisionPath, previous.revisionPath);
  catalog = storeArchiveInCatalog(catalog, state("new"));
  const projected = catalogContentState(catalog);
  assert.equal(projected.activeRevision, "old");
  assert.equal(projected.archiveRevision, "new");
  assert.equal(projected.revisionPath, "gamespace/archives/new");
  assert.notEqual(compatibilityContentKey(projected), compatibilityContentKey(previous));
  catalog = storeArchiveInCatalog(catalog, projected);
  assert.equal(catalog.entries[2].state.activeRevision, "new");
});

test("removing an inactive archive preserves the selection; demo remains available", () => {
  let catalog = storeArchiveInCatalog(createArchiveCatalog(), state("one"));
  catalog = storeArchiveInCatalog(catalog, state("two"));
  catalog = storeArchiveInCatalog(catalog, state(DEMO_ARCHIVE_ID));
  const withoutOne = detachCatalogArchive(catalog, "one");
  assert.equal(withoutOne.activeId, DEMO_ARCHIVE_ID);
  const withoutDemo = detachCatalogArchive(withoutOne, DEMO_ARCHIVE_ID);
  assert.equal(withoutDemo.entries[0].state, null);
  assert.equal(withoutDemo.activeId, "two");
  assert.equal(catalogContentState(detachCatalogArchive(withoutDemo, "two")), null);
});

test("replacing one archive preserves its display name and the other content", () => {
  let catalog = storeArchiveInCatalog(createArchiveCatalog(), state("one"), { name: "Версия 1" });
  catalog = storeArchiveInCatalog(catalog, state("two"));
  const other = catalog.entries[2];
  catalog = storeArchiveInCatalog(catalog, { ...state("one"), activeRevision: "updated", revisionPath: "gamespace/archives/updated", writtenBytes: 200 });
  assert.equal(catalog.entries[1].name, "Версия 1");
  assert.deepEqual(catalog.entries[2], other);
  assert.deepEqual(summarizeArchiveCatalog(catalog), { bytes: 300, files: 4, installed: 2 });
});


test("invalid or aliased catalog paths fail closed before cleanup can remove files", () => {
  let catalog = storeArchiveInCatalog(createArchiveCatalog(), state("one"));
  assert.equal(validateArchiveCatalog(catalog), catalog);
  assert.throws(() => validateArchiveCatalog({ ...catalog, schema: 2 }), /формат/);
  assert.throws(() => validateArchiveCatalog({ ...catalog, entries: [...catalog.entries, { ...catalog.entries[1], id: "aliased" }] }), /каталог/);
  catalog = storeArchiveInCatalog(catalog, { ...state("one"), revisionPath: "gamespace/archives/../other" });
  assert.throws(() => validateArchiveCatalog(catalog), /каталог/);
});
