import { test, expect } from "@playwright/test";
import { BlobWriter, TextReader, ZipWriter } from "@zip.js/zip.js";

async function openSettings(page) {
  await page.addInitScript(() => Object.defineProperty(navigator, "standalone", { get: () => true }));
  await page.goto("./");
  await expect(page.locator("#statusText")).toHaveText("Сайт готов к автономной работе");
  await page.locator("#viewerMenuTabSetting").check();
}

async function geometry(page) {
  return page.evaluate(() => {
    const rect = selector => {
      const { top, bottom, width, height } = document.querySelector(selector).getBoundingClientRect();
      return { top, bottom, width, height };
    };
    return { frame: rect(".viewer-content-frame"), toolbar: rect("#viewerToolbar"), tab: rect("#viewerMenuTab"), height: innerHeight };
  });
}

for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
  test.describe(`viewer toolbar at ${viewport.width}px`, () => {
    test.use({ viewport });

    test("startup expires, manual toggle stays open, and returning never reveals the overlay", async ({ page }, testInfo) => {
      await openSettings(page);
      await expect(page.locator("#viewerToolbarPinnedSetting")).not.toBeChecked();
      await page.locator("#appMenuClose").click();
      const toolbar = page.locator("#viewerToolbar");
      const tab = page.locator("#viewerMenuTab");
      await expect(toolbar).toHaveClass(/is-counting/);
      await expect(tab).toHaveAttribute("aria-expanded", "true");
      expect((await geometry(page)).frame.top).toBe(0);
      const slideSample = page.evaluate(() => new Promise(resolve => {
        const toolbar = document.querySelector("#viewerToolbar");
        const timeout = setTimeout(() => { toolbar.removeEventListener("transitionrun", sample); resolve(null); }, 8000);
        function sample(event) {
          if (event.propertyName !== "transform" || !toolbar.classList.contains("is-hidden")) return;
          toolbar.removeEventListener("transitionrun", sample);
          clearTimeout(timeout);
          const animation = toolbar.getAnimations().find(item => item.transitionProperty === "transform");
          if (!animation) { resolve(null); return; }
          animation.pause();
          animation.currentTime = animation.effect.getTiming().duration / 2;
          const { top, bottom } = toolbar.getBoundingClientRect();
          const opacity = getComputedStyle(toolbar).opacity;
          animation.play();
          resolve({ top, bottom, opacity });
        }
        toolbar.addEventListener("transitionrun", sample);
      }));
      await expect(toolbar).toHaveClass(/is-hidden/, { timeout: 8000 });
      const sample = await slideSample;
      expect(sample).not.toBeNull();
      expect(sample.top).toBeLessThan(0);
      expect(sample.bottom).toBeGreaterThan(0);
      expect(sample.opacity).toBe("1");
      await expect(tab).toHaveAttribute("aria-expanded", "false");
      await expect.poll(async () => (await geometry(page)).toolbar.bottom).toBeLessThanOrEqual(0);
      const hiddenGeometry = await geometry(page);
      await page.evaluate(() => {
        window.dispatchEvent(new Event("blur"));
        window.dispatchEvent(new Event("focus"));
        document.querySelector("#siteFrame").contentWindow.dispatchEvent(new Event("focus"));
        Object.defineProperty(document, "hidden", { configurable: true, value: true });
        document.dispatchEvent(new Event("visibilitychange"));
        Object.defineProperty(document, "hidden", { configurable: true, value: false });
        document.dispatchEvent(new Event("visibilitychange"));
        delete document.hidden;
      });
      await expect(toolbar).toHaveClass(/is-hidden/);
      await tab.click();
      await expect(tab).toHaveAttribute("aria-expanded", "true");
      await expect(toolbar).not.toHaveClass(/is-counting/);
      await expect.poll(async () => {
        const { tab, toolbar } = await geometry(page);
        return Math.abs(tab.top - toolbar.bottom);
      }).toBeLessThan(1);
      expect((await geometry(page)).frame).toEqual(hiddenGeometry.frame);
      await page.waitForTimeout(5500);
      await expect(toolbar).not.toHaveClass(/is-hidden/);
      await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
      await expect(toolbar).not.toHaveClass(/is-counting/);
      await page.locator("#viewerClose").click();
      await expect(page.locator("#viewer")).toBeHidden();
      await page.locator("#appMenuClose").click();
      await expect(page.locator("#viewer")).toBeVisible();
      await expect(toolbar).not.toHaveClass(/is-hidden|is-counting/);
      await page.locator("#viewer").screenshot({ path: testInfo.outputPath("toolbar-overlay.png") });
      await tab.click();
      await expect(toolbar).toHaveClass(/is-hidden/);
      await expect(toolbar).toHaveAttribute("inert", "");
      await page.frameLocator("#siteFrame").locator("#demoMenuButton").click();
      await page.locator("#appMenuClose").click();
      await expect(page.locator("#viewer")).toBeVisible();
      await expect(toolbar).toHaveClass(/is-hidden/);
    });

    test("settings never restart the startup timer, including after selecting another archive", async ({ page }) => {
      page.on("dialog", dialog => dialog.accept());
      await openSettings(page);
      await page.locator("#appMenuClose").click();
      const toolbar = page.locator("#viewerToolbar");
      await expect(toolbar).toHaveClass(/is-counting/);
      await page.locator("#viewerClose").click();
      for (let visit = 0; visit < 2; visit++) {
        await page.locator("#appMenuClose").click();
        await expect(page.locator("#viewer")).toBeVisible();
        await expect(toolbar).not.toHaveClass(/is-hidden|is-counting/);
        await page.locator("#viewerClose").click();
      }
      await page.locator("#appMenuClose").click();
      await expect(page.locator("#viewer")).toBeVisible();
      await page.waitForTimeout(5500);
      await expect(toolbar).not.toHaveClass(/is-hidden|is-counting/);
      await page.locator("#viewerMenuTab").click();
      await expect(toolbar).toHaveClass(/is-hidden/);
      await page.frameLocator("#siteFrame").locator("#demoMenuButton").click();
      const zip = new ZipWriter(new BlobWriter());
      await zip.add("index.html", new TextReader("<!doctype html><h1>Another archive</h1>"));
      const buffer = Buffer.from(await (await zip.close()).arrayBuffer());
      const chooser = page.waitForEvent("filechooser");
      await page.locator("#addArchiveButton").click();
      await (await chooser).setFiles({ name: "another.zip", mimeType: "application/zip", buffer });
      await expect(page.locator(".archive-entry")).toHaveCount(2);
      await page.locator("#appMenuClose").click();
      await expect(page.frameLocator("#siteFrame").locator("h1")).toHaveText("Another archive");
      await expect(toolbar).toHaveClass(/is-hidden/);
      await expect(toolbar).not.toHaveClass(/is-counting/);
    });

    test("pinned setting reserves space, survives reload and restores full height when disabled", async ({ page }, testInfo) => {
      await openSettings(page);
      const pinned = page.locator("#viewerToolbarPinnedSetting");
      await expect(pinned).not.toBeChecked();
      await pinned.check();
      await page.locator("#viewerAspectRatio").selectOption("10:16");
      await page.locator("#appMenuClose").click();
      const assertPinned = async () => {
        await expect(page.locator("#viewer")).toHaveClass(/is-toolbar-pinned/);
        await expect(page.locator("#viewer")).not.toHaveClass(/is-portrait-frame-mode/);
        await expect(page.locator("#viewerMenuTab")).toBeHidden();
        await expect(page.locator("#viewerToolbar")).not.toHaveClass(/is-hidden|is-counting/);
        await expect.poll(async () => {
          const { frame, toolbar } = await geometry(page);
          return Math.abs(frame.top - toolbar.bottom);
        }).toBeLessThan(1);
        const { frame, toolbar, height } = await geometry(page);
        expect(frame.bottom).toBeCloseTo(height, 0);
        expect(frame.width).toBeCloseTo(Math.min(viewport.width, (height - toolbar.height) * 10 / 16), 0);
      };
      await assertPinned();
      await page.waitForTimeout(5500);
      await assertPinned();
      await page.reload();
      await expect(pinned).toBeChecked();
      await expect(page.locator("#viewer")).toBeVisible();
      await assertPinned();
      await page.locator("#viewer").screenshot({ path: testInfo.outputPath("toolbar-pinned.png") });
      await page.locator("#viewerClose").click();
      await pinned.uncheck();
      await page.locator("#appMenuClose").click();
      await expect(page.locator("#viewer")).toBeVisible();
      await expect(page.locator("#viewer")).not.toHaveClass(/is-toolbar-pinned/);
      expect((await geometry(page)).frame.top).toBe(0);
      expect((await geometry(page)).frame.height).toBe(viewport.height);
      expect(await page.evaluate(() => localStorage.getItem("gamespace:viewer-toolbar-pinned:v1"))).toBe("0");
    });
  });
}
