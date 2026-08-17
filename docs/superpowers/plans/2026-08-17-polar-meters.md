# Polar Meters Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `store-fn` define Polar meters, sync them by `metadata.key`, and let metered prices and `meter_credit` benefits reference those meters by key on every `push()`.

**Architecture:** Mirror `defineBenefit`. `defineMeter` wraps Polar’s `MeterCreate` and stores `key` in `metadata`. `push()` upserts meters first, then benefits, then products. Helpers rewrite store-only `meter` keys to Polar `meterId` on **copies** so stored definitions stay key-based. `unitAmount` and `capAmount` convert from dollars at define time.

**Tech Stack:** TypeScript, `@polar-sh/sdk` 0.49, Vitest, existing `createStoreFn` / CLI (`writeProductsToFile` only).

## Global Constraints

- No `virtual: true` on meters.
- No generated `meters.ts` (or combined store file). CLI still writes products only.
- Never delete or archive Polar meters that are not in the store config.
- `push()` returns `{ updatedProducts: Product[] }` only.
- Match meters by `metadata.key`, same as products and benefits.
- Metered prices and `meter_credit` benefits use `meter: string` (store-fn key), never Polar `meterId` in the config.
- Rewrite `meter` → `meterId` on copies. Do not mutate stored definitions.
- `unitAmount` and `capAmount` are dollars. Multiply by 100 at define time. `unitAmount` keeps precision (`Number((n * 100).toFixed(12))`). `capAmount` uses `Math.round` like `priceAmount`.
- Polar may reject filter/aggregation updates after events or purchases. Surface that error. No special-case skip.
- No retries, rollback, or extra duplicate-key checks.
- Unknown meter key throws before the Polar call that would need the id. Message includes the product name or benefit description and the key.

---

## File map

| File | Responsibility |
| --- | --- |
| `src/types.ts` | `MeterDefinition`, `MeterCreateDefinition`; remap metered prices and `meter_credit` to `meter` keys |
| `src/lib.ts` | `resolveMeter`, `toBenefitPayload`, `toProductPayload` price rewrite; `mapVirtualProduct` uses Polar meters; `downloadStoreFromCloud` lists meters |
| `src/index.ts` | `defineMeter`; convert `unitAmount` / `capAmount`; `push()` upserts meters first |
| `tests/unit.test.ts` | Unit tests for define, resolve, payload rewrite, virtual mapping, mocked `push()` |
| `tests/store-fn.test.ts` | Polar sandbox integration tests (`skipIf` unchanged) |
| `README.md` | `defineMeter` API and included-usage + overage example |

Do not add new source files. Do not change the CLI except that written products will include Polar’s nested meter on metered prices.

---

### Task 1: Meter types, `defineMeter`, and dollar metered amounts

**Files:**
- Modify: `src/types.ts`
- Modify: `src/index.ts`
- Test: `tests/unit.test.ts`

**Interfaces:**
- Consumes: Polar `MeterCreate` from `@polar-sh/sdk/models/components/metercreate.js`; `ProductPriceMeteredUnitCreate`; `BenefitMeterCreditCreate` / `BenefitMeterCreditCreateProperties`; existing `StoreMetadata` / `createStoreFn`
- Produces: `MeterDefinition<TMeta>`, `MeterCreateDefinition<TMeta>`, `defineMeter(definition: MeterDefinition): MeterCreateDefinition`, remapped product prices (`meter` not `meterId`), remapped `meter_credit` properties (`meter` not `meterId`)

- [ ] **Step 1: Write the failing tests**

Add this helper and describes to `tests/unit.test.ts` (keep existing `stubPolarClient` / `createStoreFn` usage). Also change the existing `mapVirtualProduct` test `"maps metered unit prices with meter defaults"` to use `meter: "invocations"` instead of `meterId: "meter_123"` so types compile after the remap (the stub still ignores the key until Task 2).

```ts
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
```

Add to the existing `defineProduct` describe:

```ts
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
```

Add to the existing `defineBenefit` describe:

```ts
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
```

