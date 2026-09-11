import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve, join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

// Optional Chromium check of the APK's actual CSP, not Android WebView settings.
const [playwrightModule, java] = process.argv.slice(2);
if (!playwrightModule || !java) throw new Error("Usage: node webview-policy.browser.mjs <installed playwright/index.mjs> <java executable>");
const { chromium } = await import(pathToFileURL(resolve(playwrightModule)).href);
const apkRoot = fileURLToPath(new URL("../", import.meta.url));
const csp = execFileSync(java, ["-cp", join(apkRoot, "android-webview-loader/app/build/diagnostics-tests"),
  "ru.local.gamespace.loader.AppUpdateTest", "--csp"], { encoding: "utf8" });
const origin = "https://content.gamespace.local";
const browser = await chromium.launch({ headless: true });
let externalRequests = 0;
let socketRequests = 0;
const timeout = setTimeout(() => { void browser.close(); }, 20000);
try {
  const context = await browser.newContext();
  const worker = `onmessage=async()=>{let blocked=false;try{await fetch('https://network-test.invalid/worker')}catch{blocked=true}postMessage({blocked,local:await(await fetch('/data.txt')).text()})}`;
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    if (process.env.GAMESPACE_POLICY_DEBUG) console.log("request", url.href);
    if (url.origin !== origin) { externalRequests++; return route.abort(); }
    const headers = { "Content-Security-Policy": csp, "Cache-Control": "no-store" };
    if (url.pathname === "/worker.js") return route.fulfill({ headers, contentType: "text/javascript", body: worker });
    if (url.pathname === "/data.txt") return route.fulfill({ headers, contentType: "text/plain", body: "local file" });
    if (url.pathname === "/local.js") return route.fulfill({ headers, contentType: "text/javascript", body: "window.localScript=true" });
    return route.fulfill({ headers, contentType: "text/html", body: '<!doctype html><meta charset="utf-8"><title>APK policy fixture</title><script>window.inlineScript=true</script><script src="/local.js"></script>' });
  });
  const page = await context.newPage();
  page.on("websocket", () => { socketRequests++; });
  page.on("pageerror", error => console.error(error.message));
  page.on("console", message => { if (process.env.GAMESPACE_POLICY_DEBUG) console.log(message.type(), message.text()); });
  await page.goto(`${origin}/`);
  const result = await page.evaluate(async () => {
    const denied = async action => { try { await action(); return false; } catch { return true; } };
    const loadScript = src => new Promise((resolve, reject) => {
      const script = document.createElement("script"); script.src = src; script.onload = resolve; script.onerror = reject; document.body.append(script);
    });
    const workerResult = await new Promise((resolve, reject) => {
      const worker = new Worker("/worker.js"); worker.onmessage = e => { worker.terminate(); resolve(e.data); }; worker.onerror = reject; worker.postMessage("run");
    });
    const socketBlocked = await new Promise(resolve => {
      const socket = new WebSocket("wss://network-test.invalid/socket"); socket.onerror = () => resolve(true); socket.onopen = () => { socket.close(); resolve(false); };
    });
    const blob = URL.createObjectURL(new Blob(["blob file"]));
    const blobText = await (await fetch(blob)).text(); URL.revokeObjectURL(blob);
    const saved = "policy-smoke-save"; localStorage.setItem(saved, "42");
    const savedValue = localStorage.getItem(saved); localStorage.removeItem(saved);
    return {
      inline: window.inlineScript, localScript: window.localScript, eval: eval("6*7"),
      local: await (await fetch("/data.txt")).text(), data: await (await fetch("data:text/plain,data%20file")).text(), blob: blobText,
      fetchBlocked: await denied(() => fetch("https://network-test.invalid/fetch")),
      xhrBlocked: await denied(() => new Promise((resolve, reject) => { const xhr = new XMLHttpRequest(); xhr.open("GET", "https://network-test.invalid/xhr"); xhr.onload = resolve; xhr.onerror = reject; xhr.send(); })),
      scriptBlocked: await denied(() => loadScript("https://network-test.invalid/script.js")),
      workerResult, socketBlocked, savedValue,
    };
  });
  assert.deepEqual(result, {
    inline: true, localScript: true, eval: 42, local: "local file", data: "data file", blob: "blob file",
    fetchBlocked: true, xhrBlocked: true, scriptBlocked: true,
    workerResult: { blocked: true, local: "local file" }, socketBlocked: true, savedValue: "42",
  });
  assert.equal(externalRequests, 0, "CSP must reject requests before the network route");
  assert.equal(socketRequests, 0, "CSP must reject WebSocket before connection");
  console.log("APK CSP: local scripts/files/eval/data/blob/worker/saves work; external fetch/XHR/script/worker/WebSocket blocked in Chromium.");
} finally { clearTimeout(timeout); await browser.close(); }
