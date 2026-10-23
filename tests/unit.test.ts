import { mkdtemp, readFile, rm } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { createStoreFn } from "../src/index.js"
import {
  mapVirtualProduct,
  resolveBenefits,
  resolveMeter,
  toBenefitPayload,
  toMeterUpdatePayload,
  toProductPayload,
  writeProductsToFile,
} from "../src/lib.js"
import { getErrorCode, getErrorMessage, getErrorStack, toCamelCase } from "../src/utils.js"

import type { ProductCreateDefinition } from "../src/types.js"
import type { Polar } from "@polar-sh/sdk"
import type { Benefit } from "@polar-sh/sdk/models/components/benefit.js"
import type { Meter } from "@polar-sh/sdk/models/components/meter.js"
import type { Product } from "@polar-sh/sdk/models/components/product.js"

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

function stubMeter(key: string, id = `meter_${key}`): Meter {
  return {
    id,
    createdAt: new Date(),
    modifiedAt: null,
    name: key,
    unit: "custom",
    customLabel: "invocation",
    customMultiplier: null,
    filter: {
      conjunction: "and",
      clauses: [{ property: "name", operator: "eq", value: "invocation" }],
    },
    aggregation: { func: "count" },
    metadata: { key },
    organizationId: "org_test",
    archivedAt: null,
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
  const products: Array<Product & { metadata: { key?: string }; prices?: unknown[] }> = []
  const meters: Meter[] = []
  const meterUpdates: Array<{ id: string; meterUpdate: Partial<Meter> }> = []
  let nextId = 1

  const client = {
    meters: {
      list: () => asPageIterator(meters),
      create: (payload: {
        name: string
        metadata?: { key?: string }
        unit?: Meter["unit"]
        customLabel?: string | null
        filter: Meter["filter"]
        aggregation: Meter["aggregation"]
      }) => {
        const created = stubMeter(String(payload.metadata?.key), `meter_${nextId++}`)
        Object.assign(created, payload, { id: created.id })
        meters.push(created)
        return created
      },
      update: ({ id, meterUpdate }: { id: string; meterUpdate: Partial<Meter> }) => {
        const existing = meters.find((meter) => meter.id === id)
        if (!existing) throw new Error(`missing meter ${id}`)
        meterUpdates.push({ id, meterUpdate })
        Object.assign(existing, meterUpdate)
        return existing
      },
    },
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
      create: (payload: { name: string; metadata?: { key?: string }; prices?: unknown[] }) => {
        const created = {
          id: `prod_${nextId++}`,
          name: payload.name,
          metadata: payload.metadata ?? {},
          benefits: [] as Benefit[],
          prices: payload.prices ?? [],
        }
        products.push(created as (typeof products)[number])
        return created
      },
      update: ({
        id,
        productUpdate,
      }: {
        id: string
        productUpdate: { name?: string; prices?: unknown[] }
      }) => {
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

  return { client: client as unknown as Polar, benefits, products, meters, meterUpdates }
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

  it("accepts amountType free without a priceAmount", () => {
    const product = store.defineProduct({
      key: "free-amount-type",
      name: "Free Amount Type",
      prices: [{ amountType: "free" }],
    })

    const price = product.prices[0]
    expect(price.amountType).toBe("free")
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

describe("resolveMeter", () => {
  const invocations = stubMeter("invocations")
  const byKey = new Map<string, Meter>([["invocations", invocations]])

  it("resolves a key to a Polar meter", () => {
    expect(resolveMeter("product", "Pro Plan", "invocations", byKey)).toBe(invocations)
  })

  it("throws with product name and key when a key is unknown", () => {
    expect(() => resolveMeter("product", "Pro Plan", "missing", byKey)).toThrow(
      "Unknown meter key 'missing' on product 'Pro Plan'",
    )
  })

  it("throws with benefit description and key when a key is unknown", () => {
    expect(() => resolveMeter("benefit", "1,000 included", "missing", byKey)).toThrow(
      "Unknown meter key 'missing' on benefit '1,000 included'",
    )
  })
})

describe("toBenefitPayload", () => {
  const invocations = stubMeter("invocations", "meter_polar")
  const byKey = new Map<string, Meter>([["invocations", invocations]])

  it("rewrites meter_credit meter to Polar meterId on a copy", () => {
    const stored = {
      type: "meter_credit" as const,
      description: "1,000 invocations included",
      properties: { meter: "invocations", units: 1000, rollover: false },
      metadata: { key: "included-invocations" },
    }
    const payload = toBenefitPayload(stored, byKey)

    expect(payload.type).toBe("meter_credit")
    if (payload.type === "meter_credit") {
      expect(payload.properties.meterId).toBe("meter_polar")
      expect(payload.properties).not.toHaveProperty("meter")
      expect(payload.properties.units).toBe(1000)
    }
    expect(stored.properties.meter).toBe("invocations")
    expect(stored.properties).not.toHaveProperty("meterId")
  })

  it("leaves non-meter_credit benefits unchanged", () => {
    const stored = {
      type: "custom" as const,
      description: "Priority support",
      properties: { note: "hi" },
      metadata: { key: "priority-support" },
    }
    const payload = toBenefitPayload(stored, byKey)
    expect(payload).toEqual(stored)
  })

  it("strips typescript from the Polar payload", () => {
    const stored = {
      type: "custom" as const,
      description: "Priority support",
      properties: { note: "hi" },
      metadata: { key: "priority-support" },
      typescript: { variableName: "prioritySupport" },
    }
    const payload = toBenefitPayload(stored, byKey)

    expect(payload).not.toHaveProperty("typescript")
    expect(payload.description).toBe("Priority support")
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

  it("rewrites metered price meter to Polar meterId on a copy", () => {
    const invocations = stubMeter("invocations", "meter_polar")
    const stored = baseDefinition({
      name: "Pro Plan",
      metadata: { key: "pro" },
      prices: [
        {
          amountType: "metered_unit",
          meter: "invocations",
          unitAmount: 10,
          priceCurrency: "usd",
        },
      ],
    })
    const payload = toProductPayload(stored, new Map([["invocations", invocations]]))
    const price = payload.prices[0]

    expect(price.amountType).toBe("metered_unit")
    if (price.amountType === "metered_unit") {
      expect(price.meterId).toBe("meter_polar")
      expect(price).not.toHaveProperty("meter")
    }
    const storedPrice = stored.prices[0]
    if (storedPrice.amountType === "metered_unit") {
      expect(storedPrice.meter).toBe("invocations")
      expect(storedPrice).not.toHaveProperty("meterId")
    }
  })

  it("maps amountType free to Polar fixed zero cents", () => {
    const stored = baseDefinition({
      name: "Hobby Plan",
      metadata: { key: "hobby" },
      prices: [{ amountType: "free", priceCurrency: "usd" }],
    })
    const payload = toProductPayload(stored)
    const price = payload.prices[0]

    expect(price).toEqual({
      amountType: "fixed",
      priceAmount: 0,
      priceCurrency: "usd",
    })
    expect(stored.prices[0]).toEqual({ amountType: "free", priceCurrency: "usd" })
  })

  it("strips typescript from the Polar payload", () => {
    const payload = toProductPayload(
      baseDefinition({
        name: "Hobby Plan",
        metadata: { key: "hobby" },
        prices: [{ amountType: "fixed", priceAmount: 0, priceCurrency: "usd" }],
        typescript: { variableName: "hobby" },
      }),
    )

    expect(payload).not.toHaveProperty("typescript")
    expect(payload.name).toBe("Hobby Plan")
  })
})

describe("toMeterUpdatePayload", () => {
  it("strips typescript from the Polar update payload", () => {
    const existing = stubMeter("invocations")
    const payload = toMeterUpdatePayload(
      {
        name: "Invocations",
        filter: existing.filter,
        aggregation: existing.aggregation,
        metadata: { key: "invocations" },
        typescript: { variableName: "invocationsMeter" },
      },
      existing,
    )

    expect(payload).not.toHaveProperty("typescript")
    expect(payload.name).toBe("Invocations")
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

  it("maps amountType free to a zero fixed Polar price", () => {
    const product = mapVirtualProduct(
      baseDefinition({
        name: "Free Virtual",
        metadata: { key: "free-virtual" },
        prices: [{ amountType: "free", priceCurrency: "eur" }],
      }),
    )

    const price = product.prices[0]
    expect(price.amountType).toBe("fixed")
    if (price.amountType === "fixed") {
      expect(price.priceAmount).toBe(0)
      expect(price.priceCurrency).toBe("eur")
      expect(price.productId).toBe("free-virtual")
    }
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

  it("maps metered unit prices from the synced meter map", () => {
    const invocations = stubMeter("invocations", "meter_polar")
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
            unitAmount: 10,
            capAmount: 5000,
            priceCurrency: "usd",
          },
        ],
      }),
      new Map(),
      new Map([["invocations", invocations]]),
    )

    expect(product.meterInterval).toBe("month")
    expect(product.meterIntervalCount).toBe(1)

    const price = product.prices[0]
    expect(price.amountType).toBe("metered_unit")
    if (price.amountType === "metered_unit") {
      expect(price.meterId).toBe("meter_polar")
      expect(price.meter.id).toBe("meter_polar")
      expect(price.meter.name).toBe("invocations")
      expect(price.meter.unit).toBe("custom")
      expect(price.meter.customLabel).toBe("invocation")
      expect(price.unitAmount).toBe("10")
      expect(price.capAmount).toBe(5000)
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

  it("writes Polar entity ids, not store keys", async () => {
    const productId = "11111111-1111-4111-8111-111111111111"
    const priceId = "22222222-2222-4222-8222-222222222222"
    const product = mapVirtualProduct(
      baseDefinition({
        id: productId,
        name: "Hobby Plan",
        metadata: { key: "pdfgo_hobby" },
        prices: [{ amountType: "fixed", priceAmount: 0, priceCurrency: "usd" }],
      }),
    )
    const price = product.prices[0]
    expect(price).toBeDefined()
    if (!price) {
      throw new Error("expected a mapped price")
    }
    price.id = priceId

    const outputPath = join(tempDir, "polar-ids.ts")
    await writeProductsToFile([product], outputPath)
    const content = await readFile(outputPath, "utf-8")

    expect(content).toContain(productId)
    expect(content).toContain(priceId)
    expect(content).not.toMatch(/id: "pdfgo_hobby"/)
  })

  it("uses typescript.variableName as the export and omits it from the file", async () => {
    const product = mapVirtualProduct(
      baseDefinition({
        name: "Hobby Plan",
        metadata: { key: "pdfgo_hobby" },
        prices: [{ amountType: "fixed", priceAmount: 0, priceCurrency: "usd" }],
        typescript: { variableName: "hobby" },
      }),
    )

    expect(product).not.toHaveProperty("typescript")

    const outputPath = join(tempDir, "named-product.ts")
    await writeProductsToFile([product], outputPath)
    const content = await readFile(outputPath, "utf-8")

    expect(content).toMatch(/export const hobby =/)
    expect(content).not.toContain("hobbyPlanProduct")
    expect(content).not.toContain("variableName")
  })

  it("keeps a configured name on the product returned by push", async () => {
    const { client, benefits, meters, products } = createMemoryPolar()
    const store = createStoreFn({ client, organizationId: "org_test" })

    store.defineMeter({
      key: "invocations",
      name: "Invocations",
      unit: "custom",
      customLabel: "invocation",
      filter: {
        conjunction: "and",
        clauses: [{ property: "name", operator: "eq", value: "invocation" }],
      },
      aggregation: { func: "count" },
      typescript: { variableName: "invocationsMeter" },
    })
    store.defineBenefit({
      key: "priority-support",
      type: "custom",
      description: "Priority support",
      properties: { note: null },
      typescript: { variableName: "prioritySupport" },
    })
    store.defineProduct({
      key: "hobby",
      name: "Hobby Plan",
      prices: [{ amountType: "fixed", priceAmount: 0 }],
      benefits: ["priority-support"],
      typescript: { variableName: "hobby" },
    })

    const result = await store.push()

    expect(meters[0]).not.toHaveProperty("typescript")
    expect(benefits[0]).not.toHaveProperty("typescript")
    expect(products[0]).not.toHaveProperty("typescript")

    const outputPath = join(tempDir, "pushed-name.ts")
    await writeProductsToFile(result.updatedProducts, outputPath)
    const content = await readFile(outputPath, "utf-8")

    expect(content).toMatch(/export const hobby =/)
    expect(content).not.toContain("hobbyPlanProduct")
    expect(content).not.toContain("variableName")
  })

  it("throws when generated variable names collide", async () => {
    const first = mapVirtualProduct(
      baseDefinition({
        name: "Basic Plan",
        metadata: { key: "basic" },
        prices: [{ amountType: "fixed", priceAmount: 0, priceCurrency: "usd" }],
      }),
    )
    const second = mapVirtualProduct(
      baseDefinition({
        name: "basic-plan",
        metadata: { key: "basic-dashed" },
        prices: [{ amountType: "fixed", priceAmount: 0, priceCurrency: "usd" }],
      }),
    )
    const outputPath = join(tempDir, "duplicate-names.ts")

    await expect(writeProductsToFile([first, second], outputPath)).rejects.toThrow(
      "Duplicate TypeScript variable name 'basicPlanProduct' for product 'Basic Plan' (basic) and product 'basic-plan' (basic-dashed)",
    )
    await expect(readFile(outputPath, "utf-8")).rejects.toThrow()
  })

  it("throws when an explicit variable name collides with a generated one", async () => {
    const first = mapVirtualProduct(
      baseDefinition({
        name: "Other Plan",
        metadata: { key: "other" },
        prices: [{ amountType: "fixed", priceAmount: 0, priceCurrency: "usd" }],
        typescript: { variableName: "basicPlanProduct" },
      }),
    )
    const second = mapVirtualProduct(
      baseDefinition({
        name: "Basic Plan",
        metadata: { key: "basic" },
        prices: [{ amountType: "fixed", priceAmount: 0, priceCurrency: "usd" }],
      }),
    )

    await expect(
      writeProductsToFile([first, second], join(tempDir, "duplicate-explicit.ts")),
    ).rejects.toThrow("Duplicate TypeScript variable name 'basicPlanProduct'")
  })

  it("throws when typescript.variableName is not a valid identifier", async () => {
    const product = mapVirtualProduct(
      baseDefinition({
        name: "Hobby Plan",
        metadata: { key: "hobby" },
        prices: [{ amountType: "fixed", priceAmount: 0, priceCurrency: "usd" }],
        typescript: { variableName: "not-a-name" },
      }),
    )

    await expect(writeProductsToFile([product], join(tempDir, "invalid-name.ts"))).rejects.toThrow(
      "Invalid TypeScript variable name 'not-a-name' for product 'Hobby Plan' (hobby)",
    )
  })

  it("throws when a generated variable name is not a valid identifier", async () => {
    const product = mapVirtualProduct(
      baseDefinition({
        name: "Basic Plan!",
        metadata: { key: "basic" },
        prices: [{ amountType: "fixed", priceAmount: 0, priceCurrency: "usd" }],
      }),
    )

    await expect(
      writeProductsToFile([product], join(tempDir, "invalid-generated.ts")),
    ).rejects.toThrow(
      "Invalid TypeScript variable name 'basicPlan!Product' for product 'Basic Plan!' (basic)",
    )
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

  it("sends amountType free to Polar as a zero fixed price", async () => {
    const { client, products } = createMemoryPolar()
    const store = createStoreFn({ client, organizationId: "org_test" })

    store.defineProduct({
      key: "hobby",
      name: "Hobby Plan",
      prices: [{ amountType: "free" }],
    })

    await store.push()

    expect(products[0]?.prices).toEqual([{ amountType: "fixed", priceAmount: 0 }])
  })

  it("returns Polar entity ids instead of store keys", async () => {
    const { client, meters, benefits, products } = createMemoryPolar()
    const store = createStoreFn({ client, organizationId: "org_test" })

    store.defineMeter({
      key: "invocations",
      name: "Invocations",
      filter: {
        conjunction: "and",
        clauses: [{ property: "name", operator: "eq", value: "invocation" }],
      },
      aggregation: { func: "count" },
    })
    store.defineBenefit({
      key: "included-invocations",
      type: "meter_credit",
      description: "Included invocations",
      properties: { meter: "invocations", units: 100, rollover: false },
    })
    store.defineProduct({
      key: "hobby",
      name: "Hobby Plan",
      prices: [{ amountType: "free" }],
      benefits: ["included-invocations"],
    })

    const result = await store.push()
    const product = result.updatedProducts[0]

    expect(product?.id).toBe(products[0]?.id)
    expect(product?.id).not.toBe("hobby")
    expect(product?.benefits[0]?.id).toBe(benefits[0]?.id)
    expect(product?.benefits[0]?.id).not.toBe("included-invocations")
    expect(meters[0]?.id).not.toBe("invocations")
    if (product?.benefits[0]?.type === "meter_credit") {
      expect(product.benefits[0].properties.meterId).toBe(meters[0]?.id)
    }
  })
})

describe("push meters", () => {
  it("creates a meter and rewrites keys on benefit and product payloads", async () => {
    const { client, meters, benefits, products } = createMemoryPolar()
    const store = createStoreFn({ client, organizationId: "org_test" })

    store.defineMeter({
      key: "invocations",
      name: "Invocations",
      unit: "custom",
      customLabel: "invocation",
      filter: {
        conjunction: "and",
        clauses: [{ property: "name", operator: "eq", value: "invocation" }],
      },
      aggregation: { func: "count" },
    })
    store.defineBenefit({
      key: "included-invocations",
      type: "meter_credit",
      description: "1,000 invocations included",
      properties: { meter: "invocations", units: 1000, rollover: false },
    })
    store.defineProduct({
      key: "pro",
      name: "Pro Plan",
      recurringInterval: "month",
      recurringIntervalCount: 1,
      prices: [
        { amountType: "fixed", priceAmount: 29.99, priceCurrency: "usd" },
        {
          amountType: "metered_unit",
          meter: "invocations",
          unitAmount: 0.1,
          priceCurrency: "usd",
        },
      ],
      benefits: ["included-invocations"],
    })

    const result = await store.push()

    expect(meters).toHaveLength(1)
    expect(meters[0]?.metadata.key).toBe("invocations")
    expect(benefits[0]?.type).toBe("meter_credit")
    if (benefits[0]?.type === "meter_credit") {
      expect(benefits[0].properties.meterId).toBe(meters[0]?.id)
      expect(benefits[0].properties).not.toHaveProperty("meter")
    }
    const metered = products[0]?.prices?.find((price) => price.amountType === "metered_unit")
    expect(metered?.meterId).toBe(meters[0]?.id)
    expect(metered).not.toHaveProperty("meter")
    expect(result.updatedProducts[0]?.benefits[0]?.id).toBe(benefits[0]?.id)
  })

  it("updates an existing meter by metadata.key and does not delete orphans", async () => {
    const { client, meters } = createMemoryPolar()
    meters.push(stubMeter("invocations", "meter_existing"))
    meters.push(stubMeter("orphan", "meter_orphan"))

    const store = createStoreFn({ client, organizationId: "org_test" })
    store.defineMeter({
      key: "invocations",
      name: "API Invocations",
      unit: "custom",
      customLabel: "invocation",
      filter: {
        conjunction: "and",
        clauses: [{ property: "name", operator: "eq", value: "invocation" }],
      },
      aggregation: { func: "count" },
    })
    store.defineProduct({
      key: "pro",
      name: "Pro Plan",
      prices: [{ amountType: "fixed", priceAmount: 10 }],
    })

    await store.push()

    expect(meters.map((meter) => meter.id)).toEqual(["meter_existing", "meter_orphan"])
    expect(meters[0]?.name).toBe("API Invocations")
  })

  it("omits unchanged filter and aggregation so Polar can update a live meter", async () => {
    const { client, meters, meterUpdates } = createMemoryPolar()
    const existing = stubMeter("document-generation", "meter_existing")
    existing.name = "Document Generation"
    existing.filter = {
      conjunction: "and",
      clauses: [{ property: "name", operator: "eq", value: "document_generation" }],
    }
    existing.aggregation = { func: "count" }
    meters.push(existing)

    const store = createStoreFn({ client, organizationId: "org_test" })
    store.defineMeter({
      key: "document-generation",
      name: "Document generations",
      unit: "custom",
      customLabel: "document",
      filter: {
        conjunction: "and",
        clauses: [{ property: "name", operator: "eq", value: "document_generation" }],
      },
      aggregation: { func: "count" },
    })
    store.defineProduct({
      key: "pro-v2",
      name: "Pro Plan",
      prices: [{ amountType: "fixed", priceAmount: 10 }],
    })

    await store.push()

    expect(meterUpdates).toHaveLength(1)
    expect(meterUpdates[0]?.meterUpdate).not.toHaveProperty("filter")
    expect(meterUpdates[0]?.meterUpdate).not.toHaveProperty("aggregation")
    expect(meterUpdates[0]?.meterUpdate.name).toBe("Document generations")
    expect(meters[0]?.name).toBe("Document generations")
  })

  it("still sends filter and aggregation when they actually change", async () => {
    const { client, meters, meterUpdates } = createMemoryPolar()
    meters.push(stubMeter("invocations", "meter_existing"))

    const store = createStoreFn({ client, organizationId: "org_test" })
    store.defineMeter({
      key: "invocations",
      name: "Invocations",
      unit: "custom",
      customLabel: "invocation",
      filter: {
        conjunction: "and",
        clauses: [{ property: "name", operator: "eq", value: "api_invocation" }],
      },
      aggregation: { func: "sum", property: "tokens" },
    })
    store.defineProduct({
      key: "pro",
      name: "Pro Plan",
      prices: [{ amountType: "fixed", priceAmount: 10 }],
    })

    await store.push()

    expect(meterUpdates[0]?.meterUpdate.filter).toEqual({
      conjunction: "and",
      clauses: [{ property: "name", operator: "eq", value: "api_invocation" }],
    })
    expect(meterUpdates[0]?.meterUpdate.aggregation).toEqual({
      func: "sum",
      property: "tokens",
    })
  })

  it("throws before Polar writes when a benefit references an unknown meter key", async () => {
    const { client, benefits, products } = createMemoryPolar()
    const store = createStoreFn({ client, organizationId: "org_test" })

    store.defineBenefit({
      key: "priority-support",
      type: "custom",
      description: "Priority support",
      properties: { note: "Available 24/7" },
    })
    store.defineBenefit({
      key: "included-invocations",
      type: "meter_credit",
      description: "1,000 invocations included",
      properties: { meter: "missing", units: 1000, rollover: false },
    })
    store.defineProduct({
      key: "pro",
      name: "Pro Plan",
      prices: [{ amountType: "fixed", priceAmount: 10 }],
      benefits: ["included-invocations"],
    })

    await expect(store.push()).rejects.toThrow(
      "Unknown meter key 'missing' on benefit '1,000 invocations included'",
    )
    expect(benefits).toHaveLength(0)
    expect(products).toHaveLength(0)
  })

  it("throws before Polar writes when a product references an unknown meter key", async () => {
    const { client, products } = createMemoryPolar()
    const store = createStoreFn({ client, organizationId: "org_test" })

    store.defineProduct({
      key: "starter",
      name: "Starter Plan",
      prices: [{ amountType: "fixed", priceAmount: 5 }],
    })
    store.defineProduct({
      key: "pro",
      name: "Pro Plan",
      recurringInterval: "month",
      recurringIntervalCount: 1,
      prices: [
        {
          amountType: "metered_unit",
          meter: "missing",
          unitAmount: 0.1,
          priceCurrency: "usd",
        },
      ],
    })

    await expect(store.push()).rejects.toThrow("Unknown meter key 'missing' on product 'Pro Plan'")
    expect(products).toHaveLength(0)
  })

  it("maps virtual products with synced Polar meters", async () => {
    const { client, meters, products } = createMemoryPolar()
    const store = createStoreFn({ client, organizationId: "org_test" })

    store.defineMeter({
      key: "invocations",
      name: "Invocations",
      unit: "custom",
      customLabel: "invocation",
      filter: {
        conjunction: "and",
        clauses: [{ property: "name", operator: "eq", value: "invocation" }],
      },
      aggregation: { func: "count" },
    })
    store.defineProduct({
      virtual: true,
      key: "local-usage",
      name: "Local Usage",
      recurringInterval: "month",
      recurringIntervalCount: 1,
      prices: [
        {
          amountType: "metered_unit",
          meter: "invocations",
          unitAmount: 0.1,
          priceCurrency: "usd",
        },
      ],
    })

    const result = await store.push()
    const price = result.updatedProducts[0]?.prices[0]

    expect(products).toHaveLength(0)
    expect(price?.amountType).toBe("metered_unit")
    if (price?.amountType === "metered_unit") {
      expect(price.meterId).toBe(meters[0]?.id)
      expect(price.meter.name).toBe("Invocations")
    }
  })

  it("keeps stored meter keys after push so a second push still resolves", async () => {
    const { client } = createMemoryPolar()
    const store = createStoreFn({ client, organizationId: "org_test" })

    const benefit = store.defineBenefit({
      key: "included-invocations",
      type: "meter_credit",
      description: "1,000 invocations included",
      properties: { meter: "invocations", units: 1000, rollover: false },
    })
    store.defineMeter({
      key: "invocations",
      name: "Invocations",
      unit: "scalar",
      filter: {
        conjunction: "and",
        clauses: [{ property: "name", operator: "eq", value: "invocation" }],
      },
      aggregation: { func: "count" },
    })
    const product = store.defineProduct({
      key: "pro",
      name: "Pro Plan",
      recurringInterval: "month",
      recurringIntervalCount: 1,
      prices: [
        {
          amountType: "metered_unit",
          meter: "invocations",
          unitAmount: 0.1,
          priceCurrency: "usd",
        },
      ],
      benefits: ["included-invocations"],
    })

    await store.push()
    await store.push()

    expect(benefit.type).toBe("meter_credit")
    if (benefit.type === "meter_credit") {
      expect(benefit.properties.meter).toBe("invocations")
    }
    const price = product.prices[0]
    if (price.amountType === "metered_unit") {
      expect(price.meter).toBe("invocations")
    }
  })
})
