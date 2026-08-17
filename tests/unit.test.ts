import { mkdtemp, readFile, rm } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"
import type { Polar } from "@polar-sh/sdk"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import type { Benefit } from "@polar-sh/sdk/models/components/benefit.js"
import type { Product } from "@polar-sh/sdk/models/components/product.js"
import { createStoreFn } from "../src/index.js"
import { mapVirtualProduct, resolveBenefits, toProductPayload, writeProductsToFile } from "../src/lib.js"
import type { ProductCreateDefinition } from "../src/types.js"
import {
  getErrorCode,
  getErrorMessage,
  getErrorStack,
  toCamelCase,
} from "../src/utils.js"

function stubPolarClient(): Polar {
  return {} as Polar
}

function baseDefinition(overrides: ProductCreateDefinition): ProductCreateDefinition {
  return {
    virtual: true,
    ...overrides,
  }
}

function stubCustomBenefit(key: string, id = `ben_${key}`): Benefit {
  return {
    id,
    createdAt: new Date(),
    modifiedAt: null,
    type: "custom",
    description: key,
    selectable: true,
    deletable: true,
    isDeleted: false,
    organizationId: "org_test",
    metadata: { key },
    visibility: "public",
    properties: { note: null },
    visibilityConfigurable: true,
  }
}

function asPageIterator<T>(items: T[]) {
  return Promise.resolve(
    (function* () {
      yield {
        result: {
          items,
          pagination: { totalCount: items.length, maxPage: 1 },
        },
      }
    })(),
  )
}

function createMemoryPolar() {
  const benefits: Benefit[] = []
  const products: Array<Product & { metadata: { key?: string } }> = []
  let nextId = 1

  const client = {
    benefits: {
      list: () => asPageIterator(benefits),
      create: (payload: { metadata?: { key?: string }; description: string; type: string }) => {
        const created = stubCustomBenefit(String(payload.metadata?.key), `ben_${nextId++}`)
        Object.assign(created, payload, { id: created.id })
        benefits.push(created)
        return created
      },
      update: ({
        id,
        requestBody,
      }: {
        id: string
        requestBody: { description?: string; metadata?: { key?: string } }
      }) => {
        const existing = benefits.find((benefit) => benefit.id === id)
        if (!existing) throw new Error(`missing benefit ${id}`)
        Object.assign(existing, requestBody)
        return existing
      },
    },
    products: {
      list: () => asPageIterator(products),
      create: (payload: { name: string; metadata?: { key?: string } }) => {
        const created = {
          id: `prod_${nextId++}`,
          name: payload.name,
          metadata: payload.metadata ?? {},
          benefits: [] as Benefit[],
        }
        products.push(created as (typeof products)[number])
        return created
      },
      update: ({ id, productUpdate }: { id: string; productUpdate: { name?: string } }) => {
        const existing = products.find((product) => product.id === id)
        if (!existing) throw new Error(`missing product ${id}`)
        Object.assign(existing, productUpdate)
        return existing
      },
      updateBenefits: ({
        id,
        productBenefitsUpdate,
      }: {
        id: string
        productBenefitsUpdate: { benefits: string[] }
      }) => {
        const existing = products.find((product) => product.id === id)
        if (!existing) throw new Error(`missing product ${id}`)
        existing.benefits = productBenefitsUpdate.benefits.map((benefitId) => {
          const benefit = benefits.find((item) => item.id === benefitId)
          if (!benefit) throw new Error(`missing benefit id ${benefitId}`)
          return benefit
        })
        return existing
      },
    },
  }

  return { client: client as unknown as Polar, benefits, products }
}

describe("toCamelCase", () => {
  it("converts spaced, dashed, and underscored names", () => {
    expect(toCamelCase("CLI Test Product")).toBe("cliTestProduct")
    expect(toCamelCase("my-product_name")).toBe("myProductName")
    expect(toCamelCase("AlreadyCamel")).toBe("alreadycamel")
  })

  it("returns empty/falsy input unchanged", () => {
    expect(toCamelCase("")).toBe("")
  })
})

