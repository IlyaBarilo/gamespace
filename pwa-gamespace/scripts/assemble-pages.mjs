import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  assertInside,
  compareVersionsDescending,
  copyDirectoryContents,
  pagesOutputDirectory,
  readJson,
  releasesDirectory,
  validateVersion,
} from "./release-utils.mjs";

const latestVersion = validateVersion(process.argv[2]);
const latestRoot = path.join(releasesDirectory, latestVersion);
const pagesDirectory = path.join(pagesOutputDirectory, latestVersion);
const latestManifest = await readJson(path.join(latestRoot, "release.json"));
if (latestManifest.version !== latestVersion) throw new Error("Версия release.json не совпадает с версией Pages.");

assertInside(pagesOutputDirectory, pagesDirectory);
try {
  await stat(pagesDirectory);
  throw new Error(`Pages-артефакт ${latestVersion} уже существует: ${pagesDirectory}.`);
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
await mkdir(pagesOutputDirectory, { recursive: true });
await mkdir(pagesDirectory);
await copyDirectoryContents(latestRoot, pagesDirectory);

const entries = await readdir(releasesDirectory, { withFileTypes: true });
const releases = [];
for (const entry of entries.filter((item) => item.isDirectory())) {
  const version = validateVersion(entry.name);
  const manifest = await readJson(path.join(releasesDirectory, version, "release.json"));
  releases.push({
    version,
    runtime: manifest.runtime,
    manifest: `./releases/${version}/release.json`,
    size: manifest.totalSize,
    date: manifest.date,
    description: manifest.description,
  });
  const target = path.join(pagesDirectory, "releases", version);
  await mkdir(path.dirname(target), { recursive: true });
  await copyDirectoryContents(path.join(releasesDirectory, version), target);
}
releases.sort((left, right) => compareVersionsDescending(left.version, right.version));
if (!releases.some((release) => release.version === latestVersion)) throw new Error("Последний выпуск не найден в каталоге.");

await writeFile(path.join(pagesDirectory, "versions.json"), `${JSON.stringify({
  schema: 1,
  latest: latestVersion,
  versions: releases,
}, null, 2)}\n`, "utf8");
await writeFile(path.join(pagesDirectory, "latest.json"), `${JSON.stringify({
  schema: 1,
  ...releases.find((release) => release.version === latestVersion),
}, null, 2)}\n`, "utf8");
await writeFile(path.join(pagesDirectory, "version.json"), `${JSON.stringify({ version: latestVersion }, null, 2)}\n`, "utf8");
await writeFile(path.join(pagesDirectory, ".nojekyll"), "", "utf8");
console.log(`Собран GitHub Pages: последняя версия ${latestVersion}, выпусков ${releases.length}, каталог ${pagesDirectory}.`);
