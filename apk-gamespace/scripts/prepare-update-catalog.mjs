import { execFile } from "node:child_process";
import { mkdir, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  createReleaseEntry, hashApk, mergeCatalog, parseApkIdentity, readJson,
  serializeCatalog, sha256, validatePublishedRelease,
} from "./apk-update-catalog.mjs";

const execute = promisify(execFile);

async function runTool(executable, args) {
  const { stdout } = await execute(executable, args, {
    encoding: "utf8", windowsHide: true, timeout: 120000, maxBuffer: 2 * 1024 * 1024,
  });
  return stdout;
}

export async function prepareUpdateCatalog(options, { inspectTool = runTool } = {}) {
  const expectedSigner = sha256(options.expectedSignerSha256, "ожидаемый сертификат APK");
  const release = validatePublishedRelease(await readJson(options.release));
  const previous = options.previous ? await readJson(options.previous) : null;
  const apk = await realpath(options.apk);
  const before = await stat(apk);
  if (!before.isFile() || before.size !== release.asset.size) {
    throw new Error("Размер локального APK не совпадает с файлом опубликованного релиза.");
  }
  // execFile uses argument arrays without a command shell on both Windows and Linux.
  const certificateReport = await inspectTool(options.java || "java", [
    "-jar", path.resolve(options.apksignerJar), "verify", "--verbose", "--print-certs", apk,
  ]);
  const badging = await inspectTool(path.resolve(options.aapt2), ["dump", "badging", apk]);
  const identity = parseApkIdentity(badging, certificateReport, expectedSigner);
  const file = await hashApk(apk);
  const after = await stat(apk);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || before.ino !== after.ino) {
    throw new Error("APK изменился во время проверки.");
  }
  const catalog = mergeCatalog(createReleaseEntry(release, identity, file), previous);
  const contents = serializeCatalog(catalog);
  const output = path.resolve(options.output);
  if (path.basename(output) !== "updates.json") throw new Error("Выходной файл должен называться updates.json.");
  await mkdir(path.dirname(output), { recursive: true });
  // Build into a new Pages staging directory; never overwrite an input or a published catalog.
  await writeFile(output, contents, { encoding: "utf8", flag: "wx" });
  return catalog;
}

function parseArguments(args) {
  const names = {
    "--apk": "apk", "--release": "release", "--aapt2": "aapt2",
    "--apksigner-jar": "apksignerJar", "--java": "java", "--output": "output",
    "--previous": "previous", "--expected-signer-sha256": "expectedSignerSha256",
  };
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = names[args[index]];
    const value = args[index + 1];
    if (!key || !value || value.startsWith("--") || options[key] !== undefined) {
      throw new Error(`Неизвестный, повторный или неполный параметр: ${args[index]}`);
    }
    options[key] = value;
  }
  for (const required of ["apk", "release", "aapt2", "apksignerJar", "output", "expectedSignerSha256"]) {
    if (!options[required]) throw new Error(`Не задан обязательный параметр: ${required}`);
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length === 3 && process.argv[2] === "--help") {
      console.log("node apk-gamespace/scripts/prepare-update-catalog.mjs --apk <file.apk> --release <release.json> --aapt2 <aapt2> --apksigner-jar <apksigner.jar> --expected-signer-sha256 <hex> --output <new-directory/updates.json> [--java <java>] [--previous <updates.json>]");
    } else {
      const catalog = await prepareUpdateCatalog(parseArguments(process.argv.slice(2)));
      console.log(`Каталог APK подготовлен: последняя версия ${catalog.releases[0].version}, релизов ${catalog.releases.length}.`);
    }
  } catch (error) {
    console.error(`Каталог APK не создан: ${error.message}`);
    process.exitCode = 1;
  }
}
