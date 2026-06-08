import { defineConfig, createLogger } from "vite";

const logger = createLogger();
const originalWarning = logger.warn;
logger.warn = (message, options) => {
  if (message.includes("spark") && message.includes("source map")) return;
  originalWarning(message, options);
};

function sparkJsWasmFix() {
  return {
    name: "spark-js-wasm-fix",
    enforce: "pre",
    transform(code, id) {
      if (!id.includes("spark") || !id.includes("module.js")) return null;

      const wasmPattern = /new URL\s*\(\s*["']data:application\/wasm;base64,([^"']+)["']\s*,\s*import\.meta\.url\s*\)/g;
      const matches = [...code.matchAll(wasmPattern)];
      if (matches.length === 0) return null;

      return {
        code: code.replace(wasmPattern, (_match, base64Data) => {
          return `(() => {
            const base64 = "${base64Data}";
            const binary = atob(base64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
            return URL.createObjectURL(new Blob([bytes], { type: "application/wasm" }));
          })()`;
        }),
        map: null
      };
    }
  };
}

const crossOriginIsolationHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp"
};

export default defineConfig({
  base: "./",
  customLogger: logger,
  plugins: [sparkJsWasmFix()],
  server: {
    headers: crossOriginIsolationHeaders
  },
  preview: {
    headers: crossOriginIsolationHeaders
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    assetsDir: "assets",
    rollupOptions: {
      input: "index.html",
      onwarn(warning, warn) {
        if (warning.code === "MODULE_LEVEL_DIRECTIVE" && warning.message.includes("use asm")) return;
        if (warning.code === "SOURCEMAP_ERROR" || warning.message?.includes("sourcemap")) return;
        warn(warning);
      }
    }
  },
  optimizeDeps: {
    include: ["three", "@sparkjsdev/spark"],
    exclude: ["@sparkjsdev/spark"]
  }
});