describe("error helpers", () => {
  it("reads message and stack from Error instances", () => {
    const error = new Error("boom")
    expect(getErrorMessage(error)).toBe("boom")
    expect(getErrorStack(error)).toContain("Error: boom")
  })

  it("stringifies non-Error values", () => {
    expect(getErrorMessage("plain")).toBe("plain")
    expect(getErrorMessage(42)).toBe("42")
    expect(getErrorStack("plain")).toBeUndefined()
  })

  it("reads string error codes from objects", () => {
    expect(getErrorCode({ code: "ENOENT" })).toBe("ENOENT")
    expect(getErrorCode({ code: 123 })).toBeUndefined()
    expect(getErrorCode("nope")).toBeUndefined()
  })
})

describe("defineProduct", () => {
  const store = createStoreFn({
    client: stubPolarClient(),
    organizationId: "org_test",
  })

  it("converts fixed and custom amounts to cents", () => {
    const product = store.defineProduct({
      key: "cents-product",
      name: "Cents Product",
      prices: [
        {
          amountType: "fixed",
          priceAmount: 12.34,
          priceCurrency: "usd",
        },
      ],
    })

    const price = product.prices[0]
    expect(price.amountType).toBe("fixed")
    if (price.amountType === "fixed") {
      expect(price.priceAmount).toBe(1234)
    }
  })

  it("converts custom price bounds to cents", () => {
    const product = store.defineProduct({
      key: "custom-cents",
      name: "Custom Cents",
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

    const price = product.prices[0]
    expect(price.amountType).toBe("custom")
    if (price.amountType === "custom") {
      expect(price.presetAmount).toBe(5000)
      expect(price.minimumAmount).toBe(1000)
      expect(price.maximumAmount).toBe(10000)
    }
  })

  it("keeps free fixed prices at zero cents", () => {
    const product = store.defineProduct({
      key: "free-product",
      name: "Free Product",
      prices: [{ amountType: "fixed", priceAmount: 0 }],
    })

    const price = product.prices[0]
    expect(price.amountType).toBe("fixed")
    if (price.amountType === "fixed") {
      expect(price.priceAmount).toBe(0)
    }
  })

  it("stores key in metadata and preserves custom metadata", () => {
    const product = store.defineProduct({
      key: "meta-product",
      name: "Meta Product",
      prices: [{ amountType: "fixed", priceAmount: 1 }],
      metadata: { maxUsers: 10, flagged: true },
    })

    expect(product.metadata.key).toBe("meta-product")
    expect(product.metadata.maxUsers).toBe(10)
    expect(product.metadata.flagged).toBe(true)
  })

  it("accepts benefit keys on the definition", () => {
    const store = createStoreFn({
      client: stubPolarClient(),
      organizationId: "org_test",
    })

    const product = store.defineProduct({
      key: "pro",
      name: "Pro Plan",
      prices: [{ amountType: "fixed", priceAmount: 1 }],
      benefits: ["priority-support"],
    })

    expect(product.benefits).toEqual(["priority-support"])
  })

  it("converts metered unitAmount and capAmount from dollars", () => {
    const store = createStoreFn({
      client: stubPolarClient(),
      organizationId: "org_test",
    })

    const product = store.defineProduct({
      key: "usage",
      name: "Usage Plan",
      recurringInterval: "month",
      recurringIntervalCount: 1,
      prices: [
        {
          amountType: "metered_unit",
          meter: "invocations",
          unitAmount: 0.1,
          capAmount: 50,
          priceCurrency: "usd",
        },
      ],
    })

    const price = product.prices[0]
    expect(price.amountType).toBe("metered_unit")
    if (price.amountType === "metered_unit") {
      expect(price.meter).toBe("invocations")
      expect(price.unitAmount).toBe(10)
      expect(price.capAmount).toBe(5000)
      expect(price).not.toHaveProperty("meterId")
    }
  })
})

describe("defineBenefit", () => {
  const store = createStoreFn({
    client: stubPolarClient(),
    organizationId: "org_test",
  })

  it("stores key in metadata and keeps Polar fields", () => {
    const benefit = store.defineBenefit({
      key: "priority-support",
      type: "custom",
      description: "Priority support",
      properties: { note: "Email support@example.com" },
      metadata: { tier: "pro" },
    })

    expect(benefit.metadata.key).toBe("priority-support")
    expect(benefit.metadata.tier).toBe("pro")
    expect(benefit.type).toBe("custom")
    expect(benefit.description).toBe("Priority support")
    if (benefit.type === "custom") {
      expect(benefit.properties.note).toBe("Email support@example.com")
    }
  })

  it("accepts a meter key on meter_credit properties", () => {
    const store = createStoreFn({
      client: stubPolarClient(),
      organizationId: "org_test",
    })

    const benefit = store.defineBenefit({
      key: "included-invocations",
      type: "meter_credit",
      description: "1,000 invocations included",
      properties: {
        meter: "invocations",
        units: 1000,
        rollover: false,
      },
    })

    expect(benefit.type).toBe("meter_credit")
    if (benefit.type === "meter_credit") {
      expect(benefit.properties.meter).toBe("invocations")
      expect(benefit.properties.units).toBe(1000)
      expect(benefit.properties.rollover).toBe(false)
      expect(benefit.properties).not.toHaveProperty("meterId")
    }
  })
})

describe("defineMeter", () => {
  const store = createStoreFn({
    client: stubPolarClient(),
    organizationId: "org_test",
  })

  it("stores key in metadata and keeps Polar fields", () => {
    const meter = store.defineMeter({
      key: "invocations",
      name: "Invocations",
      unit: "custom",
      customLabel: "invocation",
      filter: {
        conjunction: "and",
        clauses: [{ property: "name", operator: "eq", value: "invocation" }],
      },
      aggregation: { func: "count" },
      metadata: { kind: "usage" },
    })

    expect(meter.metadata.key).toBe("invocations")
    expect(meter.metadata.kind).toBe("usage")
    expect(meter.name).toBe("Invocations")
    expect(meter.unit).toBe("custom")
    expect(meter.customLabel).toBe("invocation")
    expect(meter.filter.conjunction).toBe("and")
    expect(meter.aggregation.func).toBe("count")
  })
})

describe("resolveBenefits", () => {
  const support = stubCustomBenefit("priority-support")
  const byKey = new Map<string, Benefit>([["priority-support", support]])

  it("returns an empty list when benefits are omitted or empty", () => {
    expect(resolveBenefits("Pro Plan", undefined, byKey)).toEqual([])
    expect(resolveBenefits("Pro Plan", [], byKey)).toEqual([])
  })

  it("resolves keys to Polar benefits", () => {
    expect(resolveBenefits("Pro Plan", ["priority-support"], byKey)).toEqual([support])
  })

  it("throws with product name and key when a key is unknown", () => {
    expect(() => resolveBenefits("Pro Plan", ["missing"], byKey)).toThrow(
      "Unknown benefit key 'missing' on product 'Pro Plan'",
    )
  })
})

describe("toProductPayload", () => {
  it("strips virtual, id, and benefits from the Polar payload", () => {
    const payload = toProductPayload(
      baseDefinition({
        id: "virtual-id",
        name: "Pro Plan",
        metadata: { key: "pro" },
        prices: [{ amountType: "fixed", priceAmount: 100 }],
        benefits: ["priority-support"],
      }),
    )

    expect(payload).not.toHaveProperty("virtual")
    expect(payload).not.toHaveProperty("id")
    expect(payload).not.toHaveProperty("benefits")
    expect(payload.name).toBe("Pro Plan")
    expect(payload.metadata.key).toBe("pro")
  })
})

describe("mapVirtualProduct", () => {
  it("uses explicit id when provided", () => {
    const product = mapVirtualProduct(
      baseDefinition({
        id: "virtual-explicit-id",
        name: "Virtual Product",
        metadata: { key: "virtual-key" },
        prices: [{ amountType: "fixed", priceAmount: 999, priceCurrency: "usd" }],
      }),
    )

    expect(product.id).toBe("virtual-explicit-id")
    expect(product.metadata.key).toBe("virtual-key")
    expect(product.isRecurring).toBe(false)
    expect(product.meterInterval).toBeNull()
    expect(product.meterIntervalCount).toBeNull()
    expect(product.visibility).toBe("public")
  })

  it("falls back to metadata.key as id", () => {
    const product = mapVirtualProduct(
      baseDefinition({
        name: "Keyed Virtual",
        metadata: { key: "from-key" },
        prices: [{ amountType: "fixed", priceAmount: 100 }],
      }),
    )

    expect(product.id).toBe("from-key")
  })

  it("maps free fixed prices and default currency", () => {
    const product = mapVirtualProduct(
      baseDefinition({
        name: "Free Virtual",
        metadata: { key: "free-virtual" },
        prices: [{ amountType: "fixed", priceAmount: 0 }],
      }),
    )

    const price = product.prices[0]
    expect(price.amountType).toBe("fixed")
    if (price.amountType === "fixed") {
      expect(price.priceAmount).toBe(0)
      expect(price.priceCurrency).toBe("usd")
      expect(price.taxBehavior).toBeNull()
      expect(price.source).toBe("catalog")
      expect(price.productId).toBe("free-virtual")
    }
  })

  it("maps custom prices", () => {
    const product = mapVirtualProduct(
      baseDefinition({
        name: "Custom Virtual",
        metadata: { key: "custom-virtual" },
        prices: [
          {
            amountType: "custom",
            presetAmount: 500,
            minimumAmount: 100,
            maximumAmount: 1000,
            priceCurrency: "eur",
          },
        ],
      }),
    )

    const price = product.prices[0]
    expect(price.amountType).toBe("custom")
    if (price.amountType === "custom") {
      expect(price.presetAmount).toBe(500)
      expect(price.minimumAmount).toBe(100)
      expect(price.maximumAmount).toBe(1000)
      expect(price.priceCurrency).toBe("eur")
    }
  })

  it("maps metered unit prices with meter defaults", () => {
    const product = mapVirtualProduct(
      baseDefinition({
        name: "Metered Virtual",
        recurringInterval: "month",
        recurringIntervalCount: 1,
        meterInterval: "month",
        meterIntervalCount: 1,
        metadata: { key: "metered-virtual" },
        prices: [
          {
            amountType: "metered_unit",
            meter: "invocations",
            unitAmount: "1.5",
            capAmount: 5000,
            priceCurrency: "usd",
          },
        ],
      }),
    )

    expect(product.isRecurring).toBe(true)
    expect(product.recurringInterval).toBe("month")
    expect(product.meterInterval).toBe("month")
    expect(product.meterIntervalCount).toBe(1)

    const price = product.prices[0]
    expect(price.amountType).toBe("metered_unit")
    if (price.amountType === "metered_unit") {
      expect(price.capAmount).toBe(5000)
      expect(price.meter.unit).toBe("scalar")
      expect(price.meter.customLabel).toBeNull()
      expect(price.meter.customMultiplier).toBeNull()
    }
  })

  it("maps seat-based tiers and derives min/max seats", () => {
    const product = mapVirtualProduct(
      baseDefinition({
        name: "Seat Virtual",
        metadata: { key: "seat-virtual" },
        prices: [
          {
            amountType: "seat_based",
            priceCurrency: "usd",
            seatTiers: {
              tiers: [
                { minSeats: 1, maxSeats: 5, pricePerSeat: 1000 },
                { minSeats: 6, maxSeats: null, pricePerSeat: 800 },
              ],
            },
          },
        ],
      }),
    )

    const price = product.prices[0]
    expect(price.amountType).toBe("seat_based")
    if (price.amountType === "seat_based") {
      expect(price.seatTiers.minimumSeats).toBe(1)
      expect(price.seatTiers.maximumSeats).toBeNull()
      expect(price.seatTiers.tiers).toHaveLength(2)
    }
  })

  it("resolves attached benefit keys from the synced map", () => {
    const support = stubCustomBenefit("priority-support")
    const product = mapVirtualProduct(
      baseDefinition({
        name: "Virtual Pro",
        metadata: { key: "virtual-pro" },
        prices: [{ amountType: "fixed", priceAmount: 0 }],
        benefits: ["priority-support"],
      }),
      new Map([["priority-support", support]]),
    )

    expect(product.benefits).toEqual([support])
  })

  it("uses an empty benefits list when keys are omitted", () => {
    const product = mapVirtualProduct(
      baseDefinition({
        name: "Virtual Free",
        metadata: { key: "virtual-free" },
        prices: [{ amountType: "fixed", priceAmount: 0 }],
      }),
    )

    expect(product.benefits).toEqual([])
  })
})

describe("writeProductsToFile", () => {
  let tempDir: string

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "store-fn-unit-"))
  })

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it("writes typed product exports to disk", async () => {
    const product = mapVirtualProduct(
      baseDefinition({
        name: "Exported Product",
        metadata: { key: "exported-product" },
        prices: [{ amountType: "fixed", priceAmount: 1999, priceCurrency: "usd" }],
      }),
    )

    const outputPath = join(tempDir, "products.ts")
    await writeProductsToFile([product], outputPath)

    const content = await readFile(outputPath, "utf-8")
    expect(content).toContain(
      'import type { Product } from "@polar-sh/sdk/models/components/product.js"',
    )
    expect(content).toContain("exportedProductProduct")
    expect(content).toContain("Exported Product")
    expect(content).toContain("as const satisfies Product")
  })
})

