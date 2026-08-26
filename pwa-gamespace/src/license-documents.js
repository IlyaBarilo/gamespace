export const licenseDocumentGroups = Object.freeze([
  Object.freeze({
    title: "GameSpace",
    documents: Object.freeze([
      Object.freeze({ title: "MIT License", path: "LICENSE.txt" }),
      Object.freeze({ title: "Фирменные материалы GameSpace", path: "BRAND_ASSETS_LICENSE.md" }),
      Object.freeze({ title: "Встроенные демонстрационные материалы", path: "DEMO_CONTENT_LICENSE.md" }),
      Object.freeze({ title: "Уведомления о сторонних компонентах", path: "THIRD_PARTY_NOTICES.md" }),
    ]),
  }),
  Object.freeze({
    title: "Сторонние лицензии",
    documents: Object.freeze([
      Object.freeze({ title: "7-Zip / un7z-opfs", path: "third_party/licenses/7ZIP-UN7Z-LICENSE.txt" }),
      Object.freeze({ title: "Apache License 2.0", path: "third_party/licenses/APACHE-2.0.txt" }),
      Object.freeze({ title: "Commons Codec NOTICE", path: "third_party/licenses/COMMONS-CODEC-NOTICE.txt" }),
      Object.freeze({ title: "Commons Compress NOTICE", path: "third_party/licenses/COMMONS-COMPRESS-NOTICE.txt" }),
      Object.freeze({ title: "Commons IO NOTICE", path: "third_party/licenses/COMMONS-IO-NOTICE.txt" }),
      Object.freeze({ title: "Commons Lang NOTICE", path: "third_party/licenses/COMMONS-LANG3-NOTICE.txt" }),
      Object.freeze({ title: "Emscripten", path: "third_party/licenses/EMSCRIPTEN-LICENSE.md" }),
      Object.freeze({ title: "GNU LGPL 2.1", path: "third_party/licenses/LGPL-2.1.txt" }),
      Object.freeze({ title: "Roboto SIL OFL 1.1", path: "third_party/licenses/ROBOTO-OFL-1.1.txt" }),
      Object.freeze({ title: "XZ for Java 0BSD", path: "third_party/licenses/XZ-FOR-JAVA-1.12.txt" }),
      Object.freeze({ title: "zip.js BSD 3-Clause", path: "third_party/licenses/ZIP-JS-BSD-3-CLAUSE.txt" }),
    ]),
  }),
]);

export function allLicenseDocuments() {
  return licenseDocumentGroups.flatMap((group) => group.documents);
}

export function resolveLicenseDocumentUrl(documentPath, baseUrl) {
  if (typeof documentPath !== "string"
      || !documentPath
      || documentPath.startsWith("/")
      || documentPath.includes("\\")
      || documentPath.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("Некорректный путь лицензионного документа.");
  }
  const scope = new URL("./", baseUrl);
  const resolved = new URL(documentPath, scope);
  if (resolved.origin !== scope.origin || !resolved.pathname.startsWith(scope.pathname)) {
    throw new Error("Лицензионный документ находится за пределами GameSpace.");
  }
  return resolved;
}

export async function fetchLicenseDocument(documentPath, {
  baseUrl = globalThis.location?.href,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!baseUrl || typeof fetchImpl !== "function") {
    throw new Error("Загрузка лицензионного документа недоступна.");
  }
  const url = resolveLicenseDocumentUrl(documentPath, baseUrl);
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`Не удалось открыть документ: HTTP ${response.status}.`);
  }
  const text = await response.text();
  const contentType = response.headers?.get?.("Content-Type") || "";
  if (contentType.toLowerCase().includes("text/html") && /^\s*<!doctype html/i.test(text)) {
    throw new Error("Сервер не вернул запрошенный лицензионный документ.");
  }
  return text;
}
