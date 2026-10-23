import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const sources = [
  new URL("../src/game-completion-runtime.js", import.meta.url),
];
for (const source of sources) {
  test(source.pathname + ": session isolation and legacy completion", () => {
    for (const strict of [false, true]) {
      const listeners = new Map();
      let init, count = 0;
      const game = {
        document: { querySelector: () => strict ? { getAttribute: () => "2" } : null },
        location: { href: "https://local/game.html", origin: "https://local", pathname: "/game.html" },
        crypto: { getRandomValues: bytes => bytes.fill(7) },
        addEventListener() {}, removeEventListener() {},
        postMessage: data => { init = data; },
      };
      const host = { addEventListener: (type, fn) => listeners.set(type, fn), removeEventListener: type => listeners.delete(type) };
      const context = { window: {} };
      vm.runInNewContext(readFileSync(source, "utf8"), context);
      const api = context.GameSpaceGameCompletion || context.window.GameSpaceGameCompletion;
      api.start(host, game, () => count++);
      const receive = listeners.get("message");
      const send = (data, sender = game, origin = "https://local") => receive({ data, source: sender, origin });
      const result = strict ? { ...init, type: "gameResult", result: 1 } : { type: "gameResult", result: 0 };
      send(result, {}); // Nested mini-game, including one targeting the outer host.
      send(result, game, "https://other");
      send({ ...result, protocolVersion: 99 });
      send({ ...result, sessionId: "previous-session" });
      send({ ...result, result: "1" });
      send({ ...result, result: Infinity });
      if (strict) send({ type: "gameResult", result: 1 });
      assert.equal(count, 0);
      assert.equal(Boolean(init), strict);
      send(result);
      send(result);
      assert.equal(count, 1);
      assert.equal(listeners.has("message"), false);

      api.start(host, game, () => count++);
      const stale = listeners.get("message");
      game.document = { querySelector: () => null };
      stale({ data: { type: "gameResult" }, source: game, origin: "https://local" });
      assert.equal(count, 1);
      api.start(host, game, () => count++);
      listeners.get("message")({ data: { type: "gameExit" }, source: game, origin: "https://local" });
      assert.equal(count, 2);
    }
  });
}