import path from "node:path";
import { access, readdir } from "node:fs/promises";
import {
  projectDirectory,
  readJson,
  releasesDirectory,
  sha256File,
} from "./release-utils.mjs";

const lock = await readJson(path.join(projectDirectory, "runtime-lock.json"));
for (const [relative, expected] of Object.entries(lock.files || {})) {
  const actual = await sha256File(path.join(projectDirectory, ...relative.split("/")));
  if (actual !== expected) throw new Error(`Изменён неизменяемый runtime: ${relative}.`);
}

const versions = await readdir(releasesDirectory, { withFileTypes: true }).catch(() => []);
for (const entry of versions.filter((item) => item.isDirectory())) {
  const manifest = path.join(releasesDirectory, entry.name, "release.json");
  if (!await access(manifest).then(() => true).catch(() => false)) {
    console.warn(`Пропущен незавершённый локальный каталог выпуска ${entry.name}: release.json отсутствует.`);
    continue;
  }
  for (const [relative, expected] of Object.entries(lock.releaseFiles || {})) {
    const file = path.join(releasesDirectory, entry.name, ...relative.split("/"));
    const actual = await sha256File(file).catch(() => null);
    if (actual !== expected) throw new Error(`Runtime выпуска ${entry.name} отсутствует или изменён: ${relative}.`);
  }
}
console.log("Неизменяемый Service Worker соответствует runtime-lock.json.");
