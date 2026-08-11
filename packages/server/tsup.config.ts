import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "node",
  banner: {
    js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
  },
  sourcemap: true,
  clean: true,
  publicDir: "drizzle",
  noExternal: [/^(?!(?:better-sqlite3|jiti)(?:\/|$)).*/],
  external: ["better-sqlite3", "jiti"],
});
