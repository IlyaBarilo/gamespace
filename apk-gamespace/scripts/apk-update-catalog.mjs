import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";

export const APPLICATION_ID = "ru.local.gamespace.loader";
export const REPOSITORY_URL = "https://github.com/IlyaBarilo/gamespace";
export const MAX_JSON_BYTES = 1024 * 1024;
export const MAX_RELEASES = 100;
const MAX_DESCRIPTION_BYTES = 32 * 1024;
const MAX_ANDROID_INTEGER = 2147483647;

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function positiveInteger(value, label, maximum = MAX_ANDROID_INTEGER) {
  requireValue(Number.isSafeInteger(value) && value > 0 && value <= maximum, `Некорректное поле ${label}.`);
  return value;
}

export function sha256(value, label = "SHA-256") {
  requireValue(typeof value === "string" && /^[0-9a-f]{64}$/i.test(value), `Некорректное поле ${label}.`);
  return value.toLowerCase();
}

export function parseReleaseTag(tag) {
  requireValue(typeof tag === "string" && /^v(0|[1-9]\d*)(?:\.(0|[1-9]\d*))?(?:\.(0|[1-9]\d*))?$/.test(tag), "Некорректный тег релиза.");
  const parts = tag.slice(1).split(".");
  while (parts.length < 3) parts.push("0");
  const canonical = [...parts];
  if (canonical[2] === "0") {
    canonical.pop();
    if (canonical[1] === "0") canonical.pop();
  }
  requireValue(tag === `v${canonical.join(".")}`, "Тег релиза должен иметь каноническую сокращённую форму.");
  const [major, minor, patch] = parts.map(Number);
  requireValue([major, minor, patch].every(Number.isSafeInteger) && minor <= 99 && patch <= 99, "Версия не поддерживается схемой Android versionCode.");
  const versionCode = positiveInteger(major * 10000 + minor * 100 + patch, "versionCode");
  return { tag, version: parts.join("."), versionCode };
}

function description(value) {
  requireValue(typeof value === "string", "Описание релиза должно быть строкой.");
  requireValue(Buffer.byteLength(value, "utf8") <= MAX_DESCRIPTION_BYTES, "Описание релиза превышает 32 КиБ.");
  return value.replace(/\r\n?/g, "\n");
}

function publicationDate(value) {
  requireValue(typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value), "Некорректная дата публикации релиза.");
  const parsed = new Date(value);
  requireValue(Number.isFinite(parsed.getTime()) && parsed.toISOString() === value.replace("Z", ".000Z"), "Некорректная дата публикации релиза.");
  return value;
}

function assetAddress(release) {
  const name = `GameSpace-${release.version}.apk`;
  return { name, url: `${REPOSITORY_URL}/releases/download/${release.tag}/${name}` };
}

export function validatePublishedRelease(release) {
  requireValue(isObject(release) && release.draft === false && release.prerelease === false, "Нужен опубликованный стабильный релиз.");
  const version = parseReleaseTag(release.tag_name);
  requireValue(release.html_url === `${REPOSITORY_URL}/releases/tag/${version.tag}`, "Релиз должен принадлежать официальному репозиторию GameSpace.");
  const publishedAt = publicationDate(release.published_at);
  const notes = description(release.body ?? "");
  requireValue(Array.isArray(release.assets), "В релизе отсутствует список файлов.");
  const expected = assetAddress(version);
  const matches = release.assets.filter((asset) => isObject(asset) && asset.name === expected.name);
  requireValue(matches.length === 1, `В релизе должен быть ровно один файл ${expected.name}.`);
  const asset = matches[0];
  requireValue(asset.state === "uploaded", "Загрузка APK в релиз ещё не завершена.");
  requireValue(asset.browser_download_url === expected.url, "APK должен иметь постоянную ссылку на файл своего релиза.");
  positiveInteger(asset.size, "размер APK");
  if (asset.digest != null) {
    requireValue(typeof asset.digest === "string" && /^sha256:[0-9a-f]{64}$/i.test(asset.digest), "Некорректная контрольная сумма файла GitHub.");
  }
  return {
    ...version, publishedAt, description: notes, releaseUrl: release.html_url,
    asset: { ...expected, size: asset.size, digest: asset.digest?.slice(7).toLowerCase() ?? null },
  };
}

