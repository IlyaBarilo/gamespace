import { test, expect } from "@playwright/test";
import { BlobWriter, TextReader, ZipWriter } from "@zip.js/zip.js";
import { readFile } from "node:fs/promises";

const source = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:#123}canvas{width:100%;height:100%;display:block}button{position:fixed;inset:0;opacity:0}</style></head><body><canvas width="400" height="700"></canvas><button aria-label="under FPS" onclick="window.clicks++"></button><script>window.clicks=0;const ctx=document.querySelector('canvas').getContext('2d');function draw(){ctx.fillRect(0,0,400,700);requestAnimationFrame(draw)}draw();</script></body></html>`;
const positions = ["top-left", "top-right", "bottom-left", "bottom-right", "middle-left"];
const key = "gamespace:viewer-fps-position:v1";

async function prepare(page) {
  page.on("dialog", dialog => dialog.accept());
  await page.addInitScript(() => Object.defineProperty(navigator, "standalone", { get: () => true }));
  await page.goto("./");
  await expect(page.locator("#statusText")).toHaveText("Сайт готов к автономной работе");
  const zip = new ZipWriter(new BlobWriter("application/zip"));
  await zip.add("index.html", new TextReader(source));
  const buffer = Buffer.from(await (await zip.close()).arrayBuffer());
  const chooser = page.waitForEvent("filechooser");
  await page.locator("#addArchiveButton").click();
  await (await chooser).setFiles({ name: "positions.zip", mimeType: "application/zip", buffer });
  await expect(page.locator(".archive-entry")).toHaveCount(2);
  await expect(page.locator("#appMenuClose")).toBeEnabled();
  await expect(page.locator("#viewerFpsPositionControls")).toBeHidden();
  await page.locator("#viewerFpsSetting").check();
  await expect(page.locator("#viewerFpsPosition")).toBeVisible();
}
async function anchor(host, position) {
  await expect(host).toHaveAttribute("data-fps-position", position);
  const r = await host.evaluate(node => {
    const r = node.getBoundingClientRect(), win = node.ownerDocument.defaultView;
    return { left: r.left, right: win.innerWidth - r.right, top: r.top, bottom: win.innerHeight - r.bottom, middle: (r.top + r.bottom) / 2 - win.innerHeight / 2 };
  });
  expect(Math.abs(r[position.endsWith("right") ? "right" : "left"] - 8)).toBeLessThan(2);
  expect(Math.abs(position === "middle-left" ? r.middle : r[position.startsWith("bottom") ? "bottom" : "top"] - 8)).toBeLessThan(2);
}

test("five content positions preserve the running monitor, pass clicks and survive reload and archive storage", async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await prepare(page);
  await page.locator("#viewerFpsPosition").selectOption("middle-left");
  await page.locator("#appMenuClose").click();
  const host = page.frameLocator("#siteFrame").locator("[data-gamespace-fps]");
  await expect(host).toBeVisible();
  await expect(page.locator("#viewerToolbar")).toHaveClass(/is-hidden/, { timeout: 8000 });
  await page.locator("#siteFrame").evaluate(frame => { frame.contentWindow.firstMonitor = frame.contentWindow.__gamespaceCanvasFps; });
  for (const position of positions) {
    // Use the same change handler while the viewer remains mounted to verify no reset.
    await page.locator("#viewerFpsPosition").evaluate((select, value) => {
      select.value = value; select.dispatchEvent(new Event("change"));
    }, position);
    await anchor(host, position);
    expect(await page.locator("#siteFrame").evaluate(frame => frame.contentWindow.firstMonitor === frame.contentWindow.__gamespaceCanvasFps)).toBe(true);
    const box = await host.boundingBox();
    await page.mouse.click(box.x + 15, box.y + 15);
  }
  expect(await page.locator("#siteFrame").evaluate(frame => frame.contentWindow.clicks)).toBe(5);
  await page.locator("#siteFrame").evaluate(frame => frame.contentWindow.localStorage.clear());
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.locator("#viewerClose").click();
  await expect(page.locator("#viewerFpsPosition")).toHaveValue("middle-left");
  await page.locator("#viewerFpsSetting").uncheck();
  await expect(page.locator("#viewerFpsPositionControls")).toBeHidden();
  await page.locator("#viewerFpsSetting").check();
  await expect(page.locator("#viewerFpsPosition")).toHaveValue("middle-left");
  await page.locator("#appMenuClose").click();
  await context.setOffline(true);
  await page.reload();
  await anchor(host, "middle-left");
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe("middle-left");
  await page.setViewportSize({ width: 844, height: 390 });
  await anchor(host, "middle-left");
});

