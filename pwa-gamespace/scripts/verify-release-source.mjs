import path from "node:path";
import {
  distDirectory,
  listFiles,
  projectDirectory,
  readJson,
  releasesDirectory,
  sha256File,
  validateVersion,
} from "./release-utils.mjs";

const packageInfo = await readJson(path.join(projectDirectory, "package.json"));
const version = validateVersion(process.argv[2] || packageInfo.version);
const releaseRoot = path.join(releasesDirectory, version);
const manifest = await readJson(path.join(releaseRoot, "release.json"));
const byPath = new Map(manifest.files.map((file) => [file.path, file]));
for (const relative of await listFiles(distDirectory)) {
  const record = byPath.get(relative);
  if (!record) throw new Error(`Файл сборки отсутствует в выпуске ${version}: ${relative}.`);
  const hash = await sha256File(path.join(distDirectory, ...relative.split("/")));
  if (hash !== record.sha256) throw new Error(`Исходная сборка не совпадает с выпуском: ${relative}.`);
}
console.log(`Сборка исходников совпадает с выпуском ${version}.`);