// These reports must come from successful SDK commands, never from release text.
export function parseApkIdentity(badging, certificateReport, expectedSignerSha256) {
  const packages = [...badging.matchAll(/^package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'[^\r\n]*$/gm)];
  const sdks = [...badging.matchAll(/^(?:sdkVersion|minSdkVersion):'(\d+)'\r?$/gm)];
  const certificates = [...certificateReport.matchAll(/^Signer #\d+ certificate SHA-256 digest: ([0-9a-f]+)\r?$/gmi)];
  requireValue(packages.length === 1 && sdks.length === 1, "Не удалось однозначно прочитать пакет, версию и minSdk APK.");
  requireValue(packages[0][1] === APPLICATION_ID, "APK принадлежит другому приложению.");
  requireValue(certificates.length === 1, "Ожидалась одна подпись APK; смена или несколько ключей требуют отдельной проверки.");
  const signerSha256 = sha256(certificates[0][1], "сертификат APK");
  requireValue(signerSha256 === sha256(expectedSignerSha256, "ожидаемый сертификат APK"), "Подпись APK не совпадает с ожидаемым сертификатом.");
  return {
    applicationId: packages[0][1],
    version: packages[0][3],
    versionCode: positiveInteger(Number(packages[0][2]), "versionCode APK"),
    minSdk: positiveInteger(Number(sdks[0][1]), "minSdk APK"),
    signerSha256,
  };
}

export async function hashApk(file) {
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of createReadStream(file)) {
    size += chunk.length;
    hash.update(chunk);
  }
  return { size: positiveInteger(size, "размер APK"), sha256: hash.digest("hex") };
}

export function createReleaseEntry(release, identity, file) {
  requireValue(identity.applicationId === APPLICATION_ID && identity.version === release.version && identity.versionCode === release.versionCode, "Версия или пакет APK не соответствуют тегу релиза.");
  requireValue(file.size === release.asset.size, "Размер APK не совпадает с файлом релиза.");
  const hash = sha256(file.sha256);
  requireValue(!release.asset.digest || hash === release.asset.digest, "SHA-256 APK не совпадает с файлом релиза.");
  return validateEntry({
    tag: release.tag, version: release.version, versionCode: release.versionCode,
    publishedAt: release.publishedAt, description: release.description, releaseUrl: release.releaseUrl,
    minSdk: identity.minSdk,
    apk: {
      name: release.asset.name, url: release.asset.url, size: file.size,
      sha256: hash, signerSha256: identity.signerSha256,
    },
  });
}

function validateEntry(entry) {
  requireValue(isObject(entry) && isObject(entry.apk), "Некорректная запись каталога APK.");
  const release = parseReleaseTag(entry.tag);
  requireValue(entry.version === release.version && entry.versionCode === release.versionCode, "Версия записи каталога не соответствует тегу.");
  const asset = assetAddress(release);
  requireValue(entry.releaseUrl === `${REPOSITORY_URL}/releases/tag/${release.tag}` && entry.apk.name === asset.name && entry.apk.url === asset.url, "Запись каталога содержит неподходящую ссылку или имя APK.");
  return {
    ...release, publishedAt: publicationDate(entry.publishedAt), description: description(entry.description),
    releaseUrl: entry.releaseUrl, minSdk: positiveInteger(entry.minSdk, "minSdk"),
    apk: {
      ...asset, size: positiveInteger(entry.apk.size, "размер APK"),
      sha256: sha256(entry.apk.sha256), signerSha256: sha256(entry.apk.signerSha256, "сертификат APK"),
    },
  };
}

export function validateCatalog(catalog) {
  requireValue(isObject(catalog) && catalog.schemaVersion === 1 && catalog.applicationId === APPLICATION_ID && catalog.channel === "stable", "Неподдерживаемый формат каталога APK.");
  requireValue(Array.isArray(catalog.releases) && catalog.releases.length > 0 && catalog.releases.length <= MAX_RELEASES, "Каталог должен содержать от 1 до 100 релизов.");
  const releases = catalog.releases.map(validateEntry);
  for (let index = 1; index < releases.length; index++) {
    requireValue(releases[index - 1].versionCode > releases[index].versionCode, "Версии каталога должны быть уникальны и отсортированы от новых к старым.");
  }
  requireValue(catalog.latestVersionCode === releases[0].versionCode, "Последняя версия каталога должна иметь наибольший versionCode.");
  return {
    schemaVersion: 1, applicationId: APPLICATION_ID, channel: "stable",
    latestVersionCode: releases[0].versionCode, releases,
  };
}

export function mergeCatalog(entry, previous = null) {
  const next = validateEntry(entry);
  const releases = previous === null ? [] : validateCatalog(previous).releases;
  const existing = releases.find((item) => item.versionCode === next.versionCode);
  if (existing) {
    requireValue(JSON.stringify(existing.apk) === JSON.stringify(next.apk) && existing.minSdk === next.minSdk && existing.publishedAt === next.publishedAt, "Опубликованный APK этой версии нельзя заменить другим файлом или изменить его метаданные.");
  }
  const merged = [...releases.filter((item) => item.versionCode !== next.versionCode), next]
    .sort((left, right) => right.versionCode - left.versionCode).slice(0, MAX_RELEASES);
  return validateCatalog({
    schemaVersion: 1, applicationId: APPLICATION_ID, channel: "stable",
    latestVersionCode: merged[0].versionCode, releases: merged,
  });
}

export function serializeCatalog(catalog) {
  const text = `${JSON.stringify(validateCatalog(catalog), null, 2)}\n`.replace(/\n/g, "\r\n");
  requireValue(Buffer.byteLength(text, "utf8") <= MAX_JSON_BYTES, "Каталог APK превышает 1 МиБ.");
  return text;
}

export async function readJson(file) {
  const info = await stat(file);
  requireValue(info.isFile() && info.size <= MAX_JSON_BYTES, "Входной JSON должен быть файлом не более 1 МиБ.");
  const bytes = await readFile(file);
  requireValue(bytes.length <= MAX_JSON_BYTES, "Входной JSON превышает 1 МиБ.");
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}
