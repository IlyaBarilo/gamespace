import test from "node:test";
import assert from "node:assert/strict";

import {
  requiredReleaseLicenseFiles,
  requiredReleaseThirdPartyLicenseFiles,
  requiredReleaseThirdPartySourceFiles,
  releaseLicenseBundleVersion,
  verifyReleaseLicenseBundle,
  verifyRequiredReleaseLicenseFiles,
} from "../scripts/release-utils.mjs";
import { verifyRequiredDemoLicenseFiles } from "../scripts/verify-demo-archive.mjs";

test("release license verification requires the complete public license set", () => {
  const paths = [
    ...requiredReleaseLicenseFiles,
    ...requiredReleaseThirdPartyLicenseFiles.map((name) => `third_party/licenses/${name}`),
    ...requiredReleaseThirdPartySourceFiles,
  ];
  assert.doesNotThrow(() => verifyRequiredReleaseLicenseFiles(paths));
  assert.throws(
    () => verifyRequiredReleaseLicenseFiles(paths.filter((file) => file !== "DEMO_CONTENT_LICENSE.md")),
    /DEMO_CONTENT_LICENSE\.md/,
  );
  assert.throws(
    () => verifyRequiredReleaseLicenseFiles(paths.filter((file) => file !== "third_party/licenses/APACHE-2.0.txt")),
    /APACHE-2\.0\.txt/,
  );
  assert.throws(
    () => verifyRequiredReleaseLicenseFiles(paths.filter((file) => file !== "third_party/sources/un7z-opfs-1.0.2/7zip-26.02-source.tar.gz")),
    /7zip-26\.02-source\.tar\.gz/,
  );
});

test("release license bundle verification preserves immutable legacy releases", () => {
  const paths = [
    ...requiredReleaseLicenseFiles,
    ...requiredReleaseThirdPartyLicenseFiles.map((name) => `third_party/licenses/${name}`),
    ...requiredReleaseThirdPartySourceFiles,
  ];
  assert.equal(verifyReleaseLicenseBundle({}, [], "старом выпуске"), false);
  assert.equal(
    verifyReleaseLicenseBundle({ licenseBundle: releaseLicenseBundleVersion }, paths, "новом выпуске"),
    true,
  );
  assert.throws(
    () => verifyReleaseLicenseBundle({ licenseBundle: releaseLicenseBundleVersion }, [], "новом выпуске"),
    /LICENSE\.txt/,
  );
  assert.throws(
    () => verifyReleaseLicenseBundle({ licenseBundle: releaseLicenseBundleVersion + 1 }, paths, "выпуске"),
    /неподдерживаемая версия/,
  );
});

test("demo verification requires its own terms and the bundled font license", () => {
  const paths = [
    "DEMO_CONTENT_LICENSE.md",
    "THIRD_PARTY_LICENSES/ROBOTO-OFL-1.1.txt",
  ];
  assert.doesNotThrow(() => verifyRequiredDemoLicenseFiles(paths));
  assert.throws(
    () => verifyRequiredDemoLicenseFiles(["DEMO_CONTENT_LICENSE.md"]),
    /ROBOTO-OFL-1\.1\.txt/,
  );
});
