#!/usr/bin/env node

import pc from "picocolors"
import { resolve } from "path"
import { writeProductsToFile } from "./lib.js"

async function main() {
  const args = process.argv.slice(2)
  const command = args[0]

  if (!command) {
    console.error(pc.red("Error: No command provided"))
    console.log("\nUsage: store-fn <command>")
    console.log("\nCommands:")
    console.log("  push    Sync products to Polar store")
    console.log("\nExample:")
    console.log("  store-fn push -i store.config.ts -o store/products.ts")
    console.log("  store-fn push  # Uses defaults: -i store.config.ts -o store/products.ts")
    process.exit(1)
  }

  if (command === "push") {
    await handlePush(args.slice(1))
  } else {
    console.error(pc.red(`Error: Unknown command "${command}"`))
    console.log("\nAvailable commands:")
    console.log("  push    Sync products to Polar store")
    process.exit(1)
  }
}

async function handlePush(args: string[]) {
  // Parse arguments
  let inputFile: string | undefined
  let outputFile: string | undefined

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-i" && i + 1 < args.length) {
      inputFile = args[i + 1]
      i++ // Skip the next argument as it's the value
    } else if (args[i] === "-o" && i + 1 < args.length) {
      outputFile = args[i + 1]
      i++ // Skip the next argument as it's the value
    }
  }

  // Set defaults
  inputFile = inputFile || "store.config.ts"
  outputFile = outputFile || "store/products.ts"

  try {
    // Resolve file paths
    const inputFilePath = resolve(process.cwd(), inputFile)
    const outputFilePath = resolve(process.cwd(), outputFile)

    console.log(pc.blue(`Loading store definition from: ${inputFilePath}`))

    // Convert file path to file:// URL for ESM imports
    const resolvedInputPath = resolve(inputFilePath)
    const storeFileUrl = resolvedInputPath.startsWith("file://")
      ? resolvedInputPath
      : `file://${resolvedInputPath}`

    // Import the store file
    // Note: For TypeScript files, use tsx to run this CLI (tsx will handle the imports)
    let storeModule: any
    try {
      // Try importing as-is first (works for JS files or when using tsx)
      storeModule = await import(storeFileUrl)
    } catch (error: any) {
      // If it's a TypeScript file and we're not using tsx, try with .ts extension
      if (
        (error.code === "ERR_UNKNOWN_FILE_EXTENSION" ||
          error.message?.includes("Unknown file extension")) &&
        inputFilePath.endsWith(".ts")
      ) {
        throw new Error(
          `Cannot load TypeScript file: ${inputFilePath}\n` +
            `Please run this CLI using tsx: tsx src/cli.ts push -i ${inputFile} -o ${outputFile}\n` +
            `Or compile your store file to JavaScript first.`,
        )
      }
      if (error.code === "ERR_MODULE_NOT_FOUND" || error.code === "ENOENT") {
        throw new Error(
          `Store file not found: ${inputFilePath}\nMake sure the file exists and the path is correct.`,
        )
      }
      if (error.message?.includes("Cannot find module")) {
        throw new Error(
          `Cannot load store file: ${inputFilePath}\nIf it's a TypeScript file, make sure you're using tsx to run the CLI or compile it first.`,
        )
      }
      throw error
    }

    // Get the default export (should be the store object from createStoreFn)
    const store = storeModule.default

    if (!store) {
      throw new Error(
        `Store file must have a default export. Found exports: ${Object.keys(storeModule).join(", ")}`,
      )
    }

    if (typeof store.push !== "function") {
      throw new Error(
        "Store default export must be the return value of createStoreFn (an object with a push function)",
      )
    }

    console.log(pc.blue("Syncing products to Polar store...\n"))

    // Call push to sync the store
    const result = await store.push()

    if (!result || !result.updatedProducts) {
      throw new Error(
        "Push function did not return products. Expected { updatedProducts: Product[] }",
      )
    }

    const products = result.updatedProducts

    if (!Array.isArray(products) || products.length === 0) {
      console.log(pc.yellow("No products to write"))
      return
    }

    console.log(pc.blue(`\nWriting ${products.length} product(s) to: ${outputFilePath}`))

    // Write products to the output file
    await writeProductsToFile(products, outputFilePath)

    console.log(pc.green(`\n✓ Successfully wrote products to ${outputFilePath}`))
  } catch (error: any) {
    console.error(pc.red(`\nError: ${error.message}`))
    if (error.stack && process.env.DEBUG) {
      console.error(error.stack)
    }
    process.exit(1)
  }
}

main().catch((error) => {
  console.error(pc.red(`Fatal error: ${error.message}`))
  if (error.stack) {
    console.error(error.stack)
  }
  process.exit(1)
})
