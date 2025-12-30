# store-fn

A simple utility function to define and sync Polar products using code. Define your products in TypeScript and keep them in sync with your Polar store.

## Installation

```bash
pnpm install store-fn
```

## Setup

### 1. Create a store configuration file

```ts
// store.config.ts

import { Polar } from "@polar-sh/sdk"
import { createStoreFn } from "store-fn"

const polarClient = new Polar({
  accessToken: process.env.POLAR_API_KEY!,
})

const store = createStoreFn({
  client: polarClient,
  organizationId: process.env.POLAR_ORGANIZATION_ID!,
})

// Define your products here
store.defineProduct({
  key: "basic",
  name: "Basic Plan",
  description: "Get started with the essentials.",
  recurringInterval: "month",
  recurringIntervalCount: 1,
  prices: [
    {
      amountType: "fixed",
      priceAmount: 9.99, // Automatically converted to 999 cents
      priceCurrency: "usd",
    },
  ],
  metadata: {
    maxUsers: 5,
  },
})

export default store
```

### 2. Sync products to Polar

You can sync products programmatically or using the CLI.

**Programmatically:**

```ts
import store from "./store.config.js"

// Sync all defined products to Polar
const result = await store.push()
console.log(`Synced ${result.updatedProducts.length} products`)
```

**Using CLI:**

```bash
store-fn push -i store.config.ts -o products.ts
```


## API Reference

### `createStoreFn(options)`

Creates a store instance for defining and syncing products.

**Parameters:**
- `options.client` - A Polar SDK client instance
- `options.organizationId` - Your Polar organization ID

**Returns:** An object with `defineProduct` and `push` methods

### `store.defineProduct(definition)`

Defines a product. Products are identified by their `key` in metadata.

**Parameters:**
- `definition.key` - Unique identifier for the product (stored in metadata)
- `definition.name` - Product name
- `definition.description` - Product description
- `definition.recurringInterval` - Optional: `"month"` | `"year"` | `"week"` | `"day"`
- `definition.recurringIntervalCount` - Optional: Number of intervals (default: 1)
- `definition.prices` - Array of price definitions
- `definition.metadata` - Optional: Custom metadata object
- `definition.virtual` - Optional: Set to `true` for virtual products (not synced to Polar)
- `definition.id` - Required if `virtual: true`

**Returns:** The product definition (with prices converted to cents)

### `store.push()`

Syncs all defined products to Polar. Creates new products or updates existing ones based on the `key` in metadata.

**Returns:** `Promise<{ updatedProducts: Product[] }>`

### `writeProductsToFile(products, path)`

Utility function to write products to a TypeScript file. Used internally by the CLI.

**Parameters:**
- `products` - Array of Product objects
- `path` - File path where products will be written


## Usage Examples

### Basic Product with Fixed Pricing

```ts
store.defineProduct({
  key: "basic",
  name: "Basic Plan",
  description: "Get started with the essentials.",
  prices: [
    {
      amountType: "fixed",
      priceAmount: 9.99, // Converts to 999 cents
      priceCurrency: "usd",
    },
  ],
})
```

### Recurring Subscription

```ts
store.defineProduct({
  key: "pro-monthly",
  name: "Pro Plan",
  description: "Monthly subscription for professionals.",
  recurringInterval: "month",
  recurringIntervalCount: 1,
  prices: [
    {
      amountType: "fixed",
      priceAmount: 29.99,
      priceCurrency: "usd",
    },
  ],
})
```

### Annual Subscription

```ts
store.defineProduct({
  key: "pro-yearly",
  name: "Pro Plan (Annual)",
  description: "Annual subscription with 2 months free.",
  recurringInterval: "year",
  recurringIntervalCount: 1,
  prices: [
    {
      amountType: "fixed",
      priceAmount: 299.99, // $29.99/month * 10 months
      priceCurrency: "usd",
    },
  ],
})
```

### Custom Pricing (Pay What You Want)

```ts
store.defineProduct({
  key: "custom-donation",
  name: "Custom Donation",
  description: "Support us with any amount.",
  prices: [
    {
      amountType: "custom",
      presetAmount: 25.00, // Suggested amount
      minimumAmount: 5.00, // Minimum allowed
      maximumAmount: 1000.00, // Maximum allowed
      priceCurrency: "usd",
    },
  ],
})
```

### Free Product

```ts
store.defineProduct({
  key: "free-tier",
  name: "Free Plan",
  description: "Forever free, no credit card required.",
  prices: [
    {
      amountType: "free",
    },
  ],
})
```

### Seat-Based Pricing

