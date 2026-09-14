import { readBrowserEnvironment } from "./runtime-environment.js";

export function realPwaLaunchMode(navigatorObject = globalThis.navigator, matchMedia = globalThis.matchMedia?.bind(globalThis)) {
  return navigatorObject?.standalone === true || matchMedia?.("(display-mode: standalone)").matches
    || matchMedia?.("(display-mode: fullscreen)").matches ? "installed" : "browser";
}

export async function readCompatibilityEnvironment(navigatorObject = globalThis.navigator) {
  const browser = await readBrowserEnvironment(navigatorObject);
  const result = { environmentName: browser.browser === "Неизвестный браузер" ? null : browser.browser,
    environmentVersion: browser.version || null, manufacturer: null, model: null,
    systemName: null, systemVersion: null, baseOs: null, baseOsVersion: null };
  const ua = String(navigatorObject?.userAgent || "");
  let details = null;
  try { details = await navigatorObject?.userAgentData?.getHighEntropyValues?.(["platform", "platformVersion", "model"]); } catch { /* restricted by browser */ }
  const platform = details?.platform || navigatorObject?.userAgentData?.platform || "";
  if (platform === "Android" || /Android/.test(ua)) {
    result.baseOs = "Android";
    // Reduced Android/Chromium UA values are not the device's actual Android version or model.
    result.baseOsVersion = details?.platform === "Android" && details.platformVersion ? details.platformVersion : null;
    result.model = details?.platform === "Android" && details.model ? details.model : null;
  } else if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigatorObject?.maxTouchPoints > 1)) {
    result.systemName = /iPad|Macintosh/.test(ua) ? "iPadOS" : "iOS";
    result.systemVersion = /(?:CPU (?:iPhone )?OS|iPhone OS) ([\d_]+)/.exec(ua)?.[1]?.replace(/_/g, ".") || null;
    result.baseOs = result.baseOsVersion = "-";
  } else {
    result.systemName = platform === "Windows" || /Windows NT/.test(ua) ? "Windows"
      : platform === "Chrome OS" || /CrOS/.test(ua) ? "ChromeOS"
        : platform === "macOS" || /Macintosh/.test(ua) ? "macOS"
          : platform === "Linux" || /Linux/.test(ua) ? "Linux" : null;
    // A Windows UA / UA-CH platform version is not a Windows marketing version.
    if (result.systemName) result.baseOs = result.baseOsVersion = "-";
  }
  for (const [key, value] of Object.entries(result)) {
    if (typeof value === "string" && value.length > 512) result[key] = null;
  }
  return result;
}

export async function readCompatibilityStorage(navigatorObject = globalThis.navigator) {
  try {
    const result = await navigatorObject?.storage?.persisted?.();
    return result === true ? "persistent" : result === false ? "ordinary" : null;
  } catch { return null; }
}
