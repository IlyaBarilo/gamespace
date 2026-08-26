import { spawnSync } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parse7zSlt } from "../src/archive/archive-plan.js";

const scriptPath = fileURLToPath(import.meta.url);
const projectDirectory = path.resolve(path.dirname(scriptPath), "..");
const workspaceDirectory = path.resolve(projectDirectory, "..");
const requiredDemoLicenseFiles = Object.freeze([
  "DEMO_CONTENT_LICENSE.md",
  "THIRD_PARTY_LICENSES/ROBOTO-OFL-1.1.txt",
]);

export function verifyRequiredDemoLicenseFiles(paths, label = "демо") {
  const available = new Set(paths);
  for (const required of requiredDemoLicenseFiles) {
    if (!available.has(required)) {
      throw new Error(`В ${label} отсутствует обязательный лицензионный файл: ${required}.`);
    }
  }
}

function sevenZipCandidates() {
  const candidates = [];
  if (process.env.GAMESPACE_7Z) candidates.push(process.env.GAMESPACE_7Z);
  if (process.platform === "win32") {
    for (const root of [process.env.ProgramFiles, process.env["ProgramFiles(x86)"]]) {
      if (root) candidates.push(path.join(root, "7-Zip", "7z.exe"));
    }
  }
  candidates.push("7zz", "7z", "7za");
  return [...new Set(candidates.filter(Boolean))];
}

function findSevenZip() {
  for (const candidate of sevenZipCandidates()) {
    const probe = spawnSync(candidate, ["i"], { stdio: "ignore", windowsHide: true });
    if (!probe.error && probe.status === 0) return candidate;
  }
  throw new Error("7-Zip не найден. Установите 7-Zip или задайте GAMESPACE_7Z.");
}

function runSevenZip(executable, args) {
  const result = spawnSync(executable, args, {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`7-Zip завершился с кодом ${result.status}: ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

async function listSource(directory, prefix = "") {
  const files = [];
  const directories = [];
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name, "en"));

  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      directories.push(relative);
      const nested = await listSource(absolute, relative);
      files.push(...nested.files);
      directories.push(...nested.directories);
    } else if (entry.isFile()) {
      const info = await stat(absolute);
      files.push({ path: relative, size: info.size });
    } else {
      throw new Error(`В demo/ найден неподдерживаемый объект: ${relative}`);
    }
  }
  return { files, directories };
}

function comparePaths(label, expected, actual) {
  const expectedSorted = [...expected].sort();
  const actualSorted = [...actual].sort();
  if (expectedSorted.length !== actualSorted.length) {
    throw new Error(`${label}: ожидалось ${expectedSorted.length}, в архиве ${actualSorted.length}.`);
  }
  for (let index = 0; index < expectedSorted.length; index += 1) {
    if (expectedSorted[index] !== actualSorted[index]) {
      throw new Error(`${label}: ожидалось «${expectedSorted[index]}», найдено «${actualSorted[index]}».`);
    }
  }
}

export async function verifyDemoArchive({
  archivePath = path.join(projectDirectory, "public", "demo.7z"),
  sourceDirectory = path.join(workspaceDirectory, "demo"),
} = {}) {
  const executable = findSevenZip();
  const source = await listSource(sourceDirectory);
  verifyRequiredDemoLicenseFiles(source.files.map((entry) => entry.path), "каталоге demo/");
  const listing = runSevenZip(executable, ["l", "-slt", "-sccUTF-8", archivePath]);
  const archiveEntries = parse7zSlt(listing.split(/\r?\n/));
  const archiveFiles = archiveEntries.filter((entry) => !entry.directory);
  const archiveDirectories = archiveEntries.filter((entry) => entry.directory);
  verifyRequiredDemoLicenseFiles(archiveFiles.map((entry) => entry.path), "архиве demo.7z");

  comparePaths("Список файлов demo.7z не совпадает с demo/", source.files.map((entry) => entry.path), archiveFiles.map((entry) => entry.path));
  comparePaths("Список каталогов demo.7z не совпадает с demo/", source.directories, archiveDirectories.map((entry) => entry.path));

  const sourceSizes = new Map(source.files.map((entry) => [entry.path, entry.size]));
  let uncompressedBytes = 0;
  for (const entry of archiveFiles) {
    const expectedSize = sourceSizes.get(entry.path);
    if (entry.size !== expectedSize) {
      throw new Error(`Размер «${entry.path}» не совпадает: demo/=${expectedSize}, demo.7z=${entry.size}.`);
    }
    uncompressedBytes += entry.size;
  }

  return {
    files: archiveFiles.length,
    directories: archiveDirectories.length,
    uncompressedBytes,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  const result = await verifyDemoArchive({
    archivePath: process.argv[2] ? path.resolve(process.argv[2]) : undefined,
    sourceDirectory: process.argv[3] ? path.resolve(process.argv[3]) : undefined,
  });
  console.log(`demo.7z полностью совпадает с demo/: файлов ${result.files}, каталогов ${result.directories}, распакованный размер ${result.uncompressedBytes} байт.`);
}
