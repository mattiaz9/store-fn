# Testing the CLI Locally

## Prerequisites

1. Install dependencies:
```bash
pnpm install
```

2. Set up environment variables:
```bash
export POLAR_API_KEY="your_polar_api_key"
export POLAR_ORGANIZATION_ID="your_organization_id"
```

## Method 1: Using tsx (Recommended for Development)

Since Node.js can't directly import TypeScript files, use `tsx` to run the CLI:

```bash
# Build the CLI first
pnpm build

# Run the CLI using tsx (which handles TypeScript imports)
tsx src/cli.ts push -i test-store.ts -o test-products.ts
```

Or use the test script:
```bash
pnpm run cli:test
```

## Method 2: Using the Built CLI

After building, you can use the built CLI, but you'll need to compile your store file first:

```bash
# Build everything
pnpm build

# Compile your store file to JavaScript first
tsx --build test-store.ts

# Then run the built CLI
node dist/cli.js push -i test-store.js -o test-products.ts
```

## Method 3: Link the Package Locally

For testing as if it were installed:

```bash
# Build the package
pnpm build

# Link it locally (in this directory)
pnpm link --global

# Or link it in another project
cd /path/to/your/project
pnpm link store-fn

# Then use it normally
store-fn push -i store.ts -o products.ts
```

## Test Store File

The `test-store.ts` file in the root directory is an example store file you can use for testing.

## Troubleshooting

- **"Cannot find module"**: Make sure you're using `tsx` to run the CLI when testing TypeScript files
- **"POLAR_API_KEY is required"**: Set the environment variables before running
- **"Store file must have a default export"**: Make sure your store file exports the store object as default

