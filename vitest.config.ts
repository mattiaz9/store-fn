import { resolve } from "node:path"
import { loadEnv } from "vite"
import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    alias: [{ find: "@", replacement: resolve(import.meta.dirname, "src") }],
  },
  test: {
    env: loadEnv("", process.cwd(), ""),
  },
})