In `"maps metered unit prices with meter defaults"`, replace `meterId: "meter_123"` with `meter: "invocations"`. Leave the rest of that test as-is for now.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run tests/unit.test.ts -t "defineMeter|converts metered unitAmount|accepts a meter key"`

Expected: FAIL — `defineMeter` is not a function / `meter` is not on the type.

- [ ] **Step 3: Add types**

Replace `src/types.ts` with this (keep product `virtual` / `benefits` wrappers; remap prices and `meter_credit` only):

```ts
import type { BenefitCreate } from "@polar-sh/sdk/models/components/benefitcreate.js"
import type { BenefitMeterCreditCreate } from "@polar-sh/sdk/models/components/benefitmetercreditcreate.js"
import type { BenefitMeterCreditCreateProperties } from "@polar-sh/sdk/models/components/benefitmetercreditcreateproperties.js"
import type { MeterCreate } from "@polar-sh/sdk/models/components/metercreate.js"
import type { ProductCreateOneTime } from "@polar-sh/sdk/models/components/productcreateonetime.js"
import type { ProductCreateRecurring } from "@polar-sh/sdk/models/components/productcreaterecurring.js"
import type { ProductPriceCustomCreate } from "@polar-sh/sdk/models/components/productpricecustomcreate.js"
import type { ProductPriceFixedCreate } from "@polar-sh/sdk/models/components/productpricefixedcreate.js"
import type { ProductPriceMeteredUnitCreate } from "@polar-sh/sdk/models/components/productpricemeteredunitcreate.js"
import type { ProductPriceSeatBasedCreate } from "@polar-sh/sdk/models/components/productpriceseatbasedcreate.js"

export type StoreMetadata = { [k: string]: string | number | boolean }

export type MeteredPriceDefinition = Omit<ProductPriceMeteredUnitCreate, "meterId"> & {
  meter: string
}

export type ProductPriceDefinition =
  | ProductPriceCustomCreate
  | ProductPriceFixedCreate
  | ProductPriceSeatBasedCreate
  | MeteredPriceDefinition

type WithStoreFields<T, TMeta extends StoreMetadata> = Omit<T, "metadata" | "prices"> & {
  virtual?: boolean
  /** Optional id for virtual products. Defaults to `metadata.key` when omitted. */
  id?: string
  metadata?: TMeta
  /** Polar benefit keys to attach. Omitted means no benefits (source of truth). */
  benefits?: string[]
  prices: ProductPriceDefinition[]
}

type WithRequiredStoreMetadata<T, TMeta extends StoreMetadata> = Omit<T, "metadata" | "prices"> & {
  virtual?: boolean
  /** Optional id for virtual products. Defaults to `metadata.key` when omitted. */
  id?: string
  metadata: TMeta & { key: string }
  /** Polar benefit keys to attach. Omitted means no benefits (source of truth). */
  benefits?: string[]
  prices: ProductPriceDefinition[]
}

export type ProductDefinition<TMeta extends StoreMetadata = StoreMetadata> = (
  | WithStoreFields<ProductCreateRecurring, TMeta>
  | WithStoreFields<ProductCreateOneTime, TMeta>
) & {
  key: string
}

export type ProductCreateDefinition<TMeta extends StoreMetadata = StoreMetadata> =
  | WithRequiredStoreMetadata<ProductCreateRecurring, TMeta>
  | WithRequiredStoreMetadata<ProductCreateOneTime, TMeta>

export type MeterCreditPropertiesDefinition = Omit<BenefitMeterCreditCreateProperties, "meterId"> & {
  meter: string
}

type BenefitMeterCreditDefinition = Omit<BenefitMeterCreditCreate, "metadata" | "properties"> & {
  properties: MeterCreditPropertiesDefinition
}

type StoreBenefitCreate = Exclude<BenefitCreate, BenefitMeterCreditCreate> | BenefitMeterCreditDefinition

type WithBenefitFields<T, TMeta extends StoreMetadata> = T extends unknown
  ? Omit<T, "metadata"> & { metadata?: TMeta }
  : never

type WithRequiredBenefitMetadata<T, TMeta extends StoreMetadata> = T extends unknown
  ? Omit<T, "metadata"> & { metadata: TMeta & { key: string } }
  : never

export type BenefitDefinition<TMeta extends StoreMetadata = StoreMetadata> =
  WithBenefitFields<StoreBenefitCreate, TMeta> & {
    key: string
  }

