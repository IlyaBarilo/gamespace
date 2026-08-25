import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { normalizeVersion, projectDirectory, readJson } from "./release-utils.mjs";

const version = normalizeVersion(process.argv[2]);
const releaseDate = process.argv[3] || "";

if (releaseDate && !/^\d{4}-\d{2}-\d{2}$/.test(releaseDate)) {
  throw new Error(`Некорректная дата выпуска: ${releaseDate}`);
}

const crlf = "\r\n";

async function writeJson(relative, value) {
  const target = path.join(projectDirectory, relative);
  const serialized = JSON.stringify(value, null, 2).replace(/\n/g, crlf);
  await writeFile(target, `${serialized}${crlf}`, "utf8");
}

async function replaceText(relative, replacements) {
  const target = path.join(projectDirectory, relative);
  let value = await readFile(target, "utf8");

  for (const { pattern, replacement, expected, label } of replacements) {
    let count = 0;
    value = value.replace(pattern, (...args) => {
      count += 1;
      return typeof replacement === "function" ? replacement(...args) : replacement;
    });
    if (count !== expected) {
      throw new Error(`Не удалось обновить ${label}: найдено ${count}, ожидалось ${expected}.`);
    }
  }

  value = value.replace(/\r?\n/g, crlf);
  await writeFile(target, value, "utf8");
}

const packageInfo = await readJson(path.join(projectDirectory, "package.json"));
packageInfo.version = version;
await writeJson("package.json", packageInfo);

const packageLock = await readJson(path.join(projectDirectory, "package-lock.json"));
packageLock.version = version;
if (!packageLock.packages?.[""]) {
  throw new Error("В package-lock.json отсутствует корневая запись packages[''].");
}
packageLock.packages[""].version = version;
await writeJson("package-lock.json", packageLock);

const releaseInfo = await readJson(path.join(projectDirectory, "release-info.json"));
releaseInfo.version = version;
if (releaseDate) releaseInfo.date = releaseDate;
await writeJson("release-info.json", releaseInfo);

await writeJson("public/version.json", { version });

await replaceText("src/app.js", [
  {
    pattern: /const APP_VERSION = "\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?";/,
    replacement: `const APP_VERSION = "${version}";`,
    expected: 1,
    label: "APP_VERSION в src/app.js",
  },
]);

await replaceText("index.html", [
  {
    pattern: /GameSpace PWA · версия \d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/g,
    replacement: `GameSpace PWA · версия ${version}`,
    expected: 2,
    label: "версию в подвалах index.html",
  },
  {
    pattern: /Установлена версия \d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\./,
    replacement: `Установлена версия ${version}.`,
    expected: 1,
    label: "установленную версию в index.html",
  },
]);

console.log(`Версия PWA синхронизирована с выпуском ${version}${releaseDate ? ` от ${releaseDate}` : ""}.`);
