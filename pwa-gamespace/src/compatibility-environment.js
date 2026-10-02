import { readBrowserEnvironment } from "./runtime-environment.js";

function appleMobileFamily(userAgent, maxTouchPoints) {
  if (/iPhone/.test(userAgent)) return "iPhone";
  if (/iPad/.test(userAgent)) return "iPad";
  if (/iPod/.test(userAgent)) return "iPod";
  return /Macintosh/.test(userAgent) && Number(maxTouchPoints) > 1 ? "iPad" : null;
}

function reliableAppleSystemVersion(userAgent, browser) {
  const observed = /(?:CPU (?:iPhone )?OS|iPhone OS) ([\d_]+)/.exec(userAgent)?.[1]?.replace(/_/g, ".") || null;
  if (!observed) return null;
  const safariMajor = browser.browser === "Safari" ? Number.parseInt(browser.version, 10) : null;
  // Safari 26+ freezes the OS token. Installed Apple web apps may omit the browser version,
  // so their UA token cannot be distinguished from a real pre-freeze iOS version either.
  return (Number.isInteger(safariMajor) && safariMajor >= 26) || browser.browser === "Неизвестный браузер"
    ? null : observed;
}

export function realPwaLaunchMode(navigatorObject = globalThis.navigator, matchMedia = globalThis.matchMedia?.bind(globalThis)) {
  // GameSpace's installed manifest uses standalone. Fullscreen API / F11 is not installation.
  return navigatorObject?.standalone === true || matchMedia?.("(display-mode: standalone)").matches
    ? "installed" : "browser";
}

export async function readCompatibilityEnvironment(navigatorObject = globalThis.navigator) {
  const browser = await readBrowserEnvironment(navigatorObject);
  const result = { environmentName: browser.browser === "Неизвестный браузер" ? null : browser.browser,
    environmentVersion: browser.version || null, manufacturer: null, model: null,
    deviceFamily: null, systemName: null, systemVersion: null, baseOs: null, baseOsVersion: null };
  const ua = String(navigatorObject?.userAgent || "");
  let details = null;
  try { details = await navigatorObject?.userAgentData?.getHighEntropyValues?.(["platform", "platformVersion", "model"]); } catch { /* restricted by browser */ }
  const platform = details?.platform || navigatorObject?.userAgentData?.platform || "";
  if (platform === "Android" || /Android/.test(ua)) {
    result.baseOs = "Android";
    // Reduced Android/Chromium UA values are not the device's actual Android version or model.
    result.baseOsVersion = details?.platform === "Android" && details.platformVersion ? details.platformVersion : null;
    result.model = details?.platform === "Android" && details.model ? details.model : null;
  } else if ((result.deviceFamily = appleMobileFamily(ua, navigatorObject?.maxTouchPoints))) {
    result.manufacturer = "Apple";
    result.systemName = result.deviceFamily === "iPad" ? "iPadOS" : "iOS";
    result.systemVersion = reliableAppleSystemVersion(ua, browser);
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
