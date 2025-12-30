import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { Polar } from "@polar-sh/sdk"
import { createStoreFn } from "../src/index.js"
import { fetchPolarIterator } from "../src/utils.js"

// Ensure globals are available
declare global {
  var polarClient: Polar
  var polarOrganizationId: string
}

const POLAR_API_KEY = import.meta.env.POLAR_ACCESS_TOKEN
const POLAR_ORGANIZATION_ID = import.meta.env.POLAR_ORGANIZATION_ID

if (!POLAR_API_KEY || !POLAR_ORGANIZATION_ID) {
  throw new Error(
    "Missing required environment variables: POLAR_ACCESS_TOKEN or POLAR_ORGANIZATION_ID",
  )
}

describe("store-fn", () => {
  let polarClient: Polar
  let store: ReturnType<typeof createStoreFn>
  let createdProductIds: string[] = []

  beforeAll(() => {
    polarClient = new Polar({
      accessToken: POLAR_API_KEY,
      server: "sandbox",
    })

    // Initialize global variables that push() uses
    globalThis.polarClient = polarClient
    globalThis.polarOrganizationId = POLAR_ORGANIZATION_ID

    store = createStoreFn({
      client: polarClient,
      organizationId: POLAR_ORGANIZATION_ID,
    })
  })

  afterAll(async () => {
    // Clean up: archive all created products
    for (const productId of createdProductIds) {
      try {
        await polarClient.products.update({
          id: productId,
          productUpdate: {
            isArchived: true,
          },
        })
      } catch (error) {
        console.error(`Error archiving product ${productId}:`, error)
      }
    }
  })

  describe("defineProduct", () => {
    it("should define a product with fixed pricing", () => {
      const product = store.defineProduct({
        key: "test-fixed-product",
        name: "Test Fixed Product",
        description: "A test product with fixed pricing",
        prices: [
          {
            amountType: "fixed",
            priceAmount: 19.99,
            priceCurrency: "usd",
          },
        ],
      })

      expect(product).toBeDefined()
      expect(product.metadata?.key).toBe("test-fixed-product")
      const fixedPrice = product.prices[0]
      if (fixedPrice.amountType === "fixed") {
        expect(fixedPrice.priceAmount).toBe(1999) // Should be converted to cents
        expect(fixedPrice.priceCurrency).toBe("usd")
      }
    })

    it("should define a product with recurring interval", () => {
      const product = store.defineProduct({
        key: "test-recurring-product",
        name: "Test Recurring Product",
        description: "A test product with monthly recurring billing",
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

      expect(product).toBeDefined()
      expect(product.recurringInterval).toBe("month")
      expect(product.recurringIntervalCount).toBe(1)
      const fixedPrice = product.prices[0]
      if (fixedPrice.amountType === "fixed") {
        expect(fixedPrice.priceAmount).toBe(2999)
      }
    })

    it("should define a product with custom pricing", () => {
      const product = store.defineProduct({
        key: "test-custom-product",
        name: "Test Custom Product",
        description: "A test product with custom pricing",
        prices: [
          {
            amountType: "custom",
            presetAmount: 50,
            minimumAmount: 10,
            maximumAmount: 100,
            priceCurrency: "usd",
          },
        ],
      })

      expect(product).toBeDefined()
      expect(product.prices[0].amountType).toBe("custom")
    })

    it("should define a product with free pricing", () => {
      const product = store.defineProduct({
        key: "test-free-product",
        name: "Test Free Product",
        description: "A test product with free pricing",
        prices: [
          {
            amountType: "free",
          },
        ],
      })

      expect(product).toBeDefined()
      expect(product.prices[0].amountType).toBe("free")
    })

    it("should define a virtual product", () => {
      const product = store.defineProduct({
        key: "test-virtual-product",
        name: "Test Virtual Product",
        description: "A virtual product that doesn't sync to Polar",
        virtual: true,
        id: "virtual-test-123",
        prices: [
          {
            amountType: "fixed",
            priceAmount: 9.99,
            priceCurrency: "usd",
          },
        ],
      })

      expect(product).toBeDefined()
      expect(product.virtual).toBe(true)
      if ("id" in product && product.id) {
        expect(product.id).toBe("virtual-test-123")
      }
    })

    it("should include custom metadata", () => {
      const product = store.defineProduct({
        key: "test-metadata-product",
        name: "Test Metadata Product",
        description: "A product with custom metadata",
        prices: [
          {
            amountType: "fixed",
            priceAmount: 15.99,
            priceCurrency: "usd",
          },
        ],
        metadata: {
          maxUsers: 10,
          featureList: "feature1,feature2",
        },
      })

      expect(product.metadata?.key).toBe("test-metadata-product")
      expect(product.metadata?.maxUsers).toBe(10)
      expect(product.metadata?.featureList).toBe("feature1,feature2")
    })
  })

  describe("push", () => {
    it("should create a new product in Polar", async () => {
      const uniqueKey = `test-sync-create-${Date.now()}`
      store.defineProduct({
        key: uniqueKey,
        name: "Test Sync Create Product",
        description: "A product created via sync",
        prices: [
          {
            amountType: "fixed",
            priceAmount: 39.99,
            priceCurrency: "usd",
          },
        ],
      })

      await store.push()

      // Download all products from Polar to verify sync
      const products = await fetchPolarIterator(
        polarClient.products.list({
          organizationId: POLAR_ORGANIZATION_ID!,
        }),
      )

      const createdProduct = products.find((p) => p.metadata?.key === uniqueKey)
      expect(createdProduct).toBeDefined()
      expect(createdProduct?.name).toBe("Test Sync Create Product")
      expect(createdProduct?.description).toBe("A product created via sync")

      // Verify prices match
      const fixedPrice = createdProduct?.prices.find((p) => p.amountType === "fixed")
      expect(fixedPrice).toBeDefined()
      if (fixedPrice && "priceAmount" in fixedPrice) {
        expect(fixedPrice.priceAmount).toBe(3999) // 39.99 * 100 cents
        expect(fixedPrice.priceCurrency).toBe("usd")
      }

      if (createdProduct?.id) {
        createdProductIds.push(createdProduct.id)
      }
    }, 30000)

    it("should update an existing product in Polar", async () => {
      // First, create a product
      const uniqueKey = `test-sync-update-${Date.now()}`
      store.defineProduct({
        key: uniqueKey,
        name: "Test Sync Update Product - Original",
        description: "Original description",
        prices: [
          {
            amountType: "fixed",
            priceAmount: 49.99,
            priceCurrency: "usd",
          },
        ],
      })

      await store.push()

      // Download products to verify creation
      let products = await fetchPolarIterator(
        polarClient.products.list({
          organizationId: POLAR_ORGANIZATION_ID!,
        }),
      )

      const createdProduct = products.find((p) => p.metadata?.key === uniqueKey)
      expect(createdProduct).toBeDefined()
      expect(createdProduct?.name).toBe("Test Sync Update Product - Original")

      // Verify original prices match
      const originalPrice = createdProduct?.prices.find((p) => p.amountType === "fixed")
      expect(originalPrice).toBeDefined()
      if (originalPrice && "priceAmount" in originalPrice) {
        expect(originalPrice.priceAmount).toBe(4999) // 49.99 * 100 cents
        expect(originalPrice.priceCurrency).toBe("usd")
      }

      if (createdProduct?.id) {
        createdProductIds.push(createdProduct.id)
      }

      // Now update it
      store.defineProduct({
        key: uniqueKey,
        name: "Test Sync Update Product - Updated",
        description: "Updated description",
        prices: [
          {
            amountType: "fixed",
            priceAmount: 59.99,
            priceCurrency: "usd",
          },
        ],
      })

      await store.push()

      // Download products again to verify update
      products = await fetchPolarIterator(
        polarClient.products.list({
          organizationId: POLAR_ORGANIZATION_ID!,
        }),
      )

      const updatedProduct = products.find((p) => p.metadata?.key === uniqueKey)

      expect(updatedProduct).toBeDefined()
      expect(updatedProduct?.name).toBe("Test Sync Update Product - Updated")
      expect(updatedProduct?.description).toBe("Updated description")

      // Verify updated prices match
      const updatedPrice = updatedProduct?.prices.find((p) => p.amountType === "fixed")
      expect(updatedPrice).toBeDefined()
      if (updatedPrice && "priceAmount" in updatedPrice) {
        expect(updatedPrice.priceAmount).toBe(5999) // 59.99 * 100 cents
        expect(updatedPrice.priceCurrency).toBe("usd")
      }
    }, 30000)

    it("should handle virtual products without syncing", async () => {
      const virtualKey = `test-virtual-sync-${Date.now()}`
      store.defineProduct({
        key: virtualKey,
        name: "Test Virtual Sync Product",
        description: "A virtual product",
        virtual: true,
        id: `virtual-${Date.now()}`,
        prices: [
          {
            amountType: "fixed",
            priceAmount: 9.99,
            priceCurrency: "usd",
          },
        ],
      })

      await store.push()

      // Download all products from Polar to verify virtual products are NOT synced
      const products = await fetchPolarIterator(
        polarClient.products.list({
          organizationId: POLAR_ORGANIZATION_ID!,
        }),
      )

      // Virtual products should not exist in Polar
      const existsInPolar = products.some((p) => p.metadata?.key === virtualKey)
      expect(existsInPolar).toBe(false)
    }, 30000)

    it("should convert price amounts to cents correctly", async () => {
      const uniqueKey = `test-price-conversion-${Date.now()}`
      store.defineProduct({
        key: uniqueKey,
        name: "Test Price Conversion",
        description: "Testing price conversion to cents",
        prices: [
          {
            amountType: "fixed",
            priceAmount: 12.34, // Should become 1234 cents
            priceCurrency: "usd",
          },
        ],
      })

      await store.push()

      // Download all products from Polar to verify sync
      const products = await fetchPolarIterator(
        polarClient.products.list({
          organizationId: POLAR_ORGANIZATION_ID!,
        }),
      )

      const product = products.find((p) => p.metadata?.key === uniqueKey)
      expect(product).toBeDefined()

      const price = product?.prices.find((p) => p.amountType === "fixed")
      expect(price).toBeDefined()
      // The price in Polar should be in cents
      if (price && "priceAmount" in price) {
        expect(price.priceAmount).toBe(1234) // 12.34 * 100 cents
        expect(price.priceCurrency).toBe("usd")
      }

      if (product?.id) {
        createdProductIds.push(product.id)
      }
    }, 30000)
  })
})