export type BenefitCreateDefinition<TMeta extends StoreMetadata = StoreMetadata> =
  WithRequiredBenefitMetadata<StoreBenefitCreate, TMeta>

type WithMeterFields<T, TMeta extends StoreMetadata> = Omit<T, "metadata"> & {
  metadata?: TMeta
}

type WithRequiredMeterMetadata<T, TMeta extends StoreMetadata> = Omit<T, "metadata"> & {
  metadata: TMeta & { key: string }
}

export type MeterDefinition<TMeta extends StoreMetadata = StoreMetadata> = WithMeterFields<
  MeterCreate,
  TMeta
> & {
  key: string
}

export type MeterCreateDefinition<TMeta extends StoreMetadata = StoreMetadata> =
  WithRequiredMeterMetadata<MeterCreate, TMeta>
```

Keep the `T extends unknown` distributive omit on benefits so the Polar `type` discriminant still narrows.

- [ ] **Step 4: Implement `defineMeter`, convert metered amounts, export types**

In `src/index.ts`:

- Import `MeterCreateDefinition` and `MeterDefinition`.
- Add `const definedMeters: MeterCreateDefinition[] = []` next to the other arrays.
- In `defineProduct`’s price map, after the existing amount conversions, add:

```ts
      if ("unitAmount" in price && typeof price.unitAmount === "number") {
        price.unitAmount = Number((price.unitAmount * 100).toFixed(12))
      }
      if ("capAmount" in price && typeof price.capAmount === "number") {
        price.capAmount = Math.round(price.capAmount * 100)
      }
```

- Add `defineMeter` using the same key-fold pattern as `defineBenefit`.
- Return `{ defineProduct, defineBenefit, defineMeter, push }`.
- Export `MeterCreateDefinition` and `MeterDefinition` from the existing type export.

```ts
  function defineMeter<TMeta extends StoreMetadata = StoreMetadata>({
    key,
    ...details
  }: MeterDefinition<TMeta>) {
    const definition = {
      ...details,
      metadata: {
        key,
        ...details.metadata,
      } as TMeta & { key: string },
    } satisfies MeterCreateDefinition<TMeta>

    definedMeters.push(definition)

    return definition
  }
```

Do not change `push()` yet.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm exec vitest run tests/unit.test.ts`

Expected: PASS (including existing tests). The remapped metered virtual test still uses the random stub meter.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/index.ts tests/unit.test.ts
git commit -m "feat: add defineMeter and meter keys on prices and credits"
```

---

### Task 2: Resolve meter keys, rewrite Polar payloads, map virtual meters

**Files:**
- Modify: `src/lib.ts`
- Test: `tests/unit.test.ts`

**Interfaces:**
- Consumes: `ProductCreateDefinition` (metered prices have `meter`); `BenefitCreateDefinition` (`meter_credit` has `properties.meter`); Polar `Meter`
- Produces:
  - `resolveMeter(ownerKind: "product" | "benefit", ownerName: string, meterKey: string, metersByKey: Map<string, Meter>): Meter`
  - `toBenefitPayload(benefit: BenefitCreateDefinition, metersByKey: Map<string, Meter>): BenefitCreate`
  - `toProductPayload(product: ProductCreateDefinition, metersByKey?: Map<string, Meter>)` — still strips `virtual` / `id` / `benefits`; metered prices become Polar `{ meterId }` with no `meter`
  - `mapVirtualProduct(definition, benefitsByKey?: Map<string, Benefit>, metersByKey?: Map<string, Meter>): Product`
  - `downloadStoreFromCloud()` also returns `meters: Meter[]`

Error strings (exact):

- product: `Unknown meter key '${key}' on product '${name}'`
- benefit: `Unknown meter key '${key}' on benefit '${description}'`

- [ ] **Step 1: Write the failing tests**

Add a Polar `Meter` stub and these tests to `tests/unit.test.ts`. Import `resolveMeter` and `toBenefitPayload` from `../src/lib.js`. Import `Meter` from `@polar-sh/sdk/models/components/meter.js`.

```ts
import type { Meter } from "@polar-sh/sdk/models/components/meter.js"
import {
  mapVirtualProduct,
  resolveBenefits,
  resolveMeter,
  toBenefitPayload,
  toProductPayload,
  writeProductsToFile,
} from "../src/lib.js"

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
```

```ts
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
})
```

Add to the existing `toProductPayload` describe (keep the current strip test; it uses a fixed price and must still pass with the optional second argument defaulting to `new Map()`):

```ts
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
```

Replace `"maps metered unit prices with meter defaults"` with a resolve-from-map test:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run tests/unit.test.ts -t "resolveMeter|toBenefitPayload|rewrites metered price|maps metered unit prices from the synced"`