describe("push benefits", () => {
  it("creates a benefit and attaches it by key", async () => {
    const { client, benefits, products } = createMemoryPolar()
    const store = createStoreFn({ client, organizationId: "org_test" })

    store.defineBenefit({
      key: "priority-support",
      type: "custom",
      description: "Priority support",
      properties: { note: null },
    })
    store.defineProduct({
      key: "pro",
      name: "Pro Plan",
      prices: [{ amountType: "fixed", priceAmount: 10 }],
      benefits: ["priority-support"],
    })

    const result = await store.push()

    expect(benefits).toHaveLength(1)
    expect(benefits[0]?.metadata.key).toBe("priority-support")
    expect(products[0]?.benefits.map((benefit) => benefit.metadata.key)).toEqual([
      "priority-support",
    ])
    expect(result.updatedProducts[0]?.benefits[0]?.id).toBe(benefits[0]?.id)
  })

  it("updates an existing benefit by metadata.key and does not delete orphans", async () => {
    const { client, benefits } = createMemoryPolar()
    benefits.push(stubCustomBenefit("priority-support", "ben_existing"))
    benefits.push(stubCustomBenefit("orphan", "ben_orphan"))

    const store = createStoreFn({ client, organizationId: "org_test" })
    store.defineBenefit({
      key: "priority-support",
      type: "custom",
      description: "Priority support plus",
      properties: { note: null },
    })
    store.defineProduct({
      key: "pro",
      name: "Pro Plan",
      prices: [{ amountType: "fixed", priceAmount: 10 }],
    })

    await store.push()

    expect(benefits.map((benefit) => benefit.id)).toEqual(["ben_existing", "ben_orphan"])
    expect(benefits[0]?.description).toBe("Priority support plus")
  })

  it("replaces attachments with an empty list when benefits are omitted", async () => {
    const { client, benefits, products } = createMemoryPolar()
    const existingBenefit = stubCustomBenefit("priority-support", "ben_existing")
    benefits.push(existingBenefit)
    products.push({
      id: "prod_existing",
      name: "Pro Plan",
      metadata: { key: "pro" },
      benefits: [existingBenefit],
    } as (typeof products)[number])

    const store = createStoreFn({ client, organizationId: "org_test" })
    store.defineProduct({
      key: "pro",
      name: "Pro Plan",
      prices: [{ amountType: "fixed", priceAmount: 10 }],
    })

    const result = await store.push()

    expect(result.updatedProducts[0]?.benefits).toEqual([])
  })

  it("throws before attach when a product references an unknown key", async () => {
    const { client, products } = createMemoryPolar()
    const store = createStoreFn({ client, organizationId: "org_test" })

    store.defineProduct({
      key: "pro",
      name: "Pro Plan",
      prices: [{ amountType: "fixed", priceAmount: 10 }],
      benefits: ["missing"],
    })

    await expect(store.push()).rejects.toThrow(
      "Unknown benefit key 'missing' on product 'Pro Plan'",
    )
    expect(products).toHaveLength(0)
  })

  it("maps virtual products with synced Polar benefits", async () => {
    const { client, benefits, products } = createMemoryPolar()
    const store = createStoreFn({ client, organizationId: "org_test" })

    store.defineBenefit({
      key: "priority-support",
      type: "custom",
      description: "Priority support",
      properties: { note: null },
    })
    store.defineProduct({
      virtual: true,
      key: "local-pro",
      name: "Local Pro",
      prices: [{ amountType: "fixed", priceAmount: 0 }],
      benefits: ["priority-support"],
    })

    const result = await store.push()

    expect(products).toHaveLength(0)
    expect(result.updatedProducts[0]?.benefits[0]?.metadata.key).toBe("priority-support")
    expect(result.updatedProducts[0]?.benefits[0]?.id).toBe(benefits[0]?.id)
  })
})
