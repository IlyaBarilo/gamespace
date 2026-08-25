import { access, copyFile, mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  copyDirectoryContents,
  distDirectory,
  listFiles,
  projectDirectory,
  readJson,
  releasesDirectory,
  sha256File,
  validateVersion,
  workspaceDirectory,
} from "./release-utils.mjs";

const packageInfo = await readJson(path.join(projectDirectory, "package.json"));
const releaseInfo = await readJson(path.join(projectDirectory, "release-info.json"));
const version = validateVersion(process.argv[2] || packageInfo.version);
const releaseDescription = process.env.GAMESPACE_RELEASE_DESCRIPTION?.trim() || releaseInfo.description;
if (version !== packageInfo.version || version !== releaseInfo.version) {
  throw new Error(`Версии не совпадают: команда=${version}, package=${packageInfo.version}, release-info=${releaseInfo.version}.`);
}
if (releaseInfo.runtime !== "sw-runtime-v1.js") {
  throw new Error("Для нового runtime требуется отдельная процедура выпуска.");
}

await access(path.join(distDirectory, "index.html"));
const target = path.join(releasesDirectory, version);
await mkdir(releasesDirectory, { recursive: true });
if (await access(target).then(() => true).catch(() => false)) {
  throw new Error(`Выпуск ${version} уже существует и не может быть перезаписан.`);
}

await copyDirectoryContents(distDirectory, target);
await copyFile(path.join(workspaceDirectory, "LICENSE"), path.join(target, "LICENSE.txt"));
await copyFile(path.join(workspaceDirectory, "BRAND_ASSETS_LICENSE.md"), path.join(target, "BRAND_ASSETS_LICENSE.md"));
await copyFile(path.join(workspaceDirectory, "THIRD_PARTY_NOTICES.md"), path.join(target, "THIRD_PARTY_NOTICES.md"));
await copyDirectoryContents(path.join(workspaceDirectory, "third_party"), path.join(target, "third_party"));

const paths = (await listFiles(target)).filter((file) => file !== "release.json");
const files = [];
let totalSize = 0;
for (const relative of paths) {
  const absolute = path.join(target, ...relative.split("/"));
  const info = await stat(absolute);
  const size = info.size;
  totalSize += size;
  files.push({
    path: relative,
    url: relative,
    size,
    sha256: await sha256File(absolute),
  });
}

const manifest = {
  schema: 1,
  product: "gamespace-pwa",
  version,
  runtime: releaseInfo.runtime,
  date: releaseInfo.date,
  description: releaseDescription,
  totalSize,
  files,
};
await writeFile(path.join(target, "release.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`Подготовлен неизменяемый выпуск ${version}: ${files.length} файлов, ${totalSize} байт.`);
