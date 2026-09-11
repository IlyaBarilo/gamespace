import { writeFile } from "node:fs/promises";
import { APPLICATION_ID, REPOSITORY_URL, parseReleaseTag, serializeCatalog } from "../scripts/apk-update-catalog.mjs";

// Exercise the actual Pages producer against the Java consumer, including its full history limit.
const releases = Array.from({ length: 100 }, (_, index) => {
  const release = parseReleaseTag(`v${100 - index}`);
  const name = `GameSpace-${release.version}.apk`;
  return {
    ...release, publishedAt: "2026-09-01T12:00:00Z",
    description: 'Исправления\nКавычки: "текст"; символ 🎮; путь \\demo',
    releaseUrl: `${REPOSITORY_URL}/releases/tag/${release.tag}`, minSdk: 23,
    apk: { name, url: `${REPOSITORY_URL}/releases/download/${release.tag}/${name}`,
      size: 1024, sha256: "b".repeat(64), signerSha256: "a".repeat(64) },
  };
});
if (!process.argv[2]) throw new Error("Pass an output file in the test build directory.");
await writeFile(process.argv[2], serializeCatalog({ schemaVersion: 1, applicationId: APPLICATION_ID,
  channel: "stable", latestVersionCode: releases[0].versionCode, releases }), "utf8");
