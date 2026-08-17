# Polar Benefits Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `store-fn` define Polar benefits, sync them by `metadata.key`, and attach them to products on every `push()`.

**Architecture:** Mirror `defineProduct`. `defineBenefit` wraps Polar’s `BenefitCreate` union and stores `key` in `metadata`. `push()` upserts benefits first, then products, then always calls `products.updateBenefits` with resolved Polar IDs (omitted `benefits` → `[]`). Helpers in `src/lib.ts` resolve keys and strip store-only fields so Polar create/update never sees `benefits: string[]`.

**Tech Stack:** TypeScript, `@polar-sh/sdk` 0.49, Vitest, existing `createStoreFn` / CLI (`writeProductsToFile` only).

## Global Constraints

- No `virtual: true` on benefits.
- No generated `benefits.ts` (or combined store file). CLI still writes products only.
- Never delete Polar benefits that are not in the store config.
- Config is source of truth for attachments: omitted `benefits` means `[]`; always call `products.updateBenefits` for non-virtual products.
- `push()` returns `{ updatedProducts: Product[] }` only.
- Support all Polar `BenefitCreate` types via the SDK union (`custom`, `discord`, `downloadables`, `feature_flag`, `github_repository`, `license_keys`, `meter_credit`, `slack_shared_channel`).
- Match benefits by `metadata.key`, same as products.
- Do not remap a benefit `type` change (no delete-and-recreate). Polar errors propagate.
- No retries, rollback, or skipping attach when the ID list is unchanged.
- No extra duplicate-key checks beyond what products already do.
- Unknown benefit key throws before that product’s `updateBenefits` call. Message includes product name and key.

---

## File map

| File | Responsibility |
| --- | --- |
| `src/types.ts` | `BenefitDefinition`, `BenefitCreateDefinition`; add `benefits?: string[]` to product definition types |
| `src/lib.ts` | `resolveBenefits`, `toProductPayload`; `mapVirtualProduct` fills Polar `Benefit` objects from a key map |
| `src/index.ts` | `defineBenefit`; `push()` upserts benefits then attaches |
| `tests/unit.test.ts` | Unit tests for define, resolve, payload strip, virtual mapping, mocked `push()` |
| `tests/store-fn.test.ts` | Polar sandbox integration tests (`skipIf` unchanged) |
| `README.md` | `defineBenefit` API and example |

Do not add new source files. Do not change the CLI except that written products will include Polar’s `benefits` array after attach.

---

### Task 1: Benefit types and `defineBenefit`

**Files:**
- Modify: `src/types.ts`
- Modify: `src/index.ts`
- Test: `tests/unit.test.ts`

**Interfaces:**
- Consumes: Polar `BenefitCreate` from `@polar-sh/sdk/models/components/benefitcreate.js`; existing `StoreMetadata` / `createStoreFn`
- Produces: `BenefitDefinition<TMeta>`, `BenefitCreateDefinition<TMeta>`, `defineBenefit(definition: BenefitDefinition): BenefitCreateDefinition`, product types with optional `benefits?: string[]`

- [ ] **Step 1: Write the failing tests**

Add these describes to `tests/unit.test.ts` (keep existing `stubPolarClient` / `createStoreFn` usage):

```ts
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
    expect(benefit.properties.note).toBe("Email support@example.com")
  })
})

describe("defineProduct", () => {
  // existing tests stay; add:
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
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run tests/unit.test.ts -t "defineBenefit|accepts benefit keys"`

Expected: FAIL — `defineBenefit` is not a function / `benefits` not on the type.

- [ ] **Step 3: Add types**

In `src/types.ts`, import `BenefitCreate` and add `benefits?: string[]` to both product wrapper types. Add benefit types (no `virtual`, no `id`):

