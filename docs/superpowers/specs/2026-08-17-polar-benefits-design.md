# Polar benefits: sync and attach

Date: 2026-08-17

## Problem

`store-fn` can define and sync Polar products, but it cannot define Polar benefits or attach them to products. `downloadStoreFromCloud` already lists organization benefits and then ignores them. Virtual products hardcode `benefits: []`. Polar does not accept benefits on `products.create` / `products.update`; attachment is a separate `products.updateBenefits` call that replaces the full ID list.

## Goals

- Define benefits in `store.config.ts` the same way products are defined.
- Sync those benefits to Polar (create or update).
- Attach them to products by key on every `push()`.
- Keep the generated products file as the only codegen output; Polar already nests benefits on `Product`.

## Non-goals

- Virtual benefits (`virtual: true` on `defineBenefit`).
- A generated `benefits.ts` (or a combined store file).
- Deleting Polar benefits that are not in the store config.
- Changing a benefit’s Polar `type` for an existing `key` (no delete-and-recreate).
- Retries, rollback, or skipping `updateBenefits` when the ID list is unchanged.
- Extra uniqueness checks beyond what products already do.

## Public API

`createStoreFn` adds `defineBenefit` beside `defineProduct`. Identification matches products: required `key` is written into `metadata.key`.

`defineBenefit` wraps Polar’s `BenefitCreate` union. Supported types are whatever the SDK exposes today:

- `custom`
- `discord`
- `downloadables`
- `feature_flag`
- `github_repository`
- `license_keys`
- `meter_credit`
- `slack_shared_channel`

Benefits have no `virtual` field.

```ts
store.defineBenefit({
  key: "pro-license",
  type: "license_keys",
  description: "Pro license key",
  properties: {
    /* Polar license-key properties */
  },
})

store.defineProduct({
  key: "pro",
  name: "Pro Plan",
  prices: [{ amountType: "fixed", priceAmount: 29.99, priceCurrency: "usd" }],
  benefits: ["pro-license"],
})
```

`benefits` on a product is a store-fn-only field: `string[]` of benefit keys. It is stripped before `products.create` / `products.update`.

`push()` still returns `{ updatedProducts: Product[] }`. After attach, each Polar `Product` includes its `benefits` array, so the existing CLI write to `products.ts` is sufficient.

## Types

Follow the product pattern in `src/types.ts`:

- `BenefitDefinition` = Polar `BenefitCreate` (metadata omitted) plus `key: string` and optional `metadata`.
- `BenefitCreateDefinition` = same, with `metadata` required and including `key`.
- `ProductDefinition` / `ProductCreateDefinition` gain optional `benefits?: string[]`.

`defineBenefit` returns the stored create definition (key folded into metadata), same as `defineProduct`.

Export the new types from `src/index.ts`.

## Push flow

`push()` remains a single function. Order is fixed because attach needs Polar benefit IDs.

1. Set `globalThis.polarClient` / `polarOrganizationId` as today.
2. `downloadStoreFromCloud()` — use both `products` and `benefits`.
3. Upsert each defined benefit by `metadata.key`:
   - missing `key` → throw (`Missing 'key' in benefit …`).
   - match existing Polar benefit → `benefits.update`.
   - no match → `benefits.create`.
   - Polar benefits not in the config are left untouched.
4. Upsert each defined product as today, using the benefit map from step 3:
   - **Virtual:** never call Polar. `mapVirtualProduct` takes the synced Polar benefits and sets `product.benefits` to the resolved objects (or `[]` if omitted). Unknown key throws.
   - **Non-virtual:** `products.create` / `products.update`, then always `products.updateBenefits` with the resolved Polar IDs. Omitted `benefits` means `[]` (config is the source of truth for attachments). Unknown key throws before that product’s `updateBenefits` call.
5. Clear globals. Return `{ updatedProducts }`.

Strip `virtual`, `id`, and `benefits` from the product payload sent to Polar create/update.

Log benefit create/update the same way products are logged.

## Errors

- Missing `key` on a benefit → throw, same style as products.
- A product `benefits` entry that was never `defineBenefit`’d → throw **before** any `updateBenefits` call. Message includes the product name and the unknown key.
- Polar API failures on create, update, or attach propagate. No retries. No partial rollback.
- Changing `type` on an existing `key` is not remapped. Polar rejects it; surface that error.
- Duplicate `defineBenefit` keys: no extra check (same as products).
- Orphan Polar benefits: never deleted.
- `updateBenefits` always runs for non-virtual products, including when the ID list is unchanged.

## Testing

### Unit (`tests/unit.test.ts`, no Polar)

- `defineBenefit` writes `key` into `metadata` and keeps Polar fields (`type`, `description`, `properties`).
- `defineProduct` accepts `benefits: string[]` and does not put that array on the Polar create/update payload.
- Virtual product with keys: `mapVirtualProduct` fills `benefits` from the just-synced Polar benefit objects.
- Unknown key throws with product name and key.
- Omitted `benefits` → attach payload `[]`.

### Integration (`tests/store-fn.test.ts`, existing `skipIf` Polar sandbox)

- Create a `custom` benefit, attach it to a new product, assert Polar product benefit IDs.
- Update the benefit description, push again, assert it changed.
- Push the same product with `benefits` omitted, assert Polar attachments are empty.
- Leave an extra Polar benefit (not in the config); assert it still exists after push.
- Reference a missing key; assert throw.

CLI is unchanged except that written products include Polar’s `benefits` array.

## Implementation notes

- Reuse `fetchPolarIterator` for benefit list (already in `downloadStoreFromCloud`).
- `mapVirtualProduct` takes the synced Polar benefit list (or a key → benefit map) so it can resolve product keys to Polar `Benefit` objects in the same product loop.
- Polar `benefits.update` takes `{ id, requestBody }` with a typed update union; pass the definition minus store-only fields.
- Polar `products.updateBenefits` takes `{ id, productBenefitsUpdate: { benefits: string[] } }` where the strings are Polar benefit IDs, not keys.
