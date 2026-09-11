import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { appendFile, copyFile, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { APPLICATION_ID, MAX_JSON_BYTES, REPOSITORY_URL, createReleaseEntry, hashApk, mergeCatalog, parseReleaseTag, serializeCatalog, sha256, validateCatalog, validatePublishedRelease } from "./apk-update-catalog.mjs";
import { prepareUpdateCatalog } from "./prepare-update-catalog.mjs";

const REPOSITORY = "IlyaBarilo/gamespace";
const PUBLISHED_CATALOG_URL = "https://ilyabarilo.github.io/gamespace/apk/updates.json";
const execute = promisify(execFile);

export async function readPublishedCache({ fetchCatalog = fetch, notice = console.log } = {}) {
  let reader;
  try {
    const response = await fetchCatalog(PUBLISHED_CATALOG_URL, {
      redirect: "error", credentials: "omit", cache: "no-store", signal: AbortSignal.timeout(15000),
    });
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
    reader = response.body.getReader();
    if (Number(response.headers.get("content-length")) > MAX_JSON_BYTES) throw new Error("Каталог превышает 1 МиБ.");
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_JSON_BYTES) throw new Error("Каталог превышает 1 МиБ.");
      chunks.push(value);
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
    return validateCatalog(JSON.parse(text));
  } catch (error) {
    notice(`Кэш каталога APK недоступен; выполняется полная проверка релизов: ${error.message}`);
    return null;
  } finally {
    if (reader) await reader.cancel().catch(() => {});
  }
}

function cachedRelease(cache, release, latestAsset, expectedSigner) {
  const entry = cache?.releases.find((item) => item.tag === release.tag);
  if (!entry || entry.apk.signerSha256 !== expectedSigner || entry.publishedAt !== release.publishedAt
      || entry.apk.sha256 !== release.asset.digest || entry.apk.size !== release.asset.size
      || latestAsset.size !== entry.apk.size || typeof latestAsset.digest !== "string"
      || latestAsset.digest.toLowerCase() !== `sha256:${entry.apk.sha256}`) return null;
  // Rebuild from live release metadata, retaining only the previously verified APK identity.
  return createReleaseEntry(release, {
    applicationId: APPLICATION_ID, version: entry.version, versionCode: entry.versionCode,
    minSdk: entry.minSdk, signerSha256: entry.apk.signerSha256,
  }, { size: entry.apk.size, sha256: entry.apk.sha256 });
}

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

// GitHub Releases remain the source of history. Pages can only save a repeated APK
// download when both live asset digests and the trusted signing certificate match.
export async function restoreUpdateCatalog(options, { run = executeTool, notice = console.log, fetchCatalog = fetch } = {}) {
  if (options.repository !== REPOSITORY) throw new Error("Каталог предназначен для официального репозитория GameSpace.");
  parseReleaseTag(options.currentTag);
  const expectedSigner = sha256(options.expectedSignerSha256);
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
  const cache = options.usePublishedCache ? await readPublishedCache({ fetchCatalog, notice }) : null;
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
    const latestAsset = release.assets.find((asset) => asset.name === "GameSpace-latest.apk");
    const directory = path.join(work, version);
    await mkdir(directory);
    const output = path.join(directory, "updates.json");
    const cached = cachedRelease(cache, validated, latestAsset, expectedSigner);
    if (cached) {
      catalog = mergeCatalog(cached, catalog);
      await writeFile(output, serializeCatalog(catalog), { encoding: "utf8", flag: "wx" });
      previous = output;
      notice(`Повторно использованы проверенные сведения APK ${tag}: SHA-256 обоих файлов совпадает с GitHub.`);
      continue;
    }
    const metadata = path.join(directory, "release.json");
    await writeFile(metadata, raw, { encoding: "utf8", flag: "wx" });
    for (const name of [validated.asset.name, "GameSpace-latest.apk"]) {
      await run("gh", ["release", "download", tag, "--repo", REPOSITORY, "--pattern", name, "--dir", directory]);
    }
    const apk = path.join(directory, validated.asset.name);
    const versioned = await hashApk(apk);
    const latest = await hashApk(path.join(directory, "GameSpace-latest.apk"));
    if (versioned.size !== latest.size || versioned.sha256 !== latest.sha256 || latest.size !== latestAsset.size) {
      throw new Error(`Версионный APK и GameSpace-latest.apk различаются: ${tag}`);
    }
    if (latestAsset.digest != null && latestAsset.digest.toLowerCase() !== `sha256:${latest.sha256}`) {
      throw new Error(`SHA-256 GameSpace-latest.apk не совпадает с GitHub: ${tag}`);
    }
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
    if (args[index] === "--use-published-cache" && !options.usePublishedCache) { options.usePublishedCache = true; continue; }
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
