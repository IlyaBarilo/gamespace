import { constants } from "node:fs";
import { copyFile, lstat, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertInside,
  compareVersionsDescending,
  copyDirectoryContents,
  pagesOutputDirectory,
  readJson,
  releasesDirectory,
  validateVersion,
  verifyManifestDirectory,
} from "./release-utils.mjs";
import { MAX_PAGES_BYTES, measurePagesSize, verifyPagesSize } from "./verify-pages-size.mjs";

const MIN_RELEASES = 3;
const MAX_RELEASES = 10;
const json = value => (JSON.stringify(value, null, 2) + "\n").replaceAll("\n", "\r\n");

export async function assemblePages(latestVersion, {
  releasesRoot = releasesDirectory, outputRoot = pagesOutputDirectory,
  apkCatalog = null, limit = MAX_PAGES_BYTES, notice = console.log,
} = {}) {
  validateVersion(latestVersion);
  if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error("Некорректный предел размера Pages.");
  const latestRoot = path.join(releasesRoot, latestVersion);
  const pagesDirectory = path.join(outputRoot, latestVersion);
  const latestManifest = await readJson(path.join(latestRoot, "release.json"));
  if (latestManifest.version !== latestVersion) throw new Error("Версия release.json не совпадает с версией Pages.");
  const entries = await readdir(releasesRoot, { withFileTypes: true });
  const versions = entries.filter(item => item.isDirectory()).map(item => validateVersion(item.name))
    .sort(compareVersionsDescending).slice(0, MAX_RELEASES);
  if (!versions.includes(latestVersion)) throw new Error("Корневая версия Pages должна входить в десять последних выпусков PWA.");

  assertInside(outputRoot, pagesDirectory);
  try {
    await stat(pagesDirectory);
    throw new Error("Pages-артефакт " + latestVersion + " уже существует: " + pagesDirectory);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const candidates = [];
  for (const version of versions) {
    const manifest = await readJson(path.join(releasesRoot, version, "release.json"));
    if (manifest.version !== version) throw new Error("Версия манифеста не совпадает с каталогом " + version);
    candidates.push({
      version, runtime: manifest.runtime, manifest: "./releases/" + version + "/release.json",
      size: manifest.totalSize, date: manifest.date, description: manifest.description,
    });
  }
  let apkBytes = 0;
  if (apkCatalog !== null) {
    const info = await lstat(apkCatalog);
    if (!info.isFile() || info.size <= 0) throw new Error("Ожидался непустой файл каталога APK.");
    apkBytes = info.size;
  }
  const latestJson = json({ schema: 1, ...candidates.find(release => release.version === latestVersion) });
  const catalogJson = releases => json({ schema: 1, latest: latestVersion, versions: releases });
  // Count actual files, including release.json, licenses, the root duplicate and
  // APK metadata. Manifest totalSize alone omits the manifest itself.
  const fixedBytes = (await measurePagesSize(latestRoot)).bytes + apkBytes + Buffer.byteLength(latestJson);
  const mandatoryCount = Math.min(MIN_RELEASES, candidates.length);
  const releases = candidates.slice(0, mandatoryCount);
  let packageBytes = 0;
  for (const release of releases) packageBytes += (await measurePagesSize(path.join(releasesRoot, release.version))).bytes;
  let plannedBytes = fixedBytes + packageBytes + Buffer.byteLength(catalogJson(releases));
  if (plannedBytes > limit) {
    throw new Error("Обязательные последние " + mandatoryCount + " версии PWA вместе с корневой копией и метаданными занимают " + plannedBytes + " байт; предел " + limit + " байт. Публикация остановлена.");
  }
  for (const candidate of candidates.slice(mandatoryCount)) {
    const bytes = (await measurePagesSize(path.join(releasesRoot, candidate.version))).bytes;
    const nextBytes = fixedBytes + packageBytes + bytes + Buffer.byteLength(catalogJson([...releases, candidate]));
    if (nextBytes > limit) {
      notice("История Pages ограничена " + releases.length + " версиями: добавление " + candidate.version + " даст " + nextBytes + " байт при пределе " + limit + ". Более старые версии не добавляются.");
      break;
    }
    releases.push(candidate);
    packageBytes += bytes;
    plannedBytes = nextBytes;
  }
  if (!releases.some(release => release.version === latestVersion)) throw new Error("Корневая версия Pages не помещается в сохраняемую историю выпусков.");

  // Materialize only the selected contiguous history; source packages stay intact.
  await mkdir(outputRoot, { recursive: true });
  await mkdir(pagesDirectory);
  await copyDirectoryContents(latestRoot, pagesDirectory);
  for (const release of releases) {
    await copyDirectoryContents(path.join(releasesRoot, release.version), path.join(pagesDirectory, "releases", release.version));
  }
  await writeFile(path.join(pagesDirectory, "versions.json"), catalogJson(releases), { encoding: "utf8", flag: "wx" });
  await writeFile(path.join(pagesDirectory, "latest.json"), latestJson, { encoding: "utf8", flag: "wx" });
  await writeFile(path.join(pagesDirectory, ".nojekyll"), "", { encoding: "utf8", flag: "a" });
  if (apkCatalog !== null) {
    await mkdir(path.join(pagesDirectory, "apk"), { recursive: true });
    await copyFile(apkCatalog, path.join(pagesDirectory, "apk", "updates.json"), constants.COPYFILE_EXCL);
  }
  await verifyManifestDirectory(pagesDirectory, latestManifest);
  const measured = await verifyPagesSize(pagesDirectory, limit);
  if (measured.bytes !== plannedBytes) throw new Error("Размер Pages изменился при сборке: ожидалось " + plannedBytes + " байт, получено " + measured.bytes);
  notice("Собран GitHub Pages: последняя версия " + latestVersion + ", выпусков " + releases.length + ", размер " + measured.bytes + " из " + limit + " байт, каталог " + pagesDirectory);
  return { directory: pagesDirectory, versions: releases.map(release => release.version), bytes: measured.bytes };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [version, flag, catalog, ...extra] = process.argv.slice(2);
    if (extra.length || (flag !== undefined && (flag !== "--apk-catalog" || !catalog))) {
      throw new Error("Укажите версию Pages и при необходимости --apk-catalog <updates.json>.");
    }
    await assemblePages(version, { apkCatalog: catalog ?? null });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
