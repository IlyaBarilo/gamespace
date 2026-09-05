import test from "node:test";
import assert from "node:assert/strict";
import { isAllowedExternalUrl } from "../src/navigation-policy.js";

test("external navigation allows browser and communication links", () => {
  const base = "https://example.test/__gamespace_content__/site/index.html";
  assert.equal(isAllowedExternalUrl("https://example.org/page", base), true);
  assert.equal(isAllowedExternalUrl("http://example.org/page", base), true);
  assert.equal(isAllowedExternalUrl("mailto:test@example.org", base), true);
  assert.equal(isAllowedExternalUrl("tel:+70000000000", base), true);
  assert.equal(isAllowedExternalUrl("../game.html", base), true);
});

test("external navigation blocks executable and application-specific protocols", () => {
  const base = "https://example.test/site/index.html";
  assert.equal(isAllowedExternalUrl("javascript:alert(1)", base), false);
  assert.equal(isAllowedExternalUrl("data:text/html,unsafe", base), false);
  assert.equal(isAllowedExternalUrl("intent://unsafe", base), false);
  assert.equal(isAllowedExternalUrl("file:///private/data", base), false);
  assert.equal(isAllowedExternalUrl("not a valid url", undefined), false);
});
