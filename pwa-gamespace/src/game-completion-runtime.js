(function (root) {
  "use strict";
  // Host-side adapter. Only the directly opened document may finish its session.
  function start(host, game, finish) {
    var doc = game.document;
    var href = game.location.href;
    var origin = game.location.origin;
    var marker = doc.querySelector('meta[name="vn-game-protocol"]');
    var version = marker ? marker.getAttribute("content") : null;
    if (version !== null && version !== "2") return function () {};
    var strict = version === "2";
    var bytes = new Uint32Array(4);
    game.crypto.getRandomValues(bytes);
    var sessionId = "gamespace-" + Array.prototype.join.call(bytes, "-");
    var gameId = game.location.pathname;
    var done = false;
    function dispose() {
      done = true;
      host.removeEventListener("message", receive);
      game.removeEventListener("pagehide", dispose);
    }
    function receive(event) {
      if (done || event.source !== game || event.origin !== origin) return;
      if (game.document !== doc || game.location.href !== href) { dispose(); return; }
      var data = event.data;
      if (!data || typeof data !== "object") return;
      if (data.type !== "gameResult" && data.type !== "gameExit") return;
      if (data.type === "gameResult") {
        if (strict && (data.protocolVersion !== 2 || data.gameId !== gameId || data.sessionId !== sessionId)) return;
        if (!strict && ((data.protocolVersion !== undefined && data.protocolVersion !== 2)
          || (data.gameId !== undefined && data.gameId !== gameId)
          || (data.sessionId !== undefined && data.sessionId !== sessionId))) return;
        if (data.result !== undefined && (typeof data.result !== "number" || !isFinite(data.result))) return;
      }
      dispose();
      finish(data.type);
    }
    host.addEventListener("message", receive);
    game.addEventListener("pagehide", dispose);
    // Unmarked legacy pages keep their autonomous initialization and difficulty.
    if (strict) game.postMessage({
      type: "gameInit", protocolVersion: 2, gameId: gameId, sessionId: sessionId, difficulty: 3
    }, origin);
    return dispose;
  }
  root.GameSpaceGameCompletion = { start: start };
})(globalThis);