Expected: FAIL — `resolveMeter` / `toBenefitPayload` are not exported; virtual metered mapping still stubs a random meter.

- [ ] **Step 3: Implement helpers and update `mapVirtualProduct` / `downloadStoreFromCloud`**

In `src/lib.ts`, import `Meter` and `BenefitCreate`. Import `BenefitCreateDefinition` from `./types`.

```ts
import type { BenefitCreate } from "@polar-sh/sdk/models/components/benefitcreate.js"
import type { Meter } from "@polar-sh/sdk/models/components/meter.js"
import type { BenefitCreateDefinition, ProductCreateDefinition } from "./types"
```

Add listing meters next to products and benefits:

```ts
export async function downloadStoreFromCloud() {
  const [products, benefits, meters] = await Promise.all([
    fetchPolarIterator(
      globalThis.polarClient.products.list({
        organizationId: globalThis.polarOrganizationId,
      }),
    ),
    fetchPolarIterator(
      globalThis.polarClient.benefits.list({
        organizationId: globalThis.polarOrganizationId,
      }),
    ),
    fetchPolarIterator(
      globalThis.polarClient.meters.list({
        organizationId: globalThis.polarOrganizationId,
      }),
    ),
  ])

  return {
    products,
    benefits,
    meters,
  }
}
```

Add:

```ts
export function resolveMeter(
  ownerKind: "product" | "benefit",
  ownerName: string,
  meterKey: string,
  metersByKey: Map<string, Meter>,
): Meter {
  const meter = metersByKey.get(meterKey)
  if (!meter) {
    throw new Error(`Unknown meter key '${meterKey}' on ${ownerKind} '${ownerName}'`)
  }
  return meter
}

export function toBenefitPayload(
  benefit: BenefitCreateDefinition,
  metersByKey: Map<string, Meter>,
): BenefitCreate {
  if (benefit.type !== "meter_credit") {
    return benefit
  }

  const meter = resolveMeter("benefit", benefit.description, benefit.properties.meter, metersByKey)
  const { meter: _meterKey, ...properties } = benefit.properties
  return {
    ...benefit,
    properties: {
      ...properties,
      meterId: meter.id,
    },
  }
}

export function toProductPayload(
  product: ProductCreateDefinition,
  metersByKey: Map<string, Meter> = new Map(),
) {
  const { virtual: _virtual, id: _id, benefits: _benefits, ...payload } = product
  return {
    ...payload,
    prices: payload.prices.map((price) => {
      if (price.amountType !== "metered_unit") {
        return price
      }
      const meter = resolveMeter("product", product.name, price.meter, metersByKey)
      const { meter: _meterKey, ...rest } = price
      return {
        ...rest,
        meterId: meter.id,
      }
    }),
  }
}
```

Change `mapVirtualProduct` to take an optional third argument (default `new Map()`). Existing two-argument callers stay valid.

```ts
export function mapVirtualProduct(
  { virtual: _virtual, id, benefits: benefitKeys, ...product }: VirtualProductDefinition,
  benefitsByKey: Map<string, Benefit> = new Map(),
  metersByKey: Map<string, Meter> = new Map(),
): Product {
```

In the `metered_unit` price branch, resolve the key and use the Polar meter. Polar `ProductPriceMeteredUnit.unitAmount` is a `string`:

```ts
        case "metered_unit": {
          const polarMeter = resolveMeter("product", product.name, price.meter, metersByKey)
          return {
            id: crypto.randomUUID(),
            amountType: price.amountType,
            capAmount: price.capAmount ?? null,
            priceCurrency: price.priceCurrency ?? "usd",
            taxBehavior: price.taxBehavior ?? null,
            meter: {
              id: polarMeter.id,
              name: polarMeter.name,
              unit: polarMeter.unit,
              customLabel: polarMeter.customLabel ?? null,
              customMultiplier: polarMeter.customMultiplier ?? null,
            },
            meterId: polarMeter.id,
            productId,
            unitAmount: String(price.unitAmount),
            isArchived: false,
            createdAt: new Date(),
            modifiedAt: null,
            source: "catalog",
          } satisfies ProductPriceMeteredUnit
        }
```

