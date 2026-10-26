import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, mkdtemp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { parseReleaseTag, projectDirectory, readJson, listFiles, verifyReleaseLicenseBundle } from "./release-utils.mjs";
import { REPOSITORY_URL, validateCatalog, validatePublishedRelease } from "../../apk-gamespace/scripts/apk-update-catalog.mjs";

const REPOSITORY = "IlyaBarilo/gamespace";
const execute = promisify(execFile);
async function runTool(command, args) {
  const { stdout } = await execute(command, args, { encoding: "utf8", windowsHide: true, timeout: 120_000, maxBuffer: 8 * 1024 * 1024 });
  return stdout;
}
async function hashFile(file) {
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  return hash.digest("hex");
}
function safePath(name) {
  if (typeof name !== "string" || !name || /[\\:\x00-\x1f\x7f]/.test(name)
    || name.split("/").some(part => !part || part === "." || part === "..")) {
    throw new Error(`Небезопасный путь в пакете PWA: ${JSON.stringify(name)}`);
  }
  return name;
}

export function validateTarListing(names, details) {
  const entries = names.split(/\r?\n/).filter(Boolean);
  const types = details.split(/\r?\n/).filter(Boolean);
  if (!entries.length || entries.length !== types.length || entries.length > 10_000) throw new Error("Некорректный список файлов tar.gz.");
  const seen = new Set();
  for (let index = 0; index < entries.length; index++) {
    if (!/^[d-]/.test(types[index])) throw new Error("Пакет PWA содержит ссылку или специальный файл.");
    const name = entries[index].replace(/^\.\//, "").replace(/\/$/, "");
    if (name === "" || name === ".") {
      if (!types[index].startsWith("d")) throw new Error("Некорректный корень tar.gz.");
      continue;
    }
    safePath(name);
    if (seen.has(name)) throw new Error(`Повтор пути в tar.gz: ${name}`);
    seen.add(name);
  }
}

export async function verifyPublishedPackage(root, version, lock) {
  const manifest = await readJson(path.join(root, "release.json"));
  if (manifest.schema !== 1 || manifest.product !== "gamespace-pwa" || manifest.version !== version
    || manifest.runtime !== lock.publishedFile || !Array.isArray(manifest.files) || !manifest.files.length) {
    throw new Error(`Манифест пакета PWA не соответствует версии ${version}.`);
  }
  const expected = new Set(["release.json"]);
  let total = 0;
  for (const file of manifest.files) {
    safePath(file.path);
    if (expected.has(file.path) || !Number.isSafeInteger(file.size) || file.size < 0 || !/^[0-9a-f]{64}$/.test(file.sha256)) {
      throw new Error(`Некорректная запись файла в манифесте ${version}.`);
    }
    expected.add(file.path);
    const absolute = path.join(root, ...file.path.split("/"));
    const info = await lstat(absolute);
    if (!info.isFile() || info.size !== file.size || await hashFile(absolute) !== file.sha256) {
      throw new Error(`Проверка содержимого PWA ${version}/${file.path} не пройдена.`);
    }
    total += info.size;
  }
  const actual = await listFiles(root);
  if (!expected.has("index.html") || actual.length !== expected.size || actual.some(file => !expected.has(file)) || total !== manifest.totalSize) {
    throw new Error(`Состав или размер пакета PWA ${version} не совпадает с манифестом.`);
  }
  verifyReleaseLicenseBundle(manifest, actual, `PWA ${version}`);
  for (const [relative, digest] of Object.entries(lock.releaseFiles)) {
    if (!expected.has(relative) || await hashFile(path.join(root, ...safePath(relative).split("/"))) !== digest) {
      throw new Error(`Неизменяемый runtime PWA ${version} отсутствует или изменён.`);
    }
  }
  return manifest;
}

export async function restorePublishedPwa(options, { run = runTool, notice = console.log } = {}) {
  if (options.repository !== REPOSITORY) throw new Error("Нужен официальный репозиторий GameSpace.");
  const current = parseReleaseTag(options.currentTag);
  const catalog = validateCatalog(await readJson(options.catalog));
  const currentEntry = catalog.releases.find(entry => entry.tag === current.tag);
  if (!currentEntry) throw new Error("Запрошенный релиз отсутствует в проверенном каталоге APK.");
  const selected = catalog.releases.slice(0, 10);
  if (!selected.some(entry => entry.tag === current.tag)) selected.push(currentEntry);
  const lock = await readJson(path.join(projectDirectory, "runtime-lock.json"));
  if (!Object.keys(lock.releaseFiles || {}).length) throw new Error("Отсутствует доверенная контрольная сумма runtime.");
  await mkdir(options.workDirectory, { recursive: true });
  const work = await mkdtemp(path.join(options.workDirectory, "pwa-"));
  await mkdir(options.packagesDirectory, { recursive: true });
  for (const entry of selected) {
    const raw = await run("gh", ["api", `repos/${REPOSITORY}/releases/tags/${entry.tag}`]);
    if (Buffer.byteLength(raw, "utf8") > 1024 * 1024) throw new Error("Ответ GitHub превышает 1 МиБ.");
    const metadata = JSON.parse(raw);
    const release = validatePublishedRelease(metadata);
    if (release.tag !== entry.tag || release.publishedAt !== entry.publishedAt || release.asset.size !== entry.apk.size
      || (release.asset.digest && release.asset.digest !== entry.apk.sha256)) throw new Error("Релиз изменился после проверки каталога APK.");
    const name = `gamespace-pwa-${entry.version}.tar.gz`;
    const matches = metadata.assets.filter(asset => asset.name === name);
    if (matches.length !== 1) throw new Error(`Отсутствует единственный готовый файл ${name}.`);
    const asset = matches[0];
    if (asset.state !== "uploaded" || !Number.isSafeInteger(asset.size) || asset.size <= 0
      || asset.browser_download_url !== `${REPOSITORY_URL}/releases/download/${entry.tag}/${name}`
      || !/^sha256:[0-9a-f]{64}$/i.test(asset.digest || "")) throw new Error(`Нет достоверной контрольной суммы GitHub для ${name}.`);
    const download = path.join(work, entry.version);
    await mkdir(download);
    await run("gh", ["release", "download", entry.tag, "--repo", REPOSITORY, "--pattern", name, "--dir", download]);
    const archive = path.join(download, name);
    if ((await lstat(archive)).size !== asset.size || `sha256:${await hashFile(archive)}` !== asset.digest.toLowerCase()) {
      throw new Error(`Размер или SHA-256 архива ${name} не совпадает с GitHub.`);
    }
    validateTarListing(await run("tar", ["-tzf", archive]), await run("tar", ["-tvzf", archive]));
    const target = path.join(options.packagesDirectory, entry.version);
    await mkdir(target);
    await run("tar", ["-xzf", archive, "-C", target]);
    await verifyPublishedPackage(target, entry.version, lock);
    notice(`Проверен опубликованный пакет PWA ${entry.version}: SHA-256 GitHub, файлы и runtime.`);
  }
  return catalog.releases[0].version;
}

function argumentsFrom(args) {
  const names = { "--repository": "repository", "--current-tag": "currentTag", "--catalog": "catalog", "--packages-directory": "packagesDirectory", "--work-directory": "workDirectory" };
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = names[args[index]], value = args[index + 1];
    if (!key || options[key] || !value || value.startsWith("--")) throw new Error(`Некорректный параметр: ${args[index]}`);
    options[key] = value;
  }
  if (Object.values(names).some(key => !options[key])) throw new Error("Заданы не все параметры восстановления PWA.");
  return options;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await restorePublishedPwa(argumentsFrom(process.argv.slice(2))); }
  catch (error) { console.error(`Быстрый деплой остановлен: ${error.message}`); process.exitCode = 1; }
}
