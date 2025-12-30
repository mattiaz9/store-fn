/// <reference types="vitest/importMeta" />

interface ImportMetaEnv {
  readonly POLAR_ACCESS_TOKEN?: string
  readonly POLAR_ORGANIZATION_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