```ts
import type { BenefitCreate } from "@polar-sh/sdk/models/components/benefitcreate.js"
import type { ProductCreateOneTime } from "@polar-sh/sdk/models/components/productcreateonetime.js"
import type { ProductCreateRecurring } from "@polar-sh/sdk/models/components/productcreaterecurring.js"

export type StoreMetadata = { [k: string]: string | number | boolean }

type WithStoreFields<T, TMeta extends StoreMetadata> = Omit<T, "metadata"> & {
  virtual?: boolean
  /** Optional id for virtual products. Defaults to `metadata.key` when omitted. */
  id?: string
  metadata?: TMeta
  /** Polar benefit keys to attach. Omitted means no benefits (source of truth). */
  benefits?: string[]
}

type WithRequiredStoreMetadata<T, TMeta extends StoreMetadata> = Omit<T, "metadata"> & {
  virtual?: boolean
  /** Optional id for virtual products. Defaults to `metadata.key` when omitted. */
  id?: string
  metadata: TMeta & { key: string }
  /** Polar benefit keys to attach. Omitted means no benefits (source of truth). */
  benefits?: string[]
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

type WithBenefitFields<T, TMeta extends StoreMetadata> = Omit<T, "metadata"> & {
  metadata?: TMeta
}

type WithRequiredBenefitMetadata<T, TMeta extends StoreMetadata> = Omit<T, "metadata"> & {
  metadata: TMeta & { key: string }
}

export type BenefitDefinition<TMeta extends StoreMetadata = StoreMetadata> =
  WithBenefitFields<BenefitCreate, TMeta> & {
    key: string
  }

export type BenefitCreateDefinition<TMeta extends StoreMetadata = StoreMetadata> =
  WithRequiredBenefitMetadata<BenefitCreate, TMeta>
```

- [ ] **Step 4: Implement `defineBenefit` and export types**

In `src/index.ts`:

- Import `BenefitCreateDefinition` and `BenefitDefinition`.
- Add `const definedBenefits: BenefitCreateDefinition[] = []` next to `definedProducts`.
- Add `defineBenefit` using the same key-fold pattern as `defineProduct` (no price conversion, no `virtual`).
- Return `{ defineProduct, defineBenefit, push }`.
- Export `BenefitCreateDefinition` and `BenefitDefinition` from the existing type export.

```ts
function defineBenefit<TMeta extends StoreMetadata = StoreMetadata>({
  key,
  ...details
}: BenefitDefinition<TMeta>) {
  const definition = {
    ...details,
    metadata: {
      key,
      ...details.metadata,
    } as TMeta & { key: string },
  } satisfies BenefitCreateDefinition<TMeta>

  definedBenefits.push(definition)

  return definition
}
```

Do not change `push()` yet.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm exec vitest run tests/unit.test.ts`

Expected: PASS (including existing tests).

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/index.ts tests/unit.test.ts
git commit -m "feat: add defineBenefit and product benefit keys"
```

---

### Task 2: Resolve keys, strip payload, map virtual benefits

**Files:**
- Modify: `src/lib.ts`
- Test: `tests/unit.test.ts`

**Interfaces:**
- Consumes: `ProductCreateDefinition` (now has `benefits?: string[]`); Polar `Benefit`
- Produces:
  - `resolveBenefits(productName: string, benefitKeys: string[] | undefined, benefitsByKey: Map<string, Benefit>): Benefit[]`
  - `toProductPayload(product: ProductCreateDefinition): Omit<ProductCreateDefinition, "virtual" | "id" | "benefits">`
  - `mapVirtualProduct(definition: VirtualProductDefinition, benefitsByKey?: Map<string, Benefit>): Product`

- [ ] **Step 1: Write the failing tests**

Add a small Polar `Benefit` stub and these tests to `tests/unit.test.ts`. Import `resolveBenefits` and `toProductPayload` from `../src/lib.js`. Import `Benefit` from `@polar-sh/sdk/models/components/benefit.js`.

```ts
import type { Benefit } from "@polar-sh/sdk/models/components/benefit.js"
import { mapVirtualProduct, resolveBenefits, toProductPayload, writeProductsToFile } from "../src/lib.js"

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
```

