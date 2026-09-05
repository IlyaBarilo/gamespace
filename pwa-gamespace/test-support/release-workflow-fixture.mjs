// Local command doubles for executing the actual workflow shell blocks.
// This fixture never invokes GitHub CLI, Git, a network request or an archiver.
import fs from "node:fs";
import path from "node:path";

const [tool, ...args] = process.argv.slice(2);
const stateFile = process.env.FIXTURE_STATE;
const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
state.calls.push([tool, ...args]);
const save = () => fs.writeFileSync(stateFile, JSON.stringify(state));
const fail = message => { save(); process.stderr.write(message); process.exit(1); };
const flag = name => args[args.indexOf(name) + 1];
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };

if (tool === "gh") {
  if (args[0] !== "release") fail("Unexpected GitHub command");
  const tag = args[2];
  if (args[1] === "list") {
    if (state.failList) fail("Cannot read release catalog");
    console.log(state.tags.join("\n"));
  } else if (args[1] === "view") {
    if (state.failView) fail("GitHub API unavailable");
    const release = { tagName: tag, isDraft: Boolean(state.draft), isPrerelease: Boolean(state.prerelease), body: "Release fixture", assets: Object.keys(state.releases[tag] || {}).map(name => ({ name })) };
    console.log(args.includes("--jq") ? release[flag("--jq").slice(1)] : JSON.stringify(release));
  } else if (args[1] === "download") {
    const name = flag("--pattern"), directory = flag("--dir");
    let value = state.releases[tag]?.[name];
    if (value === undefined) fail(`Missing release asset: ${name}`);
    if (state.corruptVerificationDownload && directory.endsWith("verified-release-assets")) value += "CORRUPT";
    write(path.join(directory, name), value);
  } else if (args[1] === "upload") {
    let uploaded = 0;
    for (const file of args.slice(3)) {
      const name = path.basename(file);
      if (state.releases[tag][name] !== undefined) fail("Published asset overwrite attempted");
      state.releases[tag][name] = fs.readFileSync(file, "utf8");
      if (++uploaded === state.failUploadAfter) fail("Interrupted upload");
    }
  } else fail("Unexpected release mutation");
} else if (tool === "jq") {
  const input = JSON.parse(fs.readFileSync(0, "utf8"));
  if (args.includes("--arg")) {
    if (!input.assets.some(asset => asset.name === args[args.indexOf("--arg") + 2])) { save(); process.exit(1); }
    console.log("true");
  } else {
    console.log(input[args.at(-1).slice(1)]);
  }
} else if (tool === "node") {
  const [script, version] = args;
  if (script.endsWith("read-release-version.mjs")) {
    console.log(version.slice(1).split(".").concat(["0", "0"]).slice(0, 3).join("."));
  } else if (script.endsWith("prepare-release.mjs")) {
    const target = path.join("release-packages", version);
    if (fs.existsSync(target)) fail("Existing package would be overwritten");
    write(path.join(target, "release.json"), "{}");
  } else if (script.endsWith("verify-release-source.mjs") && state.failSourceVerification) {
    fail("Tagged source does not match the package");
  } else if (!script.includes("/verify-")) fail(`Unexpected build command: ${script}`);
} else if (tool === "tar") {
  if (args.includes("-xzf")) {
    write(path.join(flag("-C"), "release.json"), "{}");
  } else if (args.includes("-czf")) {
    write(flag("-czf"), "new PWA package");
  } else if (!args.includes("-tzf")) fail("Unexpected archive command");
} else fail(`Unexpected tool: ${tool}`);
save();
