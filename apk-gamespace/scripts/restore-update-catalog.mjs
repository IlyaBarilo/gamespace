import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { appendFile, copyFile, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { MAX_JSON_BYTES, REPOSITORY_URL, hashApk, parseReleaseTag, sha256, validatePublishedRelease } from "./apk-update-catalog.mjs";
import { prepareUpdateCatalog } from "./prepare-update-catalog.mjs";

const REPOSITORY = "IlyaBarilo/gamespace";
const execute = promisify(execFile);

async function executeTool(executable, args) {
  const { stdout } = await execute(executable, args, {
    encoding: "utf8", windowsHide: true, timeout: 120000, maxBuffer: MAX_JSON_BYTES,
  });
  return stdout;
}

function parseJson(text) {
  if (Buffer.byteLength(text, "utf8") > MAX_JSON_BYTES) throw new Error("Ответ GitHub превышает 1 МиБ.");
  return JSON.parse(text);
}

function readyAssets(release, version) {
  const names = [`GameSpace-${version}.apk`, "GameSpace-latest.apk", `gamespace-pwa-${version}.tar.gz`];
  if (!Array.isArray(release.assets)) throw new Error("GitHub не вернул список файлов релиза.");
  return names.every((name) => {
    const matching = release.assets.filter((asset) => asset?.name === name);
    if (matching.length > 1) throw new Error(`Повторный файл релиза: ${name}`);
    const asset = matching[0];
    if (!asset || asset.state !== "uploaded") return false;
    if (!Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.browser_download_url !== `${REPOSITORY_URL}/releases/download/${release.tag_name}/${name}`) {
      throw new Error(`Некорректные метаданные файла релиза: ${name}`);
    }
    return true;
  });
}

// Reconstruct from release assets, not from the mutable Pages endpoint. This also
// bootstraps the first catalog without treating HTTP/network errors as an empty history.
export async function restoreUpdateCatalog(options, { run = executeTool, notice = console.log } = {}) {
  if (options.repository !== REPOSITORY) throw new Error("Каталог предназначен для официального репозитория GameSpace.");
  parseReleaseTag(options.currentTag);
  sha256(options.expectedSignerSha256);
  if (path.basename(options.output) !== "updates.json") throw new Error("Выходной файл должен называться updates.json.");
  const listed = parseJson(await run("gh", [
    "release", "list", "--repo", REPOSITORY, "--limit", "100", "--exclude-drafts", "--exclude-pre-releases", "--json", "tagName",
  ]));
  if (!Array.isArray(listed) || listed.length > 100 || listed.some((item) => typeof item?.tagName !== "string")) {
    throw new Error("Некорректный список релизов GitHub.");
  }
  const tags = new Set([options.currentTag]);
  for (const { tagName } of listed) {
    try { parseReleaseTag(tagName); } catch {
      notice(`Пропущен неподдерживаемый тег: ${JSON.stringify(tagName)}`);
      continue;
    }
    tags.add(tagName);
  }
  await mkdir(options.workDirectory, { recursive: true });
  const work = await mkdtemp(path.join(options.workDirectory, "restore-"));
  let previous = null;
  let catalog = null;
  for (const tag of tags) {
    const { version } = parseReleaseTag(tag);
    const raw = await run("gh", ["api", `repos/${REPOSITORY}/releases/tags/${tag}`]);
    const release = parseJson(raw);
    if (release?.tag_name !== tag || release.draft !== false || release.prerelease !== false) {
      throw new Error(`Статус или тег релиза изменился во время публикации: ${tag}`);
    }
    if (!readyAssets(release, version)) {
      if (tag === options.currentTag) throw new Error(`Текущий релиз ${tag} не содержит всех трёх готовых файлов.`);
      notice(`Пропущен незавершённый релиз ${tag}: нет полного комплекта APK и PWA.`);
      continue;
    }
    const validated = validatePublishedRelease(release);
    const directory = path.join(work, version);
    await mkdir(directory);
    const metadata = path.join(directory, "release.json");
    await writeFile(metadata, raw, { encoding: "utf8", flag: "wx" });
    for (const name of [validated.asset.name, "GameSpace-latest.apk"]) {
      await run("gh", ["release", "download", tag, "--repo", REPOSITORY, "--pattern", name, "--dir", directory]);
    }
    const apk = path.join(directory, validated.asset.name);
    const versioned = await hashApk(apk);
    const latest = await hashApk(path.join(directory, "GameSpace-latest.apk"));
    const latestAsset = release.assets.find((asset) => asset.name === "GameSpace-latest.apk");
    if (versioned.size !== latest.size || versioned.sha256 !== latest.sha256 || latest.size !== latestAsset.size) {
      throw new Error(`Версионный APK и GameSpace-latest.apk различаются: ${tag}`);
    }
    if (latestAsset.digest != null && latestAsset.digest.toLowerCase() !== `sha256:${latest.sha256}`) {
      throw new Error(`SHA-256 GameSpace-latest.apk не совпадает с GitHub: ${tag}`);
    }
    const output = path.join(directory, "updates.json");
    catalog = await prepareUpdateCatalog({ ...options, apk, release: metadata, previous, output }, { inspectTool: run });
    previous = output;
  }
  if (!catalog || !previous) throw new Error("Не найдено готовых релизов APK.");
  await mkdir(path.dirname(options.output), { recursive: true });
  await copyFile(previous, options.output, constants.COPYFILE_EXCL);
  return catalog;
}

function argumentsFrom(args) {
  const fields = {
    "--repository": "repository", "--current-tag": "currentTag", "--expected-signer-sha256": "expectedSignerSha256",
    "--aapt2": "aapt2", "--apksigner-jar": "apksignerJar", "--java": "java",
    "--work-directory": "workDirectory", "--output": "output",
  };
  const options = {};
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--github-output" && !options.githubOutput) { options.githubOutput = true; continue; }
    const field = fields[args[index]];
    if (!field || options[field] !== undefined || !args[index + 1] || args[index + 1].startsWith("--")) {
      throw new Error(`Некорректный параметр: ${args[index]}`);
    }
    options[field] = args[++index];
  }
  for (const field of ["repository", "currentTag", "expectedSignerSha256", "aapt2", "apksignerJar", "workDirectory", "output"]) {
    if (!options[field]) throw new Error(`Не задан параметр ${field}.`);
  }
  if (options.githubOutput && !process.env.GITHUB_OUTPUT) throw new Error("GITHUB_OUTPUT не задан.");
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = argumentsFrom(process.argv.slice(2));
    const catalog = await restoreUpdateCatalog(options);
    if (options.githubOutput) await appendFile(process.env.GITHUB_OUTPUT, `latest_version=${catalog.releases[0].version}\n`, "utf8");
    console.log(`Каталог APK восстановлен: последняя версия ${catalog.releases[0].version}, записей ${catalog.releases.length}.`);
  } catch (error) {
    console.error(`Публикация каталога APK остановлена: ${error.message}`);
    process.exitCode = 1;
  }
}
