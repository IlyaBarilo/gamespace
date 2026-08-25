import { appendFile } from "node:fs/promises";
import { parseReleaseTag } from "./release-utils.mjs";

const release = parseReleaseTag(process.argv[2]);

if (process.argv.includes("--github-output")) {
  if (!process.env.GITHUB_OUTPUT) {
    throw new Error("Переменная GITHUB_OUTPUT не задана.");
  }
  await appendFile(
    process.env.GITHUB_OUTPUT,
    `version=${release.version}\ntag_version=${release.tagVersion}\n`,
    "utf8",
  );
} else {
  process.stdout.write(release.version);
}
