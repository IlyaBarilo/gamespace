// Builds an isolated production package; test releases never enter release-packages/.
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdtemp, mkdir, cp, rm, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { build } from "vite";
import { projectDirectory, assertInside, listFiles, readJson } from "./release-utils.mjs";
import { findSevenZip } from "./verify-demo-archive.mjs";

const working = await mkdtemp(path.join(projectDirectory, ".codex-e2e-release-"));
const built = path.join(working, "dist");
const releases = path.join(working, "packages");
const pages = path.join(working, "pages");
const { version } = await readJson(path.join(projectDirectory, "package.json"));
const [major, minor, patch] = version.split(".").map(Number);
const goodVersion = `${major}.${minor}.${patch + 1}`;
const brokenVersion = `${major}.${minor}.${patch + 2}`;
const env = { ...process.env, GAMESPACE_DIST_DIRECTORY: built, GAMESPACE_RELEASES_DIRECTORY: releases, GAMESPACE_PAGES_OUTPUT_DIRECTORY: pages };

async function run(script, args = []) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(projectDirectory, "scripts", script), ...args], { cwd: projectDirectory, env, stdio: "inherit", windowsHide: true });
    child.on("error", reject);
    child.on("exit", code => code === 0 ? resolve() : reject(new Error(`${script}: exit ${code}`)));
  });
}

async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`.replaceAll("\n", "\r\n"));
}

async function fixtureRelease(nextVersion, broken = false) {
  const target = path.join(releases, nextVersion);
  await cp(path.join(releases, version), target, { recursive: true });
  // These are synthetic future releases used only by browser tests. Production
  // source/version files and the immutable runtime are never rewritten.
  for (const relative of await listFiles(target)) {
    if (relative === "sw-runtime-v1.js" || !/\.(js|html|json)$/.test(relative)) continue;
    const file = path.join(target, relative);
    const original = await readFile(file, "utf8");
    await writeFile(file, original.replaceAll(version, nextVersion));
  }
  if (broken) {
    await writeFile(path.join(target, "index.html"), '<!doctype html><html><body><p id="broken-release">Broken startup fixture</p></body></html>\r\n');
  }
  const manifest = await readJson(path.join(target, "release.json"));
  manifest.version = nextVersion;
  manifest.description = broken ? "E2E: сбой первого запуска" : "E2E: успешное обновление";
  manifest.totalSize = 0;
  for (const file of manifest.files) {
    const bytes = await readFile(path.join(target, file.path));
    file.size = bytes.length;
    file.sha256 = createHash("sha256").update(bytes).digest("hex");
    manifest.totalSize += file.size;
  }
  await writeJson(path.join(target, "release.json"), manifest);
}

async function cleanup() {
  const resolved = await realpath(working);
  assertInside(projectDirectory, resolved);
  if (!path.basename(resolved).startsWith(".codex-e2e-release-")) throw new Error("Unexpected test directory");
  await rm(resolved, { recursive: true, force: true, maxRetries: 3 });
}

let server;
try {
  await run("sync-demo.mjs");
  await build({ configFile: path.join(projectDirectory, "vite.config.js"), root: projectDirectory, build: { outDir: built } });
  await run("prepare-release.mjs");
  await run("verify-release-source.mjs");
  await fixtureRelease(goodVersion);
  await fixtureRelease(brokenVersion, true);
  await run("verify-releases.mjs");
  await run("verify-runtime.mjs");
  await run("assemble-pages.mjs", [version]);
  const root = path.join(pages, version);
  const archiveSource = path.join(working, "archive-fixture");
  await mkdir(path.join(archiveSource, "site"), { recursive: true });
  await mkdir(path.join(archiveSource, "__MACOSX"));
  await writeFile(path.join(archiveSource, "index.html"), "<!doctype html><title>System files fixture</title>\r\n");
  await writeFile(path.join(archiveSource, "site", ".DS_Store"), "ignored metadata");
  await writeFile(path.join(archiveSource, "__MACOSX", "._index.html"), "ignored resource fork");
  const archive = path.join(working, "system-files.7z");
  const zipped = spawnSync(findSevenZip(), ["a", "-t7z", archive, "index.html", "site", "__MACOSX"], { cwd: archiveSource, windowsHide: true, encoding: "utf8" });
  if (zipped.error || zipped.status !== 0) throw new Error(`Cannot create isolated 7z fixture: ${zipped.error || zipped.stderr}`);
  const corruptManifest = await readJson(path.join(root, "releases", goodVersion, "release.json"));
  corruptManifest.version = `${major}.${minor}.${patch + 3}`;
  corruptManifest.files.find(file => file.path.endsWith(".js")).sha256 = "0".repeat(64);
  const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".wasm": "application/wasm", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml" };
  server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://127.0.0.2:4177");
      if (url.pathname === "/__e2e_shutdown__" && request.method === "POST") {
        await cleanup();
        response.writeHead(200, { Connection: "close" }); response.end("stopped");
        server.close();
        setImmediate(() => { server.closeAllConnections(); process.exit(0); });
        return;
      }
      if (url.pathname === "/__e2e_versions__") {
        response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        response.end(JSON.stringify({ version, goodVersion, brokenVersion })); return;
      }
      if (url.pathname === "/__e2e_archive__") {
        response.writeHead(200, { "Content-Type": "application/x-7z-compressed" }); response.end(await readFile(archive)); return;
      }
      // A subdirectory reproduces GitHub Pages deployment paths.
      if (!url.pathname.startsWith("/gamespace/")) { response.writeHead(404); response.end(); return; }
      let relative = decodeURIComponent(url.pathname.slice("/gamespace/".length)) || "index.html";
      if (relative === "releases/corrupt/release.json") {
        response.writeHead(200, { "Content-Type": "application/json" }); response.end(JSON.stringify(corruptManifest)); return;
      }
      if (relative.startsWith("releases/corrupt/")) relative = relative.replace("releases/corrupt/", `releases/${goodVersion}/`);
      const absolute = path.resolve(root, relative);
      assertInside(root, absolute);
      const file = (await stat(absolute)).isDirectory() ? path.join(absolute, "index.html") : absolute;
      const bytes = await readFile(file);
      response.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream", "Content-Length": bytes.length, "Cache-Control": "no-store" });
      response.end(request.method === "HEAD" ? undefined : bytes);
    } catch (error) { response.writeHead(error.code === "ENOENT" ? 404 : 500); response.end(); }
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(4177, "127.0.0.2", resolve); });
  console.log("Production release test server: http://127.0.0.2:4177/gamespace/");
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => {
    server.closeAllConnections(); server.close(); void cleanup().then(() => process.exit(0), () => process.exit(1));
  });
} catch (error) {
  server?.close(); await cleanup(); throw error;
}
