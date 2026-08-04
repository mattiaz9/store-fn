import { defineConfig } from "tsdown"

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm"],
    dts: true,
    sourcemap: true,
    clean: true,
    fixedExtension: false,
    deps: {
      neverBundle: ["@polar-sh/sdk"],
    },
  },
  {
    entry: ["src/cli.ts"],
    format: ["esm"],
    dts: false,
    sourcemap: false,
    clean: true,
    fixedExtension: false,
    deps: {
      neverBundle: ["@polar-sh/sdk", "prettier", "typescript", "tsx"],
    },
    banner: {
      js: "#!/usr/bin/env node",
    },
  },
])