Add to the existing `mapVirtualProduct` describe (second argument is new; existing tests must keep passing with the default empty map):

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run tests/unit.test.ts -t "resolveBenefits|toProductPayload|resolves attached benefit|uses an empty benefits"`

Expected: FAIL — `resolveBenefits` / `toProductPayload` are not exported.

- [ ] **Step 3: Implement helpers and update `mapVirtualProduct`**

In `src/lib.ts`, import `Benefit` and `ProductCreateDefinition`. Add:

```ts
import type { Benefit } from "@polar-sh/sdk/models/components/benefit.js"
import type { ProductCreateDefinition } from "./types"

export function resolveBenefits(
  productName: string,
  benefitKeys: string[] | undefined,
  benefitsByKey: Map<string, Benefit>,
): Benefit[] {
  if (!benefitKeys?.length) {
    return []
  }

  return benefitKeys.map((key) => {
    const benefit = benefitsByKey.get(key)
    if (!benefit) {
      throw new Error(`Unknown benefit key '${key}' on product '${productName}'`)
    }
    return benefit
  })
}

export function toProductPayload(product: ProductCreateDefinition) {
  const { virtual: _virtual, id: _id, benefits: _benefits, ...payload } = product
  return payload
}
```

Change `mapVirtualProduct` to take an optional map (default `new Map()`), destructure `benefits: benefitKeys`, and set `benefits: resolveBenefits(product.name, benefitKeys, benefitsByKey)`. Do not spread `benefitKeys` onto the Polar `Product`.

```ts
export function mapVirtualProduct(
  { virtual: _virtual, id, benefits: benefitKeys, ...product }: VirtualProductDefinition,
  benefitsByKey: Map<string, Benefit> = new Map(),
): Product {
  const productId = id ?? String(product.metadata.key)
  return {
    ...product,
    id: productId,
    description: product.description ?? "",
    metadata: product.metadata ?? {},
    isRecurring: !!product.recurringInterval,
    attachedCustomFields: [],
    benefits: resolveBenefits(product.name, benefitKeys, benefitsByKey),
    // ... existing medias / timestamps / prices unchanged
  } satisfies Product
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run tests/unit.test.ts`

Expected: PASS. Existing `mapVirtualProduct` tests still pass (default empty map → `benefits: []`).

- [ ] **Step 5: Commit**

```bash
git add src/lib.ts tests/unit.test.ts
git commit -m "feat: resolve benefit keys and strip them from product payloads"
```

---

### Task 3: `push()` upserts benefits and attaches them

**Files:**
- Modify: `src/index.ts`
- Test: `tests/unit.test.ts`

**Interfaces:**
- Consumes: `definedBenefits`, `definedProducts`, `downloadStoreFromCloud()`, `resolveBenefits`, `toProductPayload`, `mapVirtualProduct(definition, benefitsByKey)`
- Produces: `push()` still returns `Promise<{ updatedProducts: Product[] }>`. After attach, each non-virtual product is the return value of `products.updateBenefits`. Virtual products use `mapVirtualProduct` with the synced benefit map.

Polar SDK calls (exact):

```ts
await polarClient.benefits.create(payload)
await polarClient.benefits.update({ id, requestBody: payload })
await polarClient.products.updateBenefits({
  id: productId,
  productBenefitsUpdate: { benefits: benefitIds },
})
```

`benefitIds` are Polar IDs from `resolveBenefits(...).map((benefit) => benefit.id)`, not keys.

- [ ] **Step 1: Write the failing mocked `push()` tests**

Add a page-iterator helper and an in-memory Polar stub to `tests/unit.test.ts`. The stub must implement `benefits.list/create/update` and `products.list/create/update/updateBenefits` enough for `downloadStoreFromCloud` + `push()`.

```ts
function asPageIterator<T>(items: T[]) {
  return Promise.resolve(
    (async function* () {
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
      create: async (payload: { metadata?: { key?: string }; description: string; type: string }) => {
        const created = stubCustomBenefit(String(payload.metadata?.key), `ben_${nextId++}`)
        Object.assign(created, payload, { id: created.id })
        benefits.push(created)
        return created
      },
      update: async ({
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
      create: async (payload: { name: string; metadata?: { key?: string } }) => {
        const created = {
          id: `prod_${nextId++}`,
          name: payload.name,
          metadata: payload.metadata ?? {},
          benefits: [] as Benefit[],
        }
        products.push(created as (typeof products)[number])
        return created
      },
      update: async ({ id, productUpdate }: { id: string; productUpdate: { name?: string } }) => {
        const existing = products.find((product) => product.id === id)
        if (!existing) throw new Error(`missing product ${id}`)
        Object.assign(existing, productUpdate)
        return existing
      },
      updateBenefits: async ({
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
```

Tests (new store per test so definitions do not accumulate):

```ts
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
    expect(products[0]?.benefits ?? []).toEqual([])
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run tests/unit.test.ts -t "push benefits"`

Expected: FAIL — `push()` does not create/attach benefits (products still get `benefits: []` for virtual; Polar attach is never called).

- [ ] **Step 3: Implement benefit upsert and attach in `push()`**

In `src/index.ts`:

1. Import `resolveBenefits` and `toProductPayload` from `./lib`.
2. Import Polar `Benefit` type.
3. After `downloadStoreFromCloud()`, upsert `definedBenefits` into a `Map<string, Benefit>` named `benefitsByKey`:
   - If `!benefit.metadata?.key`, throw `Missing 'key' in benefit ${benefit.description}`.
   - Find existing with `polarStore.benefits.find((item) => item.metadata.key === benefit.metadata.key)`.
   - Update or create. Log with `pc.green` / `pc.cyan` like products, using `benefit.description` (benefits have no `name`).
   - Do not delete Polar benefits that are not in `definedBenefits`.
4. In the product loop:
   - Virtual: `mapVirtualProduct(product, benefitsByKey)` (no Polar product calls).
   - Non-virtual: `toProductPayload(product)` for create/update (must strip `benefits`). Then `const attached = resolveBenefits(product.name, product.benefits, benefitsByKey)` and always:

```ts
const productWithBenefits = await polarClient.products.updateBenefits({
  id: upsertedProduct.id,
  productBenefitsUpdate: {
    benefits: attached.map((benefit) => benefit.id),
  },
})
updatedProducts.push(productWithBenefits)
```

If `benefits.update` rejects a create-shaped payload, pass `requestBody: payload` as Polar’s update union (cast only if the compiler requires it). Do not delete-and-recreate on type mismatch.

5. Return `{ updatedProducts }` only.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run tests/unit.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts tests/unit.test.ts
git commit -m "feat: sync Polar benefits and attach them on push"
```

---

### Task 4: Polar sandbox integration tests

**Files:**
- Modify: `tests/store-fn.test.ts`

**Interfaces:**
- Consumes: `defineBenefit`, `defineProduct`, `push()` from Task 3; existing `skipIf(!hasPolarEnv)` harness
- Produces: integration coverage for create/attach, description update, omitted-benefits wipe, orphan leave, unknown key

Use a **new `createStoreFn` instance per test** so leftover `defineProduct` / `defineBenefit` calls from other tests do not re-attach benefits. Keep using the shared `polarClient` / `POLAR_ORGANIZATION_ID` from `beforeAll`.

Track created Polar IDs and clean up in `afterAll`: archive products (existing), `benefits.delete({ id })` for test benefits (test-only cleanup; `push()` itself must never delete).

- [ ] **Step 1: Write the integration tests**

Add `createdBenefitIds: string[]` next to `createdProductIds`. In `afterAll`, after archiving products:

```ts
for (const benefitId of createdBenefitIds) {
  try {
    await polarClient.benefits.delete({ id: benefitId })
  } catch (error) {
    console.error(`Error deleting benefit ${benefitId}:`, error)
  }
}
```

Add `describe("benefits", () => { ... })` inside the existing `skipIf` suite:

```ts
describe("benefits", () => {
  it("creates a custom benefit and attaches it to a product", async () => {
    const store = createStoreFn({
      client: polarClient,
      organizationId: POLAR_ORGANIZATION_ID,
    })
    const benefitKey = `test-benefit-attach-${Date.now()}`
    const productKey = `test-product-attach-${Date.now()}`

    store.defineBenefit({
      key: benefitKey,
      type: "custom",
      description: "Test attach benefit",
      properties: { note: "integration" },
    })
    store.defineProduct({
      key: productKey,
      name: "Test Benefit Attach Product",
      prices: [{ amountType: "fixed", priceAmount: 5, priceCurrency: "usd" }],
      benefits: [benefitKey],
    })

    const result = await store.push()
    const product = result.updatedProducts[0]
    expect(product?.benefits).toHaveLength(1)
    expect(product?.benefits[0]?.metadata.key).toBe(benefitKey)

    if (product?.id) createdProductIds.push(product.id)
    if (product?.benefits[0]?.id) createdBenefitIds.push(product.benefits[0].id)
  }, 30000)

  it("updates a benefit description on a second push", async () => {
    const benefitKey = `test-benefit-update-${Date.now()}`
    const productKey = `test-product-benefit-update-${Date.now()}`

    const first = createStoreFn({
      client: polarClient,
      organizationId: POLAR_ORGANIZATION_ID,
    })
    first.defineBenefit({
      key: benefitKey,
      type: "custom",
      description: "Original benefit",
      properties: { note: null },
    })
    first.defineProduct({
      key: productKey,
      name: "Test Benefit Update Product",
      prices: [{ amountType: "fixed", priceAmount: 5, priceCurrency: "usd" }],
      benefits: [benefitKey],
    })
    const created = await first.push()
    if (created.updatedProducts[0]?.id) createdProductIds.push(created.updatedProducts[0].id)
    const benefitId = created.updatedProducts[0]?.benefits[0]?.id
    if (benefitId) createdBenefitIds.push(benefitId)

    const second = createStoreFn({
      client: polarClient,
      organizationId: POLAR_ORGANIZATION_ID,
    })
    second.defineBenefit({
      key: benefitKey,
      type: "custom",
      description: "Updated benefit",
      properties: { note: null },
    })
    second.defineProduct({
      key: productKey,
      name: "Test Benefit Update Product",
      prices: [{ amountType: "fixed", priceAmount: 5, priceCurrency: "usd" }],
      benefits: [benefitKey],
    })
    const updated = await second.push()
    expect(updated.updatedProducts[0]?.benefits[0]?.description).toBe("Updated benefit")
  }, 30000)

  it("clears product attachments when benefits are omitted", async () => {
    const benefitKey = `test-benefit-clear-${Date.now()}`
    const productKey = `test-product-clear-${Date.now()}`

    const first = createStoreFn({
      client: polarClient,
      organizationId: POLAR_ORGANIZATION_ID,
    })
    first.defineBenefit({
      key: benefitKey,
      type: "custom",
      description: "Clear-me benefit",
      properties: { note: null },
    })
    first.defineProduct({
      key: productKey,
      name: "Test Benefit Clear Product",
      prices: [{ amountType: "fixed", priceAmount: 5, priceCurrency: "usd" }],
      benefits: [benefitKey],
    })
    const created = await first.push()
    if (created.updatedProducts[0]?.id) createdProductIds.push(created.updatedProducts[0].id)
    if (created.updatedProducts[0]?.benefits[0]?.id) {
      createdBenefitIds.push(created.updatedProducts[0].benefits[0].id)
    }
    expect(created.updatedProducts[0]?.benefits).toHaveLength(1)

    const second = createStoreFn({
      client: polarClient,
      organizationId: POLAR_ORGANIZATION_ID,
    })
    second.defineBenefit({
      key: benefitKey,
      type: "custom",
      description: "Clear-me benefit",
      properties: { note: null },
    })
    second.defineProduct({
      key: productKey,
      name: "Test Benefit Clear Product",
      prices: [{ amountType: "fixed", priceAmount: 5, priceCurrency: "usd" }],
    })
    const cleared = await second.push()
    expect(cleared.updatedProducts[0]?.benefits).toEqual([])
  }, 30000)

  it("leaves Polar benefits that are not in the store config", async () => {
    const orphan = await polarClient.benefits.create({
      type: "custom",
      description: `Orphan ${Date.now()}`,
      properties: { note: null },
    })
    createdBenefitIds.push(orphan.id)

    const store = createStoreFn({
      client: polarClient,
      organizationId: POLAR_ORGANIZATION_ID,
    })
    store.defineProduct({
      key: `test-orphan-product-${Date.now()}`,
      name: "Test Orphan Product",
      prices: [{ amountType: "fixed", priceAmount: 5, priceCurrency: "usd" }],
    })
    const result = await store.push()
    if (result.updatedProducts[0]?.id) createdProductIds.push(result.updatedProducts[0].id)

    const fetched = await polarClient.benefits.get({ id: orphan.id })
    expect(fetched.id).toBe(orphan.id)
  }, 30000)

  it("throws when a product references a benefit key that was not defined", async () => {
    const store = createStoreFn({
      client: polarClient,
      organizationId: POLAR_ORGANIZATION_ID,
    })
    store.defineProduct({
      key: `test-missing-benefit-${Date.now()}`,
      name: "Test Missing Benefit Product",
      prices: [{ amountType: "fixed", priceAmount: 5, priceCurrency: "usd" }],
      benefits: ["does-not-exist"],
    })

    await expect(store.push()).rejects.toThrow(
      "Unknown benefit key 'does-not-exist' on product 'Test Missing Benefit Product'",
    )
  }, 30000)
})
```

If the unknown-key test creates a Polar product before throwing, push its id into `createdProductIds` in a `try/finally` so `afterAll` can archive it.

- [ ] **Step 2: Run unit tests (always) and integration if env is set**

Run: `pnpm exec vitest run tests/unit.test.ts`

Expected: PASS.

Run: `pnpm exec vitest run tests/store-fn.test.ts`

Expected: suite skipped if `POLAR_ACCESS_TOKEN` / `POLAR_ORGANIZATION_ID` are unset; otherwise PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/store-fn.test.ts
git commit -m "test: cover Polar benefit sync and product attach"
```

---

### Task 5: README

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: public API from Tasks 1–3
- Produces: documented `defineBenefit` and `benefits` on `defineProduct`

- [ ] **Step 1: Update the API reference and add an example**

In `README.md`:

- `createStoreFn` returns `defineProduct`, `defineBenefit`, and `push`.
- Add `store.defineBenefit(definition)` after `defineProduct`:
  - `definition.key` — unique identifier (stored in metadata)
  - `definition.type` — Polar benefit type
  - `definition.description` — shown on products that grant the benefit
  - `definition.properties` — Polar type-specific properties
  - `definition.metadata` — optional
  - `definition.visibility` — optional
- Add `definition.benefits` to `defineProduct`: optional array of benefit keys. Omitted means no benefits; `push` replaces Polar attachments.
- Update `store.push()`: syncs benefits first, then products, then attaches by key. Does not delete Polar benefits missing from the config.
- Add a usage example (custom benefit + product attach) next to the other examples:

```ts
store.defineBenefit({
  key: "priority-support",
  type: "custom",
  description: "Priority support",
  properties: {
    note: "Email support@example.com",
  },
})

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
  benefits: ["priority-support"],
})
```

Do not document virtual benefits or a benefits output file.

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: document defineBenefit and product benefit keys"
```

---

## Self-review

**Spec coverage**

| Spec requirement | Task |
| --- | --- |
| `defineBenefit` + `key` in metadata | 1 |
| All Polar `BenefitCreate` types | 1 (SDK union) |
| No virtual benefits | 1 (types omit `virtual`) |
| `defineProduct({ benefits: string[] })` | 1 |
| Strip `benefits` before Polar product create/update | 2 (`toProductPayload`) |
| Omitted / empty → `[]` | 2 (`resolveBenefits`) |
| Unknown key throws with product name + key | 2, 3, 4 |
| `mapVirtualProduct` resolves synced Polar benefits | 2, 3 |
| Use downloaded Polar benefits | 3 |
| Upsert benefits; never delete orphans | 3, 4 |
| Always `updateBenefits` for non-virtual products | 3 |
| `push()` returns `{ updatedProducts }` only | 3 |
| Log benefit create/update | 3 |
| No type remapping | 3 (pass through Polar error) |
| Integration: create/attach, update, clear, orphan, unknown key | 4 |
| No `benefits.ts`; CLI unchanged | 5 / file map |
| README | 5 |
