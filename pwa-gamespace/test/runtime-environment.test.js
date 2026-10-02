import test from "node:test";
import assert from "node:assert/strict";
import { detectBrowserEnvironment, formatBrowserEnvironment, readBrowserEnvironment } from "../src/runtime-environment.js";

test("identifies Firefox on Android as Gecko", () => {
  const environment = detectBrowserEnvironment({
    userAgent: "Mozilla/5.0 (Android 16; Mobile; rv:142.0) Gecko/142.0 Firefox/142.0",
  });
  assert.deepEqual(environment, {
    browser: "Firefox", version: "142.0", engine: "Gecko",
    userAgent: "Mozilla/5.0 (Android 16; Mobile; rv:142.0) Gecko/142.0 Firefox/142.0",
  });
  assert.equal(formatBrowserEnvironment(environment), "Firefox 142.0 · Gecko");
});

test("uses the detailed Chromium brand version and ignores greased brands", async () => {
  const environment = await readBrowserEnvironment({
    userAgent: "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Chrome/143.0.0.0 Mobile Safari/537.36",
    userAgentData: {
      brands: [{ brand: "Chromium", version: "143" }],
      async getHighEntropyValues() {
        return { fullVersionList: [
          { brand: "Not_A Brand", version: "99.0.0.0" },
          { brand: "Google Chrome", version: "143.0.7499.40" },
          { brand: "Chromium", version: "143.0.7499.40" },
        ] };
      },
    },
  });
  assert.equal(formatBrowserEnvironment(environment), "Google Chrome 143.0.7499.40 · Chromium");
});

test("reports WebKit for browsers on iOS", () => {
  const environment = detectBrowserEnvironment({
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 FxiOS/142.0 Mobile/15E148 Safari/605.1.15",
  });
  assert.equal(formatBrowserEnvironment(environment), "Firefox 142.0 · WebKit");
});


test("Yandex explicit identity is not hidden by generic Chromium hints", async () => {
  const ua = "Mozilla/5.0 (X11; Linux x86_64) Chrome/132.0.0.0 YaBrowser/25.2.0.1 Safari/537.36";
  for (const brand of ["Chromium", "Google Chrome"]) {
    const nav = { userAgent: ua, userAgentData: {
      brands: [{ brand, version: "132" }],
      getHighEntropyValues: async () => ({ fullVersionList: [{ brand, version: "132.0.6834.1000" }] }),
    } };
    assert.equal(detectBrowserEnvironment(nav).browser, "Яндекс Браузер");
    assert.equal(formatBrowserEnvironment(await readBrowserEnvironment(nav)), "Яндекс Браузер 25.2.0.1 · Chromium");
    nav.userAgentData.getHighEntropyValues = async () => { throw new Error("restricted"); };
    assert.equal((await readBrowserEnvironment(nav)).version, "25.2.0.1");
  }
});

test("Yandex full brand version is used; Chromium remains Chromium without Yandex markers", async () => {
  const userAgent = "Mozilla/5.0 (X11; Linux x86_64) Chrome/132.0.0.0 Safari/537.36";
  const nav = { userAgent, userAgentData: {
    brands: [{ brand: "Chromium", version: "132" }],
    getHighEntropyValues: async () => ({ fullVersionList: [
      { brand: "Chromium", version: "132.0.6834.1000" }, { brand: "Yandex", version: "25.2.0.1" },
    ] }),
  } };
  assert.equal(formatBrowserEnvironment(await readBrowserEnvironment(nav)), "Яндекс Браузер 25.2.0.1 · Chromium");
  assert.equal(detectBrowserEnvironment(nav).browser, "Chromium");
});
