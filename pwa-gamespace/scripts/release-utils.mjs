import { createHash } from "node:crypto";
import { constants, copyFile, mkdir, readdir, readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url));
export const projectDirectory = path.resolve(scriptsDirectory, "..");
export const workspaceDirectory = path.resolve(projectDirectory, "..");
export const distDirectory = path.join(projectDirectory, "dist");
export const releasesDirectory = process.env.GAMESPACE_RELEASES_DIRECTORY
  ? path.resolve(process.env.GAMESPACE_RELEASES_DIRECTORY)
  : path.join(projectDirectory, "release-packages");
export const pagesOutputDirectory = process.env.GAMESPACE_PAGES_OUTPUT_DIRECTORY
  ? path.resolve(process.env.GAMESPACE_PAGES_OUTPUT_DIRECTORY)
  : path.join(projectDirectory, "pages-output");

export const requiredReleaseLicenseFiles = Object.freeze([
  "LICENSE.txt",
  "BRAND_ASSETS_LICENSE.md",
  "DEMO_CONTENT_LICENSE.md",
  "THIRD_PARTY_NOTICES.md",
]);

export const requiredReleaseThirdPartyLicenseFiles = Object.freeze([
  "7ZIP-UN7Z-LICENSE.txt",
  "APACHE-2.0.txt",
  "COMMONS-CODEC-NOTICE.txt",
  "COMMONS-COMPRESS-NOTICE.txt",
  "COMMONS-IO-NOTICE.txt",
  "COMMONS-LANG3-NOTICE.txt",
  "EMSCRIPTEN-LICENSE.md",
  "LGPL-2.1.txt",
  "ROBOTO-OFL-1.1.txt",
  "XZ-FOR-JAVA-1.12.txt",
  "ZIP-JS-BSD-3-CLAUSE.txt",
]);

export const requiredReleaseThirdPartySourceFiles = Object.freeze([
  "third_party/sources/un7z-opfs-1.0.2/7zip-26.02-source.tar.gz",
  "third_party/sources/un7z-opfs-1.0.2/README.md",
  "third_party/sources/un7z-opfs-1.0.2/un7z-opfs-1.0.2.tgz",
]);

export function verifyRequiredReleaseLicenseFiles(paths, label = "выпуск") {
  const available = new Set(paths);
  for (const required of requiredReleaseLicenseFiles) {
    if (!available.has(required)) {
      throw new Error(`В ${label} отсутствует обязательный лицензионный файл: ${required}.`);
    }
  }
  for (const name of requiredReleaseThirdPartyLicenseFiles) {
    const required = `third_party/licenses/${name}`;
    if (!available.has(required)) {
      throw new Error(`В ${label} отсутствует обязательный файл сторонней лицензии: ${required}.`);
    }
  }
  for (const required of requiredReleaseThirdPartySourceFiles) {
    if (!available.has(required)) {
      throw new Error(`В ${label} отсутствует обязательный архив исходного кода: ${required}.`);
    }
  }
}

export function normalizeVersion(version) {
  const match = /^(0|[1-9]\d*)(?:\.(0|[1-9]\d*))?(?:\.(0|[1-9]\d*))?$/.exec(version || "");
  if (!match) {
    throw new Error(`Некорректная версия: ${version || "<пусто>"}`);
  }
  return `${match[1]}.${match[2] || "0"}.${match[3] || "0"}`;
}

export function validateVersion(version) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version || "")) {
    throw new Error(`Некорректная версия: ${version || "<пусто>"}`);
  }
  return version;
}

export function formatReleaseTag(version) {
  const normalized = validateVersion(version);
  if (!/^\d+\.\d+\.\d+$/.test(normalized)) {
    throw new Error(`Тег выпуска не поддерживает суффикс версии: ${normalized}`);
  }
  const parts = normalized.split(".");
  if (parts[2] === "0") parts.pop();
  if (parts[1] === "0") parts.pop();
  return `v${parts.join(".")}`;
}

export function parseReleaseTag(tag) {
  if (typeof tag !== "string" || !tag.startsWith("v")) {
    throw new Error(`Некорректный тег выпуска: ${tag || "<пусто>"}`);
  }
  const version = normalizeVersion(tag.slice(1));
  const canonicalTag = formatReleaseTag(version);
  if (tag !== canonicalTag) {
    throw new Error(`Неканонический тег выпуска ${tag}. Используйте ${canonicalTag}.`);
  }
  return { tag, tagVersion: tag.slice(1), version };
}

export async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

export async function sha256File(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

export async function verifyManifestDirectory(root, manifest) {
  for (const file of manifest.files) {
    const absolute = path.join(root, ...file.path.split("/"));
    const info = await stat(absolute);
    if (info.size !== file.size) {
      throw new Error(`Файл ${file.path} изменён после подготовки выпуска: размер ${info.size}, ожидался ${file.size}.`);
    }
    const hash = await sha256File(absolute);
    if (hash !== file.sha256) {
      throw new Error(`Файл ${file.path} изменён после подготовки выпуска: SHA-256 не совпадает.`);
    }
  }
}

export async function listFiles(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(root, absolute));
    else if (entry.isFile()) files.push(path.relative(root, absolute).split(path.sep).join("/"));
  }
  return files.sort((a, b) => a.localeCompare(b, "en"));
}

export async function copyDirectoryContents(source, target) {
  await mkdir(target, { recursive: true });
  const entries = await readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      await copyDirectoryContents(sourcePath, targetPath);
    } else if (entry.isFile()) {
      await copyFile(sourcePath, targetPath, constants.COPYFILE_EXCL);
    } else {
      throw new Error(`Неподдерживаемый тип файла при копировании выпуска: ${sourcePath}`);
    }
  }
}

export function compareVersionsDescending(left, right) {
  const a = left.split(/[.-]/).slice(0, 3).map(Number);
  const b = right.split(/[.-]/).slice(0, 3).map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return b[index] - a[index];
  }
  return right.localeCompare(left, "en");
}

export function assertInside(parent, child) {
  const relative = path.relative(parent, child);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Небезопасный путь операции: ${child}`);
  }
}
