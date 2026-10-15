/* GameSpace Canvas FPS. Keep the APK asset byte-identical; no game files are rewritten. */
(function (root) {
  "use strict";

  function statistics(times, now, since) {
    var start = Math.max(since, now - 5000);
    var bins = [];
    var count = 0;
    for (var i = 0; i < times.length; i++) if (times[i] > start && times[i] <= now) count++;
    for (var index = 0; index < 5; index++) {
      var end = now - index * 1000;
      var begin = Math.max(since, end - 1000);
      if (end <= begin) break;
      var frames = 0;
      for (var n = 0; n < times.length; n++) if (times[n] > begin && times[n] <= end) frames++;
      bins.push(frames * 1000 / (end - begin));
    }
    var duration = Math.min(5000, Math.max(0, now - since));
    return {
      current: bins.length ? bins[0] : 0,
      min: bins.length ? Math.min.apply(Math, bins) : 0,
      average: duration > 0 ? count * 1000 / duration : 0,
      max: bins.length ? Math.max.apply(Math, bins) : 0,
      windowMs: duration
    };
  }

  function start(win) {
    if (win.__gamespaceCanvasFps && win.__gamespaceCanvasFps.running) return win.__gamespaceCanvasFps;
    var doc = win.document;
    var raf = win.requestAnimationFrame.bind(win);
    var cancel = win.cancelAnimationFrame.bind(win);
    var records = new Map();
    var contexts = new WeakMap();
    var undos = [];
    var active = true;
    var suspended = false;
    var request = null;
    var selected = null;
    var lastSelection = -Infinity;
    var lastPaint = -Infinity;
    var patchFailed = false;
    var host = null;
    var headline = null;
    var details = null;

    function now() { return win.performance.now(); }
    function connected(node) { return typeof node.isConnected === "boolean" ? node.isConnected : doc.documentElement.contains(node); }
    function patch(object, name, make) {
      if (!object || typeof object[name] !== "function") return;
      var original = object[name];
      var descriptor = Object.getOwnPropertyDescriptor(object, name);
      var wrapped = make(original);
      try {
        Object.defineProperty(object, name, { configurable: true, writable: true,
          enumerable: descriptor ? descriptor.enumerable : false, value: wrapped });
        undos.push(function () {
          // Do not overwrite another library's replacement made after ours.
          if (object[name] !== wrapped) return;
          if (descriptor) Object.defineProperty(object, name, descriptor);
          else delete object[name];
        });
      } catch (_) { patchFailed = true; }
    }
    function recordFor(context, kind) {
      var canvas = context && context.canvas;
      if (!(canvas instanceof win.HTMLCanvasElement) || !connected(canvas)) return null;
      var record = contexts.get(context);
      if (!record) {
        var framebuffer = null;
        if (kind !== "2d") {
          try { framebuffer = context.getParameter(context.DRAW_FRAMEBUFFER_BINDING || context.FRAMEBUFFER_BINDING); }
          catch (_) { patchFailed = true; }
        }
        record = { canvas: canvas, kind: kind, dirty: false, times: [], since: now(),
          framebuffer: framebuffer, offscreen: false, extensions: new WeakSet() };
        contexts.set(context, record);
      }
      records.set(canvas, record);
      return record;
    }
    function drawing(context, kind) {
      if (!active || suspended || doc.hidden) return;
      var record = recordFor(context, kind);
      if (record && (kind === "2d" || record.framebuffer === null)) record.dirty = true;
    }
    // Also discover existing contexts on their next draw: the shell attaches after page load.
    patch(win.HTMLCanvasElement.prototype, "getContext", function (original) {
      return function (kind) {
        var value = original.apply(this, arguments);
        if (value && /^(2d|webgl|webgl2|experimental-webgl)$/.test(kind)) {
          recordFor(value, kind === "experimental-webgl" ? "webgl" : kind);
        }
        return value;
      };
    });
    patch(win.HTMLCanvasElement.prototype, "transferControlToOffscreen", function (original) {
      return function () {
        var result = original.apply(this, arguments);
        records.set(this, { canvas: this, kind: "offscreen", offscreen: true });
        return result;
      };
    });
    ["clearRect", "fillRect", "strokeRect", "drawImage", "fill", "stroke", "fillText", "strokeText", "putImageData", "reset"].forEach(function (name) {
      patch(win.CanvasRenderingContext2D && win.CanvasRenderingContext2D.prototype, name, function (original) {
        return function () { var result = original.apply(this, arguments); drawing(this, "2d"); return result; };
      });
    });
    [win.WebGLRenderingContext, win.WebGL2RenderingContext].forEach(function (type, index) {
      var prototype = type && type.prototype;
      var kind = index ? "webgl2" : "webgl";
      ["clear", "drawArrays", "drawElements", "drawArraysInstanced", "drawElementsInstanced", "drawRangeElements",
        "blitFramebuffer", "clearBufferfv", "clearBufferiv", "clearBufferuiv", "clearBufferfi"].forEach(function (name) {
        patch(prototype, name, function (original) {
          return function () { var result = original.apply(this, arguments); drawing(this, kind); return result; };
        });
      });
      patch(prototype, "bindFramebuffer", function (original) {
        return function (target, buffer) {
          var result = original.apply(this, arguments);
          var record = recordFor(this, kind);
          if (record && (target === this.FRAMEBUFFER || target === this.DRAW_FRAMEBUFFER)) record.framebuffer = buffer;
          return result;
        };
      });
      patch(prototype, "getExtension", function (original) {
        return function () {
          var extension = original.apply(this, arguments);
          var context = this;
          var record = recordFor(context, kind);
          if (extension && record && !record.extensions.has(extension)) {
            record.extensions.add(extension);
            ["drawArraysInstancedANGLE", "drawElementsInstancedANGLE", "multiDrawArraysWEBGL", "multiDrawElementsWEBGL",
              "multiDrawArraysInstancedWEBGL", "multiDrawElementsInstancedWEBGL"].forEach(function (name) {
              patch(extension, name, function (source) {
                return function () { var result = source.apply(this, arguments); drawing(context, kind); return result; };
              });
            });
          }
          return extension;
        };
      });
    });

    function area(canvas) {
      if (!connected(canvas) || canvas.width < 2 || canvas.height < 2) return 0;
      var rect = canvas.getBoundingClientRect();
      var style = win.getComputedStyle(canvas);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return 0;
      return Math.max(0, Math.min(win.innerWidth, rect.right) - Math.max(0, rect.left))
        * Math.max(0, Math.min(win.innerHeight, rect.bottom) - Math.max(0, rect.top));
    }
    function chooseCanvas() {
      var largest = 0;
      selected = null;
      // An unobserved large canvas must not be replaced by a small animated HUD.
      var candidates = new Set(Array.prototype.slice.call(doc.querySelectorAll("canvas")));
      records.forEach(function (record, canvas) { candidates.add(canvas); });
      candidates.forEach(function (canvas) {
        var size = area(canvas);
        if (size > largest) { largest = size; selected = canvas; }
      });
    }
    function snapshot(timestamp) {
      timestamp = typeof timestamp === "number" ? timestamp : now();
      var record = selected && records.get(selected);
      var available = record && !record.offscreen && !patchFailed;
      return { time: timestamp, status: suspended || doc.hidden ? "paused" : available ? "measuring" : "unavailable",
        kind: record ? record.kind : null,
        canvasId: selected ? selected.id : null,
        fps: available && !suspended && !doc.hidden ? statistics(record.times, timestamp, record.since) : null };
    }
    function overlay() {
      if (host && connected(host)) return;
      host = doc.createElement("div");
      host.setAttribute("data-gamespace-fps", "");
      host.setAttribute("aria-label", "FPS отрисовки: оценка производительности");
      host.style.cssText = "position:fixed!important;top:max(8px,env(safe-area-inset-top))!important;left:max(8px,env(safe-area-inset-left))!important;z-index:2147483646!important;pointer-events:none!important;opacity:1!important;display:block!important;max-width:calc(100vw - 16px)!important;";
      // Fallback for WebViews without CSS max()/env().
      if (!host.style.top) { host.style.top = "8px"; host.style.left = "8px"; }
      var container = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;
      var panel = doc.createElement("div");
      panel.style.cssText = "box-sizing:border-box;padding:6px 8px;border:1px solid rgba(145,216,255,0.25);border-radius:7px;background:rgba(3,16,31,0.8);color:#d6f3ff;font:11px/1.4 monospace;text-align:left;white-space:nowrap;letter-spacing:0;text-transform:none;pointer-events:none;";
      panel.title = "FPS отрисовки (оценка). Мин/сред/макс — за 5 с; минимум и максимум по секундным отрезкам.";
      headline = doc.createElement("div"); headline.setAttribute("data-fps-current", "");
      headline.style.cssText = "font-weight:700;color:#9af2c8;";
      details = doc.createElement("div"); details.setAttribute("data-fps-details", "");
      panel.appendChild(headline); panel.appendChild(details); container.appendChild(panel);
      (doc.body || doc.documentElement).appendChild(host);
    }
    function format(value) { return value.toFixed(1).replace(".", ","); }
    function render(timestamp) {
      overlay();
      var result = snapshot(timestamp);
      headline.textContent = result.fps ? "FPS ≈ " + format(result.fps.current) : "FPS недоступен";
      details.textContent = result.fps ? "5 с: мин " + format(result.fps.min) + " · ср " + format(result.fps.average) + " · макс " + format(result.fps.max)
        : "Canvas не определяется";
    }
    function sample(timestamp) {
      request = null;
      if (!active || suspended || doc.hidden) return;
      records.forEach(function (record, canvas) {
        if (!connected(canvas)) { records.delete(canvas); return; }
        if (record.offscreen) return;
        if (record.dirty) record.times.push(timestamp);
        record.dirty = false;
        var first = 0;
        while (first < record.times.length && record.times[first] < timestamp - 6000) first++;
        if (first) record.times.splice(0, first);
        if (record.times.length > 4096) record.times.splice(0, record.times.length - 4096);
      });
      if (timestamp - lastSelection >= 500 || !selected || !connected(selected)) {
        lastSelection = timestamp; chooseCanvas();
      }
      if (timestamp - lastPaint >= 250) { lastPaint = timestamp; render(timestamp); }
      request = raf(sample);
    }
    function reset() {
      records.forEach(function (record) {
        if (!record.offscreen) { record.times = []; record.since = now(); record.dirty = false; }
      });
      lastPaint = -Infinity;
    }
    function suspend() {
      suspended = true;
      if (request !== null) cancel(request);
      request = null;
      reset();
      if (host) host.style.display = "none";
    }
    function resume() {
      if (!active || doc.hidden) return;
      suspended = false;
      reset();
      if (host) host.style.setProperty("display", "block", "important");
      if (request === null) request = raf(sample);
    }
    function visibility() { if (doc.hidden) suspend(); else resume(); }
    function fullscreen() {
      var parent = doc.fullscreenElement || doc.webkitFullscreenElement || doc.body;
      if (host && parent && parent.tagName !== "CANVAS") parent.appendChild(host);
    }
    var controller = {
      running: true,
      snapshot: snapshot,
      stop: function () {
        if (!active) return;
        active = false; controller.running = false;
        if (request !== null) cancel(request);
        doc.removeEventListener("visibilitychange", visibility);
        doc.removeEventListener("fullscreenchange", fullscreen);
        win.removeEventListener("pagehide", suspend);
        win.removeEventListener("pageshow", resume);
        for (var i = undos.length - 1; i >= 0; i--) { try { undos[i](); } catch (_) {} }
        undos = []; records.clear();
        if (host && host.parentNode) host.parentNode.removeChild(host);
        if (win.__gamespaceCanvasFps === controller) delete win.__gamespaceCanvasFps;
      }
    };
    win.__gamespaceCanvasFps = controller;
    doc.addEventListener("visibilitychange", visibility);
    doc.addEventListener("fullscreenchange", fullscreen);
    win.addEventListener("pagehide", suspend);
    win.addEventListener("pageshow", resume);
    if (!doc.hidden) request = raf(sample);
    return controller;
  }
  root.GameSpaceCanvasFps = { start: start, statistics: statistics };
})(typeof globalThis !== "undefined" ? globalThis : window);
