import { resolve } from "node:path"
import { defineConfig } from "vitest/config"
import { loadEnv } from "vite"

export default defineConfig({
  resolve: {
    alias: [{ find: "@", replacement: resolve(__dirname, "src") }],
  },
  test: {
    env: loadEnv("", process.cwd(), ""),
  },
})