Do not invent a random stub meter.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run tests/unit.test.ts`

Expected: PASS. Existing `toProductPayload` strip test still passes (fixed price, default empty map). Existing `mapVirtualProduct` benefit tests still pass (default empty meter map).

- [ ] **Step 5: Commit**

```bash
git add src/lib.ts tests/unit.test.ts
git commit -m "feat: resolve meter keys and rewrite Polar payloads"
```

---

### Task 3: `push()` upserts meters before benefits and products

**Files:**
- Modify: `src/index.ts`
- Test: `tests/unit.test.ts`

**Interfaces:**
- Consumes: `definedMeters`, `definedBenefits`, `definedProducts`, `downloadStoreFromCloud()`, `resolveMeter`, `toBenefitPayload`, `toProductPayload`, `mapVirtualProduct(definition, benefitsByKey, metersByKey)`
- Produces: `push()` still returns `Promise<{ updatedProducts: Product[] }>`. Meters upsert first. Benefit and product Polar calls receive rewritten copies.

Polar SDK calls (exact):

```ts
await polarClient.meters.create(payload)
await polarClient.meters.update({ id, meterUpdate })
await polarClient.benefits.create(toBenefitPayload(benefit, metersByKey))
await polarClient.benefits.update({
  id,
  requestBody: /* existing custom-note branch, but start from toBenefitPayload(...) */,
})
await polarClient.products.create(toProductPayload(product, metersByKey))
await polarClient.products.update({
  id,
  productUpdate: toProductPayload(product, metersByKey),
})
```

`meters.update` takes `{ id, meterUpdate }` (not `requestBody`). Strip `organizationId` from the stored meter before create/update if present, same idea as benefits. Pass name, unit, labels, filter, aggregation, and metadata on update.

Log meter create/update with picocolors, same style as products: `Created new meter '${name}'` / `Updated meter '${name}'`.

Validate unknown meter keys on benefits **before** any benefit create/update, and on products **before** that product’s create/update. The cheapest way: call `toBenefitPayload` / `toProductPayload` (they throw via `resolveMeter`) before the Polar call. Do not mutate `definedBenefits` / `definedProducts`.

- [ ] **Step 1: Write the failing mocked `push()` tests**

Extend `createMemoryPolar` in `tests/unit.test.ts` with an in-memory meters collection. `meters.list/create/update` must work with `downloadStoreFromCloud`. `products.create` must keep `prices` so tests can assert `meterId`. `benefits.create` already `Object.assign`s the payload.

```ts
function createMemoryPolar() {
  const benefits: Benefit[] = []
  const products: Array<Product & { metadata: { key?: string }; prices?: unknown[] }> = []
  const meters: Meter[] = []
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

  return { client: client as unknown as Polar, benefits, products, meters }
}
```

Add this describe (keep existing `"push benefits"` tests; they must still pass):

```ts
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

  it("throws before Polar writes when a benefit references an unknown meter key", async () => {
    const { client, benefits, products } = createMemoryPolar()
    const store = createStoreFn({ client, organizationId: "org_test" })

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run tests/unit.test.ts -t "push meters"`

Expected: FAIL — `downloadStoreFromCloud` / `push()` do not list or upsert meters; `client.meters` is missing.

- [ ] **Step 3: Implement meter upsert and payload rewrite in `push()`**

In `src/index.ts`, import `Meter` and `toBenefitPayload`. After `downloadStoreFromCloud()`:

1. Build `metersByKey` by upserting each `definedMeters` entry against `polarStore.meters` (`item.metadata.key === meter.metadata.key`).
   - missing `key` → `throw new Error(\`Missing 'key' in meter ${meter.name}\`)`
   - existing → `polarClient.meters.update({ id: existingMeter.id, meterUpdate })` where `meterUpdate` is the definition minus `organizationId`
   - missing → `polarClient.meters.create(meter)`
2. For each `definedBenefits` entry, compute `toBenefitPayload(benefit, metersByKey)` and pass **that copy** to `benefits.create` / `benefits.update`. Keep the existing `type === "custom"` note-null branch, applied to the copy.
3. For each `definedProducts` entry, call `toProductPayload(product, metersByKey)` instead of `toProductPayload(product)`.
4. Virtual products: `mapVirtualProduct(product, benefitsByKey, metersByKey)`.

Unknown meter keys throw from `toBenefitPayload` / `toProductPayload` before the Polar write. Call `toBenefitPayload` for every defined benefit **before** the benefit upsert loop (or at the start of each iteration before create/update) so a missing meter does not create a benefit. Same for products: resolve the payload before `products.create` / `update`.

Do not delete Polar meters that are not in the config.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run tests/unit.test.ts`

Expected: PASS, including existing `"push benefits"` tests.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts tests/unit.test.ts
git commit -m "feat: sync Polar meters and resolve keys on push"
```

---

### Task 4: Polar sandbox integration tests

**Files:**
- Modify: `tests/store-fn.test.ts`

**Interfaces:**
- Consumes: `defineMeter`, `defineBenefit`, `defineProduct`, `push()` from Task 3; existing `skipIf(!hasPolarEnv)` harness
- Produces: integration coverage for meter create/update, key rewrite, orphans, and unknown keys

Use a **new `createStoreFn` instance per test**. Track created meter ids and archive them in `afterAll` with `meters.update({ id, meterUpdate: { isArchived: true } })`. Keep using the shared `polarClient` / `POLAR_ORGANIZATION_ID` from `beforeAll`.

Metered prices require a recurring product.

- [ ] **Step 1: Write the integration tests**

Add `createdMeterIds: string[]` next to the existing cleanup arrays. In `afterAll`, after products/benefits cleanup:

```ts
    for (const meterId of createdMeterIds) {
      try {
        await polarClient.meters.update({
          id: meterId,
          meterUpdate: { isArchived: true },
        })
      } catch (error) {
        console.error(`Error archiving meter ${meterId}:`, error)
      }
    }
```

Add this describe inside the existing `describe.skipIf(!hasPolarEnv)("store-fn", …)` block:

```ts
  describe("meters", () => {
    it("creates a meter, credits it on a benefit, and bills overage on a product", async () => {
      const store = createStoreFn({
        client: polarClient,
        organizationId: POLAR_ORGANIZATION_ID,
      })
      const meterKey = `test-meter-${Date.now()}`
      const benefitKey = `test-meter-credit-${Date.now()}`
      const productKey = `test-meter-product-${Date.now()}`

      store.defineMeter({
        key: meterKey,
        name: `Test Invocations ${Date.now()}`,
        unit: "custom",
        customLabel: "invocation",
        filter: {
          conjunction: "and",
          clauses: [{ property: "name", operator: "eq", value: `invocation.${meterKey}` }],
        },
        aggregation: { func: "count" },
      })
      store.defineBenefit({
        key: benefitKey,
        type: "meter_credit",
        description: "Test 1000 included",
        properties: { meter: meterKey, units: 1000, rollover: false },
      })
      store.defineProduct({
        key: productKey,
        name: "Test Metered Plan",
        recurringInterval: "month",
        recurringIntervalCount: 1,
        prices: [
          { amountType: "fixed", priceAmount: 29.99, priceCurrency: "usd" },
          {
            amountType: "metered_unit",
            meter: meterKey,
            unitAmount: 0.1,
            priceCurrency: "usd",
          },
        ],
        benefits: [benefitKey],
      })

      const result = await store.push()
      const product = result.updatedProducts[0]
      if (product?.id) createdProductIds.push(product.id)
      if (product?.benefits[0]?.id) createdBenefitIds.push(product.benefits[0].id)

      const metered = product?.prices.find((price) => price.amountType === "metered_unit")
      expect(metered?.amountType).toBe("metered_unit")
      if (metered?.amountType === "metered_unit") {
        createdMeterIds.push(metered.meterId)
        expect(metered.meterId).toBeTruthy()
        expect(product?.benefits[0]?.type).toBe("meter_credit")
        if (product?.benefits[0]?.type === "meter_credit") {
          expect(product.benefits[0].properties.meterId).toBe(metered.meterId)
        }
      }
    }, 30000)

    it("updates a meter name on a second push", async () => {
      const meterKey = `test-meter-update-${Date.now()}`
      const productKey = `test-meter-update-product-${Date.now()}`
      const filter = {
        conjunction: "and" as const,
        clauses: [{ property: "name", operator: "eq" as const, value: `invocation.${meterKey}` }],
      }

      const first = createStoreFn({
        client: polarClient,
        organizationId: POLAR_ORGANIZATION_ID,
      })
      first.defineMeter({
        key: meterKey,
        name: "Original Meter",
        unit: "scalar",
        filter,
        aggregation: { func: "count" },
      })
      first.defineProduct({
        key: productKey,
        name: "Test Meter Update Product",
        recurringInterval: "month",
        recurringIntervalCount: 1,
        prices: [
          {
            amountType: "metered_unit",
            meter: meterKey,
            unitAmount: 0.1,
            priceCurrency: "usd",
          },
        ],
      })
      const created = await first.push()
      if (created.updatedProducts[0]?.id) createdProductIds.push(created.updatedProducts[0].id)
      const createdMetered = created.updatedProducts[0]?.prices.find(
        (price) => price.amountType === "metered_unit",
      )
      if (createdMetered?.amountType === "metered_unit") {
        createdMeterIds.push(createdMetered.meterId)
      }

      const second = createStoreFn({
        client: polarClient,
        organizationId: POLAR_ORGANIZATION_ID,
      })
      second.defineMeter({
        key: meterKey,
        name: "Updated Meter",
        unit: "scalar",
        filter,
        aggregation: { func: "count" },
      })
      second.defineProduct({
        key: productKey,
        name: "Test Meter Update Product",
        recurringInterval: "month",
        recurringIntervalCount: 1,
        prices: [
          {
            amountType: "metered_unit",
            meter: meterKey,
            unitAmount: 0.1,
            priceCurrency: "usd",
          },
        ],
      })
      const updated = await second.push()
      const updatedMetered = updated.updatedProducts[0]?.prices.find(
        (price) => price.amountType === "metered_unit",
      )
      if (updatedMetered?.amountType === "metered_unit") {
        expect(updatedMetered.meter.name).toBe("Updated Meter")
      }
    }, 30000)

    it("leaves Polar meters that are not in the store config", async () => {
      const orphan = await polarClient.meters.create({
        name: `Orphan meter ${Date.now()}`,
        unit: "scalar",
        filter: {
          conjunction: "and",
          clauses: [{ property: "name", operator: "eq", value: `orphan.${Date.now()}` }],
        },
        aggregation: { func: "count" },
      })
      createdMeterIds.push(orphan.id)

      const store = createStoreFn({
        client: polarClient,
        organizationId: POLAR_ORGANIZATION_ID,
      })
      store.defineProduct({
        key: `test-orphan-meter-product-${Date.now()}`,
        name: "Test Orphan Meter Product",
        prices: [{ amountType: "fixed", priceAmount: 5, priceCurrency: "usd" }],
      })
      const result = await store.push()
      if (result.updatedProducts[0]?.id) createdProductIds.push(result.updatedProducts[0].id)

      const fetched = await polarClient.meters.get({ id: orphan.id })
      expect(fetched.id).toBe(orphan.id)
      expect(fetched.archivedAt ?? null).toBeNull()
    }, 30000)

    it("throws when a product references a meter key that was not defined", async () => {
      const store = createStoreFn({
        client: polarClient,
        organizationId: POLAR_ORGANIZATION_ID,
      })
      const productKey = `test-missing-meter-${Date.now()}`
      store.defineProduct({
        key: productKey,
        name: "Test Missing Meter Product",
        recurringInterval: "month",
        recurringIntervalCount: 1,
        prices: [
          {
            amountType: "metered_unit",
            meter: "does-not-exist",
            unitAmount: 0.1,
            priceCurrency: "usd",
          },
        ],
      })

      try {
        await expect(store.push()).rejects.toThrow(
          "Unknown meter key 'does-not-exist' on product 'Test Missing Meter Product'",
        )
      } finally {
        const products = await fetchPolarIterator(
          polarClient.products.list({
            organizationId: POLAR_ORGANIZATION_ID,
          }),
        )
        const created = products.find((p) => p.metadata?.key === productKey)
        if (created?.id) createdProductIds.push(created.id)
      }
    }, 30000)
  })
```

- [ ] **Step 2: Run the integration file**

Run: `pnpm exec vitest run tests/store-fn.test.ts`

Expected: suite skipped if `POLAR_ACCESS_TOKEN` / `POLAR_ORGANIZATION_ID` are unset; otherwise PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/store-fn.test.ts
git commit -m "test: cover Polar meter sync and key references"
```

---

### Task 5: README

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: public API from Tasks 1–3
- Produces: documented `defineMeter` and the included-usage + overage example

- [ ] **Step 1: Update the API reference and replace the metered example**

In `README.md`:

- `createStoreFn` returns `defineProduct`, `defineBenefit`, `defineMeter`, and `push`.
- Add `store.defineMeter(definition)` after `defineBenefit`:
  - `definition.key` — unique identifier (stored in metadata)
  - `definition.name` — shown on invoices and usage
  - `definition.unit` — optional: `"scalar"` | `"token"` | `"custom"`
  - `definition.customLabel` / `definition.customMultiplier` — required when `unit` is `"custom"` (label)
  - `definition.filter` — which events to include
  - `definition.aggregation` — how to calculate quantity (`count`, `sum`, …)
  - `definition.metadata` — optional
- On `defineProduct`, note that a metered price uses `meter` (store-fn key) plus `unitAmount` in dollars.
- On `defineBenefit`, note that `meter_credit` uses `properties.meter` (store-fn key), `units`, and `rollover`.
- Update `store.push()`: syncs meters first, then benefits, then products. Does not delete Polar meters or benefits missing from the config.
- Replace the current “Metered/Usage-Based Pricing” example (the one that omits `meterId` and `unitAmount`) with:

```ts
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
  properties: {
    meter: "invocations",
    units: 1000,
    rollover: false,
  },
})

store.defineProduct({
  key: "pro",
  name: "Pro Plan",
  description: "1,000 invocations included. Extra invocations billed at $0.10.",
  recurringInterval: "month",
  recurringIntervalCount: 1,
  prices: [
    {
      amountType: "fixed",
      priceAmount: 29.99,
      priceCurrency: "usd",
    },
    {
      amountType: "metered_unit",
      meter: "invocations",
      unitAmount: 0.1, // $0.10 per extra invocation
      priceCurrency: "usd",
    },
  ],
  benefits: ["included-invocations"],
})
```

Rename that section to something like “Plan with included usage and overage” so it matches the example. Do not document virtual meters or a meters output file.

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: document defineMeter and included-usage overage plans"
```

---

## Self-review

**Spec coverage**

| Spec requirement | Task |
| --- | --- |
| `defineMeter` + `key` in metadata | 1 |
| No virtual meters | 1 (types omit `virtual`) |
| Metered price `meter` key (not `meterId`) | 1 |
| `meter_credit` `properties.meter` key | 1 |
| `unitAmount` / `capAmount` dollars → cents | 1 |
| `resolveMeter` + exact error strings | 2 |
| Rewrite on copies; stored defs keep keys | 2, 3 |
| `toProductPayload` strips store fields and sends `meterId` | 2 |
| `mapVirtualProduct` uses synced Polar meter (no random stub) | 2, 3 |
| `downloadStoreFromCloud` lists meters | 2 |
| `push()` order: meters → benefits → products | 3 |
| Full meter update (including filter/aggregation) | 3 |
| Orphan Polar meters left alone | 3, 4 |
| Unknown key throws before Polar write | 3, 4 |
| `push()` returns `{ updatedProducts }` only | 3 (unchanged) |
| No `meters.ts` / CLI still products only | 5 |
| README included 1000 + $0.10 overage + $29.99 plan | 5 |

**Placeholder scan:** none.

**Type consistency:** `defineMeter` → `MeterCreateDefinition`; helpers take `Map<string, Meter>`; `toBenefitPayload` returns Polar `BenefitCreate`; `toProductPayload(product, metersByKey)` is the only product payload used by `push()`; `mapVirtualProduct` gains a third `metersByKey` argument with a default empty map.
