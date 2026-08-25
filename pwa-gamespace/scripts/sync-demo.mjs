import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(scriptDirectory, "..");
const targetArchive = path.resolve(projectDirectory, "public", "demo.7z");
const builderScript = path.resolve(projectDirectory, "..", "tools", "build-demo.ps1");
const powershell = process.platform === "win32" ? "powershell.exe" : "pwsh";
const args = ["-NoProfile"];
if (process.platform === "win32") args.push("-ExecutionPolicy", "Bypass");
args.push("-File", builderScript, "-OutputArchive", targetArchive);

await new Promise((resolve, reject) => {
  const child = spawn(powershell, args, { stdio: "inherit" });
  child.once("error", reject);
  child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`Сборка demo.7z завершилась с кодом ${code}.`)));
});

const archiveInfo = await stat(targetArchive);
console.log(`Собран demo.7z из каталога demo/ (${archiveInfo.size} байт).`);
