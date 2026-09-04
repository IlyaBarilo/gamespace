const BRAND_PRIORITY = [
  ["Microsoft Edge", /microsoft edge/i, "Chromium"],
  ["Samsung Internet", /samsung internet/i, "Chromium"],
  ["Opera", /^opera$/i, "Chromium"],
  ["Google Chrome", /google chrome/i, "Chromium"],
  ["Chromium", /^chromium$/i, "Chromium"],
];

const UA_PATTERNS = [
  ["Samsung Internet", /SamsungBrowser\/([\d.]+)/, "Chromium"],
  ["Microsoft Edge", /(?:EdgA|EdgiOS|Edg)\/([\d.]+)/, "Chromium"],
  ["Opera", /OPR\/([\d.]+)/, "Chromium"],
  ["Vivaldi", /Vivaldi\/([\d.]+)/, "Chromium"],
  ["Яндекс Браузер", /YaBrowser\/([\d.]+)/, "Chromium"],
  ["Firefox", /(?:Firefox|FxiOS)\/([\d.]+)/, "Gecko"],
  ["Google Chrome", /(?:Chrome|CriOS)\/([\d.]+)/, "Chromium"],
  ["Safari", /Version\/([\d.]+).*Safari\//, "WebKit"],
];

function normalizeBrands(brands) {
  if (!Array.isArray(brands)) return [];
  return brands.filter((item) => item && typeof item.brand === "string" && !/not.?a.?brand/i.test(item.brand));
}

function fromBrands(brands, isAppleMobile) {
  for (const [browser, pattern, engine] of BRAND_PRIORITY) {
    const item = brands.find((candidate) => pattern.test(candidate.brand));
    if (item) return { browser, version: String(item.version || ""), engine: isAppleMobile ? "WebKit" : engine };
  }
  return null;
}

function fromUserAgent(userAgent, isAppleMobile) {
  for (const [browser, pattern, engine] of UA_PATTERNS) {
    const match = pattern.exec(userAgent);
    if (match) return { browser, version: match[1] || "", engine: isAppleMobile ? "WebKit" : engine };
  }
  if (/AppleWebKit\//.test(userAgent)) return { browser: "Неизвестный браузер", version: "", engine: "WebKit" };
  if (/Gecko\//.test(userAgent)) return { browser: "Неизвестный браузер", version: "", engine: "Gecko" };
  return { browser: "Неизвестный браузер", version: "", engine: "движок не определён" };
}

function detect(navigatorObject, brands) {
  const userAgent = String(navigatorObject?.userAgent || "");
  const isAppleMobile = /(?:iPhone|iPad|iPod)/.test(userAgent);
  return { ...(fromBrands(normalizeBrands(brands), isAppleMobile) || fromUserAgent(userAgent, isAppleMobile)), userAgent };
}

export function detectBrowserEnvironment(navigatorObject = globalThis.navigator) {
  return detect(navigatorObject, navigatorObject?.userAgentData?.brands);
}

export async function readBrowserEnvironment(navigatorObject = globalThis.navigator) {
  let brands = navigatorObject?.userAgentData?.brands;
  try {
    const details = await navigatorObject?.userAgentData?.getHighEntropyValues?.(["fullVersionList"]);
    if (details?.fullVersionList?.length) brands = details.fullVersionList;
  } catch {
    // The browser may restrict detailed version data. The ordinary UA remains a useful fallback.
  }
  return detect(navigatorObject, brands);
}

export function formatBrowserEnvironment(environment) {
  const version = environment?.version ? ` ${environment.version}` : "";
  return `${environment?.browser || "Неизвестный браузер"}${version} · ${environment?.engine || "движок не определён"}`;
}
