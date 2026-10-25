import { test, expect } from "@playwright/test";
import { ZipWriter, BlobWriter, TextReader } from "@zip.js/zip.js";

test("completion returns to catalog but nested mini-games do not close a novel", async ({ page }) => {
  page.on("dialog", dialog => dialog.accept());
  await page.addInitScript(() => Object.defineProperty(navigator, "standalone", { get: () => true }));
  await page.goto("./");
  await expect(page.locator("#statusText")).toHaveText("Сайт готов к автономной работе");
  const zip = new ZipWriter(new BlobWriter("application/zip"));
  await zip.add("index.html", new TextReader('<style>body{padding-top:100px}</style><a href="legacy.html">Legacy</a><a href="v2.html">V2</a><a href="novel.html">Novel</a>'));
  await zip.add("legacy.html", new TextReader('<style>body{padding-top:100px}</style><button onclick="parent.postMessage({type:\'gameResult\',result:0},\'*\')">Finish</button>'));
  await zip.add("v2.html", new TextReader('<meta name="vn-game-protocol" content="2"><style>body{padding-top:100px}</style><button id="finish" disabled>Finish</button><script>let init;addEventListener("message",e=>{if(e.data.type==="gameInit"){init=e.data;finish.disabled=false;}});finish.onclick=()=>parent.postMessage({...init,type:"gameResult",result:1},"*");</script>'));
  await zip.add("novel.html", new TextReader('<style>body{padding-top:100px}</style><h1>Novel remains open</h1><iframe src="legacy.html"></iframe>'));
  const buffer = Buffer.from(await (await zip.close()).arrayBuffer());
  const chooser = page.waitForEvent("filechooser");
  await page.locator("#addArchiveButton").click();
  await (await chooser).setFiles({ name: "completion.zip", mimeType: "application/zip", buffer });
  await expect(page.locator(".archive-entry")).toHaveCount(2);
  await expect(page.locator("#appMenuClose")).toBeEnabled();
  await page.locator("#viewerMenuTabSetting").check();
  await page.locator("#appMenuClose").click();
  const frame = page.frameLocator("#siteFrame");
  for (const name of ["Legacy", "V2", "V2"]) {
    await frame.getByText(name, { exact: true }).click();
    await expect(page.locator("#viewerToolbar")).toHaveClass(/is-hidden/);
    await frame.getByRole("button", { name: "Finish" }).click();
    await expect(frame.getByText("Legacy", { exact: true })).toBeVisible();
    await expect(page.locator("#viewerToolbar")).toHaveClass(/is-hidden/);
  }
  // Resizing and focus movement inside the page must not reveal the strip.
  await page.setViewportSize({ width: 1100, height: 800 });
  await expect(page.locator("#viewerToolbar")).toHaveClass(/is-hidden/);
  await page.evaluate(async () => {
    Object.defineProperty(document, "hasFocus", { configurable: true, value: () => true });
    window.dispatchEvent(new Event("blur"));
    await new Promise(resolve => setTimeout(resolve, 10));
    window.dispatchEvent(new Event("focus"));
  });
  await expect(page.locator("#viewerToolbar")).toHaveClass(/is-hidden/);
  // Model desktop browser deactivation/restoration, including its focused iframe.
  await page.evaluate(async () => {
    Object.defineProperty(document, "hasFocus", { configurable: true, value: () => false });
    window.dispatchEvent(new Event("blur"));
    await new Promise(resolve => setTimeout(resolve, 10));
    Object.defineProperty(document, "hasFocus", { configurable: true, value: () => true });
    document.querySelector("#siteFrame").contentWindow.dispatchEvent(new Event("focus"));
    delete document.hasFocus;
  });
  await expect(page.locator("#viewerToolbar")).toHaveClass(/is-hidden/);
  await frame.getByText("Novel", { exact: true }).click();
  await frame.frameLocator("iframe").getByRole("button", { name: "Finish" }).click();
  // Also target the outer PWA directly: source must still be rejected.
  const child = page.frames().find(f => f.url().endsWith("/legacy.html"));
  await child.evaluate(() => top.postMessage({ type: "gameResult", result: 1 }, "*"));
  await expect(frame.getByRole("heading", { name: "Novel remains open" })).toBeVisible();
  await page.locator("#viewerMenuTab").click();
  await page.locator("#viewerBack").click();
  await expect(frame.getByText("Legacy", { exact: true })).toBeVisible();
});
