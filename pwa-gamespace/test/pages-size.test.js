import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, realpath, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { MAX_PAGES_BYTES, verifyPagesSize } from "../scripts/verify-pages-size.mjs";

async function fixture(t) {
  const parent = await realpath(os.tmpdir());
  const directory = await mkdtemp(path.join(parent, "gs-pages-size-"));
  t.after(async () => {
    const resolved = await realpath(directory);
    assert.equal(path.dirname(resolved), parent);
    assert.ok(path.basename(resolved).startsWith("gs-pages-size-"));
    await rm(resolved, { recursive: true, force: true });
  });
  return directory;
}

test("size guard includes the root copy, retained releases and APK metadata at the exact boundary", async t => {
  const root = await fixture(t);
  const files = { "index.html": "12345", "releases/0.3.14/index.html": "12345", "apk/updates.json": "123", ".nojekyll": "" };
  for (const [name, bytes] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), bytes);
  }
  assert.equal(MAX_PAGES_BYTES, 900_000_000);
  assert.deepEqual(await verifyPagesSize(root, 13), { bytes: 13, files: 4, limit: 13 });
  await assert.rejects(verifyPagesSize(root, 12), /Публикация остановлена/);
});

test("missing, empty and non-directory Pages output cannot pass verification", async t => {
  const root = await fixture(t);
  await assert.rejects(verifyPagesSize(root), /пуст/);
  await assert.rejects(verifyPagesSize(path.join(root, "missing")), { code: "ENOENT" });
  await writeFile(path.join(root, "file"), "x");
  await assert.rejects(verifyPagesSize(path.join(root, "file")), /Ожидался каталог/);
  await assert.rejects(verifyPagesSize(root, 0), /Некорректный предел/);
});

test("size guard refuses links outside the Pages tree", async t => {
  const root = await fixture(t);
  const output = path.join(root, "pages"), external = path.join(root, "external");
  await mkdir(output); await mkdir(external);
  await writeFile(path.join(external, "file"), "outside");
  await symlink(external, path.join(output, "linked"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(verifyPagesSize(output), /Неподдерживаемый объект/);
});
