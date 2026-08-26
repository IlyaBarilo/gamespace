import { stat } from "node:fs/promises";
import path from "node:path";
import {
  listFiles,
  readJson,
  releasesDirectory,
  sha256File,
  validateVersion,
  verifyRequiredReleaseLicenseFiles,
} from "./release-utils.mjs";

const versions = await listFiles(releasesDirectory).catch(() => []);
const manifests = versions.filter((file) => file.endsWith("/release.json") && file.split("/").length === 2);
if (!manifests.length) throw new Error("Не найдено ни одного подготовленного выпуска PWA.");

for (const manifestPath of manifests) {
  const version = validateVersion(manifestPath.split("/")[0]);
  const root = path.join(releasesDirectory, version);
  const manifest = await readJson(path.join(root, "release.json"));
  if (manifest.schema !== 1 || manifest.product !== "gamespace-pwa" || manifest.version !== version) {
    throw new Error(`Некорректный release.json выпуска ${version}.`);
  }
  const expectedPaths = new Set(["release.json"]);
  let totalSize = 0;
  for (const file of manifest.files || []) {
    if (expectedPaths.has(file.path)) throw new Error(`Повтор файла ${file.path} в выпуске ${version}.`);
    expectedPaths.add(file.path);
    const absolute = path.join(root, ...file.path.split("/"));
    const info = await stat(absolute);
    const hash = await sha256File(absolute);
    if (info.size !== file.size || hash !== file.sha256) throw new Error(`Проверка ${version}/${file.path} не пройдена.`);
    totalSize += info.size;
  }
  const actualPaths = new Set(await listFiles(root));
  if (actualPaths.size !== expectedPaths.size || [...actualPaths].some((file) => !expectedPaths.has(file))) {
    throw new Error(`Состав каталога выпуска ${version} отличается от release.json.`);
  }
  verifyRequiredReleaseLicenseFiles(actualPaths, `выпуске ${version}`);
  if (totalSize !== manifest.totalSize) throw new Error(`Общий размер выпуска ${version} не совпадает.`);
  console.log(`Проверен выпуск ${version}: ${manifest.files.length} файлов.`);
}