```ts
store.defineProduct({
  key: "team-plan",
  name: "Team Plan",
  description: "Perfect for teams of all sizes.",
  prices: [
    {
      amountType: "seat_based",
      priceCurrency: "usd",
      seatTiers: [
        {
          upTo: 5,
          unitAmount: 10.00, // $10 per seat for first 5 seats
        },
        {
          upTo: 20,
          unitAmount: 8.00, // $8 per seat for seats 6-20
        },
        {
          upTo: null, // Unlimited
          unitAmount: 5.00, // $5 per seat for 21+
        },
      ],
    },
  ],
})
```

### Metered/Usage-Based Pricing

```ts
store.defineProduct({
  key: "usage-based",
  name: "Pay As You Go",
  description: "Pay only for what you use.",
  prices: [
    {
      amountType: "metered_unit",
      priceCurrency: "usd",
      capAmount: 1000.00, // Optional: maximum charge per billing period
    },
  ],
})
```

### Product with Custom Metadata

```ts
store.defineProduct({
  key: "enterprise",
  name: "Enterprise Plan",
  description: "For large organizations.",
  recurringInterval: "month",
  recurringIntervalCount: 1,
  prices: [
    {
      amountType: "fixed",
      priceAmount: 499.99,
      priceCurrency: "usd",
    },
  ],
  metadata: {
    maxUsers: 1000,
    features: ["priority-support", "custom-integrations", "sla"],
    trialDays: 30,
  },
})
```

### Virtual Products (Not Synced to Polar)

Virtual products are useful for local development or products that exist only in your application:

```ts
store.defineProduct({
  virtual: true,
  key: "local-test",
  name: "Local Test Product",
  description: "Only exists locally, not synced to Polar.",
  prices: [
    {
      amountType: "free",
    },
  ],
})
```

### Multiple Products

```ts
// Basic tier
store.defineProduct({
  key: "basic",
  name: "Basic Plan",
  description: "Perfect for individuals.",
  recurringInterval: "month",
  recurringIntervalCount: 1,
  prices: [
    {
      amountType: "fixed",
      priceAmount: 9.99,
      priceCurrency: "usd",
    },
  ],
})

// Pro tier
store.defineProduct({
  key: "pro",
  name: "Pro Plan",
  description: "For professionals and small teams.",
  recurringInterval: "month",
  recurringIntervalCount: 1,
  prices: [
    {
      amountType: "fixed",
      priceAmount: 29.99,
      priceCurrency: "usd",
    },
  ],
})

// Enterprise tier
store.defineProduct({
  key: "enterprise",
  name: "Enterprise Plan",
  description: "For large organizations.",
  recurringInterval: "month",
  recurringIntervalCount: 1,
  prices: [
    {
      amountType: "fixed",
      priceAmount: 99.99,
      priceCurrency: "usd",
    },
  ],
  metadata: {
    includesSupport: true,
    maxUsers: 1000,
  },
})
```

## CLI Usage

The CLI allows you to sync products and generate a TypeScript file with all your products.

### Commands

#### `push` - Sync products to Polar and generate products file

```bash
store-fn push -i <input-file> -o <output-file>
```

**Options:**
- `-i` - Path to your store definition file (default: `store.config.ts`)
- `-o` - Path where the generated products file will be written (default: `store/products.ts`)

**Example:**

```bash
store-fn push -i store.config.ts -o products.ts
```

This command will:
1. Load your store definition file
2. Sync all products to Polar (create new ones or update existing ones)
3. Generate a TypeScript file with all synced products

### Generated Products File

After running `push`, you'll get a TypeScript file with all your products:

```ts
// products.ts (generated)

import type { Product } from "@polar-sh/sdk/models/components/product.js"

export const basicPlanProduct = {
  id: "prod_123...",
  name: "Basic Plan",
  // ... full product object
} as const satisfies Product

export const proPlanProduct = {
  id: "prod_456...",
  name: "Pro Plan",
  // ... full product object
} as const satisfies Product
```

You can then import and use these products in your application:

```ts
import { basicPlanProduct, proPlanProduct } from "./products.js"

// Use the product ID
const productId = basicPlanProduct.id

// Access product details
const price = basicPlanProduct.prices[0]
```

## Notes

- **Price Conversion**: All price amounts are automatically converted from dollars to cents (multiplied by 100)
- **Product Identification**: Products are matched by the `key` field in metadata. If a product with the same key exists, it will be updated; otherwise, a new product will be created
- **Virtual Products**: Products marked as `virtual: true` are not synced to Polar but are included in the generated products file
- **Type Safety**: The generated products file includes TypeScript types for full type safety