test("black-field placement moves between shell and game on resize/fullscreen and cleans up", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await prepare(page);
  await page.locator("#viewerAspectRatio").selectOption("10:16");
  await page.locator("#viewerFpsPosition").selectOption("black-field");
  await page.locator("#appMenuClose").click();
  const outside = page.locator("#viewer > [data-gamespace-fps]");
  const inside = page.frameLocator("#siteFrame").locator("[data-gamespace-fps]");
  await expect(outside).toBeVisible();
  await expect(inside).toHaveCount(0);
  const rect = await outside.boundingBox(), frame = await page.locator("#siteFrame").boundingBox();
  expect(rect.x + rect.width).toBeLessThan(frame.x);
  await page.locator("#siteFrame").evaluate(frame => { frame.contentWindow.firstMonitor = frame.contentWindow.__gamespaceCanvasFps; });
  await page.setViewportSize({ width: 390, height: 844 });
  await anchor(inside, "top-left");
  await expect(outside).toHaveCount(0);
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(outside).toBeVisible();
  await page.setViewportSize({ width: 700, height: 690 }); // landscape, but gutter is too narrow
  await anchor(inside, "top-left");
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(outside).toBeVisible();
  await page.locator("#siteFrame").evaluate(frame => frame.contentDocument.body.requestFullscreen());
  await anchor(inside, "top-left");
  await expect(outside).toHaveCount(0);
  await page.locator("#siteFrame").evaluate(frame => frame.contentDocument.exitFullscreen());
  await expect(outside).toBeVisible();
  expect(await page.locator("#siteFrame").evaluate(frame => frame.contentWindow.firstMonitor === frame.contentWindow.__gamespaceCanvasFps)).toBe(true);
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe("black-field");
  await page.reload();
  await expect(outside).toBeVisible();
  await page.locator("#viewerClose").click();
  await expect(outside).toHaveCount(0);
  await expect(page.locator("#viewerFpsPosition")).toHaveValue("black-field");
});

test("APK runtime moves all five anchors without replacing its monitor or swallowing taps", async ({ page }) => {
  const script = await readFile(new URL("../../apk-gamespace/android-webview-loader/app/src/main/assets/canvas-fps-runtime.js", import.meta.url), "utf8");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.setContent(source);
  await page.addScriptTag({ content: script });
  await page.evaluate(() => { window.originalMonitor = GameSpaceCanvasFps.start(window); });
  const host = page.locator("[data-gamespace-fps]");
  await expect(host).toBeVisible();
  await page.waitForTimeout(600);
  for (const position of positions) {
    const times = await page.evaluate(position => {
      const before = __gamespaceCanvasFps.snapshot().fps.windowMs;
      const same = GameSpaceCanvasFps.start(window, { position }) === originalMonitor;
      return { same, before, after: __gamespaceCanvasFps.snapshot().fps.windowMs };
    }, position);
    expect(times.same).toBe(true);
    expect(times.after).toBeGreaterThanOrEqual(times.before);
    await anchor(host, position);
    const box = await host.boundingBox();
    await page.mouse.click(box.x + 15, box.y + 15);
  }
  expect(await page.evaluate(() => clicks)).toBe(5);
  await page.setViewportSize({ width: 844, height: 390 });
  await anchor(host, "middle-left");
  await page.evaluate(() => { __gamespaceCanvasFps.stop(); GameSpaceCanvasFps.start(window, { position: "invalid" }); });
  await anchor(host, "top-left");
});
