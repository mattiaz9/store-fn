import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { exec } from "child_process"
import { promisify } from "util"
import { writeFile, unlink, readFile } from "fs/promises"
import { existsSync } from "fs"
import { resolve } from "path"

const execAsync = promisify(exec)

const POLAR_API_KEY = import.meta.env.POLAR_ACCESS_TOKEN
const POLAR_ORGANIZATION_ID = import.meta.env.POLAR_ORGANIZATION_ID

if (!POLAR_API_KEY || !POLAR_ORGANIZATION_ID) {
  throw new Error(
    "Missing required environment variables: POLAR_ACCESS_TOKEN or POLAR_ORGANIZATION_ID",
  )
}

describe("store-fn cli", () => {
  const testStoreFile = resolve(process.cwd(), "tests", "test-store-cli.ts")
  const testOutputFile = resolve(process.cwd(), "tests", "test-output-products.ts")
  const cliPath = resolve(process.cwd(), "src", "cli.ts")

  beforeAll(async () => {
    // Create a test store file
    const storeContent = `import { Polar } from "@polar-sh/sdk"
import { createStoreFn } from "../src/index.js"

const polarClient = new Polar({
  accessToken: "${POLAR_API_KEY}",
  server: "sandbox"
})

const store = createStoreFn({
  client: polarClient,
  organizationId: "${POLAR_ORGANIZATION_ID}",
})

store.defineProduct({
  key: "cli-test-product",
  name: "CLI Test Product",
  description: "A product created via CLI test",
  prices: [
    {
      amountType: "fixed",
      priceAmount: 19.99,
      priceCurrency: "usd",
    },
  ],
})

export default store
`
    await writeFile(testStoreFile, storeContent, "utf-8")
  })

  afterAll(async () => {
    // Clean up test files
    try {
      if (existsSync(testStoreFile)) {
        await unlink(testStoreFile)
      }
      if (existsSync(testOutputFile)) {
        await unlink(testOutputFile)
      }
    } catch (error) {
      // Ignore cleanup errors
    }
  })

  it("should show error when no command is provided", async () => {
    try {
      await execAsync(`tsx ${cliPath}`, {
        env: { ...process.env },
      })
      // Should not reach here
      expect(true).toBe(false)
    } catch (error: any) {
      const output = [error.stdout, error.stderr].filter(Boolean).join("\n")
      expect(output).toContain("Error: No command provided")
      expect(output).toContain("Usage: store-fn <command>")
    }
  })

  it("should show error when unknown command is provided", async () => {
    try {
      await execAsync(`tsx ${cliPath} unknown-command`, {
        env: { ...process.env },
      })
      // Should not reach here
      expect(true).toBe(false)
    } catch (error: any) {
      const output = [error.stdout, error.stderr].filter(Boolean).join("\n")
      expect(output).toContain('Error: Unknown command "unknown-command"')
    }
  })

  it("should show error when store file does not exist", async () => {
    try {
      await execAsync(`tsx ${cliPath} push -i nonexistent-file.ts -o output.ts`, {
        env: { ...process.env },
      })
      // Should not reach here
      expect(true).toBe(false)
    } catch (error: any) {
      const output = [error.stdout, error.stderr].filter(Boolean).join("\n")
      expect(output).toContain("Store file not found")
    }
  })

  it("should successfully run push command and create output file", async () => {
    // Ensure output file doesn't exist before test
    if (existsSync(testOutputFile)) {
      await unlink(testOutputFile)
    }

    const { stdout, stderr } = await execAsync(
      `tsx ${cliPath} push -i ${testStoreFile} -o ${testOutputFile}`,
      {
        env: {
          ...process.env,
          POLAR_API_KEY: POLAR_API_KEY,
          POLAR_ACCESS_TOKEN: POLAR_API_KEY,
          POLAR_ORGANIZATION_ID: POLAR_ORGANIZATION_ID,
        },
      },
    )

    // Check that output file was created
    expect(existsSync(testOutputFile)).toBe(true)

    // Verify output file content
    const outputContent = await readFile(testOutputFile, "utf-8")
    expect(outputContent).toContain("CLI Test Product")
    expect(outputContent).toContain("cli-test-product")
    expect(outputContent).toContain("Product")

    // Check CLI output
    expect(stdout).toContain("Syncing products to Polar store")
    expect(stdout).toContain("Successfully wrote products")
  }, 30000)

  it("should handle store file with no default export", async () => {
    // Create a store file without default export
    const invalidStoreFile = resolve(process.cwd(), "tests", "test-store-invalid.ts")
    await writeFile(invalidStoreFile, `export const notDefault = "test"`, "utf-8")

    try {
      try {
        await execAsync(`tsx ${cliPath} push -i ${invalidStoreFile} -o ${testOutputFile}`, {
          env: { ...process.env },
        })
        // Should not reach here
        expect(true).toBe(false)
      } catch (error: any) {
        const output = [error.stdout, error.stderr].filter(Boolean).join("\n")
        expect(output).toContain("Store file must have a default export")
      }
    } finally {
      // Clean up
      if (existsSync(invalidStoreFile)) {
        await unlink(invalidStoreFile)
      }
    }
  })

  it("should handle store file without push function", async () => {
    // Create a store file with default export but no push function
    const invalidStoreFile = resolve(process.cwd(), "tests", "test-store-no-push.ts")
    await writeFile(invalidStoreFile, `export default { notPush: () => {} }`, "utf-8")

    try {
      try {
        await execAsync(`tsx ${cliPath} push -i ${invalidStoreFile} -o ${testOutputFile}`, {
          env: { ...process.env },
        })
        // Should not reach here
        expect(true).toBe(false)
      } catch (error: any) {
        const output = [error.stdout, error.stderr].filter(Boolean).join("\n")
        expect(output).toContain("Store default export must be the return value of createStoreFn")
      }
    } finally {
      // Clean up
      if (existsSync(invalidStoreFile)) {
        await unlink(invalidStoreFile)
      }
    }
  })
})
