import { test, expect } from "@playwright/test";
import { BlobWriter, TextReader, ZipWriter } from "@zip.js/zip.js";
import { readFile } from "node:fs/promises";

function game(kind, fps, mode = "normal") {
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:#071527}canvas{display:block;width:100%;height:100%}#small{width:30px;height:30px;position:absolute;right:0;top:0}</style></head><body><canvas id="main" width="360" height="600"></canvas><script>
    const canvas=document.getElementById('main');
    const ctx=canvas.getContext('${kind}');
    window.beforeFps=Object.getPrototypeOf(ctx).${kind === "2d" ? "fillRect" : "clear"};
    window.oracle=[];window.paused=false;let due=0;
    const cached=ctx.${kind === "2d" ? "fillRect" : "clear"}.bind(ctx);
    ${mode.includes("aux") ? "const small=document.createElement('canvas');small.id='small';document.body.appendChild(small);const aux=small.getContext('2d');" : ""}
    function loop(t){
      ${mode.includes("aux") ? "aux.fillRect(0,0,30,30);" : ""}
      if(!window.paused&&t+.5>=due){due=t+1000/${fps};
        ${kind === "2d" ? (mode.includes("cached") ? "cached(0,0,360,600);" : "ctx.fillStyle='#126077';ctx.fillRect(0,0,360,600);for(let i=0;i<80;i++)ctx.fillRect((t/10+i)%330,i*7,15,4);") : "ctx.clearColor((t%1000)/1000,.2,.3,1);for(let i=0;i<80;i++)ctx.clear(ctx.COLOR_BUFFER_BIT);"}
        oracle.push(performance.now());
      }requestAnimationFrame(loop);
    }requestAnimationFrame(loop);
  </script></body></html>`;
}
async function install(page, entries) {
  page.on("dialog", dialog => dialog.accept());
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "standalone", { get: () => true });
    // These measurement fixtures intentionally exercise the floating content display.
    localStorage.setItem("gamespace:viewer-fps-position:v1", "top-left");
  });
  await page.goto("./");
  await expect(page.locator("#statusText")).toHaveText("Сайт готов к автономной работе");
  const zip = new ZipWriter(new BlobWriter("application/zip"));
  for (const [name, text] of Object.entries(entries)) await zip.add(name, new TextReader(text));
  const buffer = Buffer.from(await (await zip.close()).arrayBuffer());
  const chooser = page.waitForEvent("filechooser");
  await page.locator("#addArchiveButton").click();
  await (await chooser).setFiles({ name: "fps.zip", mimeType: "application/zip", buffer });
  await expect(page.locator(".archive-entry")).toHaveCount(2);
  await expect(page.locator("#statusText")).toHaveText("Сайт готов к автономной работе");
  await expect(page.locator("#appMenuClose")).toBeEnabled();
  // Measurements outlast the auto layout toolbar timer. Use the side-field controls.
  await page.locator("#viewerAspectRatio").selectOption("10:16");
}
async function openTestGame(page, file, { canvas = true } = {}) {
  await page.frameLocator("#siteFrame").locator('a[href="' + file + '"]').click();
  await expect.poll(() => page.locator("#siteFrame").evaluate((frame, file) => {
    const win = frame.contentWindow;
    return new URL(win.location.href).pathname.endsWith("/" + file)
      && win.__gamespaceCanvasFps?.running === true;
  }, file)).toBe(true);
  if (canvas) {
    await expect(page.frameLocator("#siteFrame").locator("#main")).toBeVisible();
    await expect.poll(() => page.locator("#siteFrame").evaluate(frame =>
      Array.isArray(frame.contentWindow.oracle))).toBe(true);
  }
}
async function measure(page) {
  return page.locator("#siteFrame").evaluate(frame => {
    const win = frame.contentWindow;
    const sample = win.__gamespaceCanvasFps.snapshot();
    const times = win.oracle.filter(time => time > sample.time - 5000 && time <= sample.time);
    return { ...sample, oracle: times.length / 5 };
  });
}

test("FPS is opt-in, restores drawing methods, survives reload and never changes imported HTML", async ({ page, context }) => {
  const source = game("2d", 30);
  await install(page, { "index.html": source });
  await expect(page.locator("#viewerFpsSetting")).not.toBeChecked();
  await page.locator("#appMenuClose").click();
  const frame = page.frameLocator("#siteFrame");
  await expect(frame.locator("#main")).toBeVisible();
  expect(await page.locator("#siteFrame").evaluate(frame => typeof frame.contentWindow.__gamespaceCanvasFps)).toBe("undefined");
  await expect(frame.locator("[data-gamespace-fps]")).toHaveCount(0);
  await page.locator("#viewerClose").click();
  await page.locator("#viewerFpsSetting").check();
  await context.setOffline(true);
  await page.locator("#appMenuClose").click();
  await expect(frame.locator("[data-fps-current]")).toContainText("FPS ≈");
  await page.waitForTimeout(650);
  expect((await measure(page)).fps.average).toBeGreaterThan(20);
  expect(await page.locator("#siteFrame").evaluate(async frame => (await fetch(frame.contentWindow.location.href)).text())).toBe(source);
  await frame.locator("#main").evaluate(() => localStorage.clear());
  await page.locator("#viewerClose").click();
  await expect(page.locator("#viewerFpsSetting")).toBeChecked();
  await page.reload();
  await expect(frame.locator("[data-fps-current]")).toContainText("FPS ≈");
  const oldWindow = await page.locator("#siteFrame").evaluateHandle(frame => frame.contentWindow);
  await page.locator("#viewerClose").click();
  expect(await oldWindow.evaluate(win => typeof win.__gamespaceCanvasFps)).toBe("undefined");
  await oldWindow.dispose();
  await page.locator("#viewerFpsSetting").uncheck();
  await page.locator("#appMenuClose").click();
  await expect.poll(async () => page.locator("#siteFrame").evaluate(frame => typeof frame.contentWindow.beforeFps === "function"
    && frame.contentWindow.CanvasRenderingContext2D.prototype.fillRect === frame.contentWindow.beforeFps)).toBe(true);
  await expect(frame.locator("[data-gamespace-fps]")).toHaveCount(0);
});

test("late-attached PWA monitor measures Canvas2D, WebGL and WebGL2 at 10/30/60 FPS", async ({ page }) => {
  test.setTimeout(180_000);
  const entries = {};
  const cases = [];
  for (const kind of ["2d", "webgl", "webgl2"]) for (const fps of [10, 30, 60]) {
    const file = `${kind}-${fps}.html`;
    cases.push({ kind, fps, file }); entries[file] = game(kind, fps);
  }
  entries["index.html"] = `<!doctype html><h1>FPS tests</h1>${cases.map(item => `<a href="${item.file}">${item.file}</a>`).join("<br>")}`;
  await install(page, entries);
  await page.locator("#viewerFpsSetting").check();
  await page.locator("#appMenuClose").click();
  for (const item of cases) {
    await openTestGame(page, item.file);
    await expect(page.frameLocator("#siteFrame").locator("[data-fps-current]")).toContainText("FPS ≈");
    await page.waitForTimeout(5700);
    const result = await measure(page);
    expect(result.kind).toBe(item.kind);
    expect(Math.abs(result.fps.average - result.oracle), JSON.stringify(result)).toBeLessThanOrEqual(1);
    expect(result.fps.average).toBeGreaterThan(0);
    expect(result.oracle).toBeLessThanOrEqual(item.fps + 2);
    expect(result.fps.current).toBeLessThanOrEqual(item.fps + 2);
    await page.locator("#viewerBack").click();
    await expect(page.frameLocator("#siteFrame").locator("h1")).toHaveText("FPS tests");
  }
});

test("the monitor handles pause, hidden documents, unknown large canvas and cached methods honestly", async ({ page }) => {
  await install(page, { "index.html": '<!doctype html><a href="aux.html">aux</a><a href="cached.html">cached</a><a href="dom.html">dom</a>',
    "aux.html": game("2d", 30, "aux"), "cached.html": game("2d", 30, "cached-aux"), "dom.html": "<!doctype html><h1>DOM only</h1>" });
  await page.locator("#viewerFpsSetting").check();
  await page.locator("#appMenuClose").click();
  await expect(page.frameLocator("#siteFrame").locator("[data-fps-current]")).toHaveText("FPS недоступен");
  await openTestGame(page, "aux.html");
  await expect.poll(async () => (await measure(page)).canvasId).toBe("main");
  await page.waitForTimeout(1400);
  expect((await measure(page)).fps.average).toBeLessThan(35);
  await page.locator("#siteFrame").evaluate(frame => { frame.contentWindow.paused = true; });
  await expect.poll(async () => (await measure(page)).fps.current).toBe(0);
  await page.locator("#siteFrame").evaluate(frame => { frame.contentWindow.paused = false; });
  await expect.poll(async () => (await measure(page)).fps.current).toBeGreaterThan(0);
  await page.locator("#siteFrame").evaluate(frame => {
    const win = frame.contentWindow;
    Object.defineProperty(win.document, "hidden", { configurable: true, value: true });
    win.document.dispatchEvent(new win.Event("visibilitychange"));
  });
  expect((await measure(page)).status).toBe("paused");
  await page.locator("#siteFrame").evaluate(frame => {
    const win = frame.contentWindow;
    Object.defineProperty(win.document, "hidden", { configurable: true, value: false });
    win.document.dispatchEvent(new win.Event("visibilitychange"));
  });
  await expect.poll(async () => (await measure(page)).fps.windowMs).toBeLessThan(5000);
  await page.locator("#viewerBack").click();
  await openTestGame(page, "cached.html");
  await expect(page.frameLocator("#siteFrame").locator("[data-fps-current]")).toHaveText("FPS недоступен");
  await page.locator("#viewerBack").click();
  await openTestGame(page, "dom.html", { canvas: false });
  await expect(page.frameLocator("#siteFrame").locator("[data-fps-current]")).toHaveText("FPS недоступен");
});

test("APK asset starts after scripts have created contexts and can be stopped and restarted", async ({ page }) => {
  const script = await readFile(new URL("../../apk-gamespace/android-webview-loader/app/src/main/assets/canvas-fps-runtime.js", import.meta.url), "utf8");
  await page.setContent(game("2d", 30));
  await page.addScriptTag({ content: script });
  await page.evaluate(() => GameSpaceCanvasFps.start(window));
  await expect(page.locator("[data-fps-current]")).toContainText("FPS ≈");
  await page.waitForTimeout(1000);
  const sample = await page.evaluate(() => __gamespaceCanvasFps.snapshot());
  expect(sample.fps.average).toBeGreaterThan(20);
  expect(sample.fps.average).toBeLessThan(35);
  await page.evaluate(() => { const monitor = window.__gamespaceCanvasFps; monitor.stop(); monitor.stop(); });
  await expect(page.locator("[data-gamespace-fps]")).toHaveCount(0);
  expect(await page.evaluate(() => CanvasRenderingContext2D.prototype.fillRect === beforeFps)).toBe(true);
  await page.evaluate(() => GameSpaceCanvasFps.start(window));
  await expect(page.locator("[data-fps-current]")).toContainText("FPS ≈");
});
