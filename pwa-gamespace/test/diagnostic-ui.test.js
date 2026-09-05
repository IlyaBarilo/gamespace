import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("diagnostic controls exist on both app and landing surfaces, with manual-copy fallback", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  for (const id of ["diagnosticDialog", "diagnosticText", "diagnosticCopy", "diagnosticShare", "diagnosticClose", "lastErrorButton", "landingLastErrorButton", "errorDetailsButton", "manualReportButton", "landingReportButton", "viewerReport", "viewerMenuToggle"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /<textarea id="diagnosticText" readonly/);
  assert.match(html, /Автоматической отправки нет/);
  assert.match(html, /<details class="browser-compatibility-note">\s*<summary>Если импортированная игра стала работать иначе<\/summary>/);
  assert.doesNotMatch(html, /<details class="browser-compatibility-note" open>/);
  assert.match(html, /На Android: откройте меню браузера и выберите «Установить приложение»/);
  assert.doesNotMatch(html, /«Установить приложение» или «Добавить на главный экран»/);
  const ui = await readFile(new URL("../src/diagnostic-ui.js", import.meta.url), "utf8");
  assert.match(ui, /\.value = report\?\.text/);
  assert.match(ui, /setSelectionRange\(0, elements\.diagnosticText\.value\.length\)/);
  assert.doesNotMatch(ui, /innerHTML|outerHTML|fetch\(/);
});

test("install action distinguishes a browser prompt from manual installation", async () => {
  const app = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(app, /Как установить GameSpace/);
  assert.match(app, /Через меню браузера/);
  assert.match(app, /installPrompt[\s\S]*Открыть окно установки/);
  assert.match(html, /ДОВЕРЕННЫЙ РЕЖИМ/);
  assert.match(html, /JavaScript и localStorage/);
  assert.doesNotMatch(html, /СОВМЕСТИМЫЙ РЕЖИМ/);
});

test("report dialog remains usable while import controls are busy", async () => {
  const app = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
  const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(app, /button\.closest\("#viewer, #diagnosticDialog"\)/);
  assert.match(styles, /body\.is-busy button:not\(#errorClose\):not\(#diagnosticDialog button\)/);
  assert.match(styles, /:not\(\.diagnostic-trigger\)/);
});

test("site removal does not erase separately stored diagnostics", async () => {
  const manager = await readFile(new URL("../src/import-manager.js", import.meta.url), "utf8");
  const database = await readFile(new URL("../src/db.js", import.meta.url), "utf8");
  assert.doesNotMatch(manager + database, /localStorage\.clear|gamespace:last-error/);
});
