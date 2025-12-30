import { defineConfig } from "tsup"

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm"],
    dts: true,
    sourcemap: true,
    clean: true,
    splitting: false,
    external: ["@polar-sh/sdk", "prettier"],
  },
  {
    entry: ["src/cli.ts"],
    format: ["esm"],
    sourcemap: false,
    clean: true,
    splitting: false,
    external: ["@polar-sh/sdk", "prettier"],
    banner: {
      js: "#!/usr/bin/env node",
    },
  },
])
