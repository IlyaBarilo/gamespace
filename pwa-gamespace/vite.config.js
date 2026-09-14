import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  server: {
    // Generated browser-test releases must not reload the local app or retain directory watchers.
    watch: { ignored: ["**/.codex-e2e-release-*/**", "**/test-results/**"] },
  },
  build: {
    target: "es2022",
    assetsInlineLimit: 0,
    sourcemap: false,
    license: {
      fileName: "third-party-bundled-licenses.md",
    },
    rollupOptions: {
      output: {
        entryFileNames: "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: (assetInfo) => {
          const name = assetInfo.names?.[0] || assetInfo.name || "asset";
          if (name.endsWith(".css")) return "assets/[name]-[hash][extname]";
          if (name.endsWith(".wasm")) return "assets/[name]-[hash][extname]";
          return "assets/[name]-[hash][extname]";
        },
      },
    },
  },
  worker: {
    format: "es",
    rollupOptions: {
      output: {
        entryFileNames: "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: (assetInfo) => {
          const name = assetInfo.names?.[0] || assetInfo.name || "asset";
          if (name.endsWith(".wasm")) return "assets/[name]-[hash][extname]";
          return "assets/[name]-[hash][extname]";
        },
      },
    },
  },
});
