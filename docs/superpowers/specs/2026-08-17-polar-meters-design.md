# Polar meters: define, sync, and reference by key

Date: 2026-08-17

## Problem

Polar meters are a first-class entity (`meters.create` / `update` / `list`). Metered product prices and `meter_credit` benefits both require a Polar `meterId`. store-fn can define products and benefits, but it cannot define meters. The README metered example omits `meterId` and `unitAmount`, so a real Polar create fails. Users who want “1,000 included, then $0.10 overage” must create the meter in Polar and paste UUIDs — the same gap `defineBenefit` closed for benefits.

## Goals

- Define meters in `store.config.ts` the same way products and benefits are defined.
- Sync those meters to Polar (create or update) before benefits and products.
- Let metered prices and `meter_credit` benefits reference a meter by store-fn `key`.
- Convert metered `unitAmount` and `capAmount` from dollars, same idea as `priceAmount`.
- Document the included-usage + overage plan in the README.
- Keep the generated products file as the only codegen output; Polar already nests the meter on metered prices.

## Non-goals

- Virtual meters (`virtual: true` on `defineMeter`).
- A generated `meters.ts` (or a combined store file).
- Deleting or archiving Polar meters that are not in the store config.
- Skipping filter/aggregation on update to avoid Polar’s lock.
- Event ingestion, customer meters, or meter quantities.
- Extra uniqueness checks beyond what products and benefits already do.

## Public API

`createStoreFn` adds `defineMeter` beside `defineProduct` and `defineBenefit`. Identification matches both: required `key` is written into `metadata.key`.

`defineMeter` wraps Polar’s `MeterCreate`. Meters have no `virtual` field.

Metered prices and `meter_credit` benefits drop Polar’s `meterId` and take a store-fn key instead:

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
      unitAmount: 0.10,
      priceCurrency: "usd",
    },
  ],
  benefits: ["included-invocations"],
})
```

`meter` on a price and `properties.meter` on a `meter_credit` benefit are store-fn-only. `push()` rewrites them to Polar `meterId` before any Polar call.

`unitAmount` and `capAmount` are dollars (numbers). `defineProduct` multiplies both by 100 at define time, like `priceAmount`. `unitAmount` keeps precision (Polar allows fractional cents, up to 12 decimal places). `capAmount` rounds like `priceAmount`.

`defineMeter` returns the stored create definition (key folded into metadata), same as `defineProduct` / `defineBenefit`.

Export the new types from `src/index.ts`.

## Types

Follow the product/benefit pattern in `src/types.ts`:

- `MeterDefinition<TMeta>` = Polar `MeterCreate` (metadata omitted) plus `key: string` and optional `metadata`.
- `MeterCreateDefinition<TMeta>` = same, with `metadata` required and including `key`.
- Product price union: the `metered_unit` variant is `Omit<ProductPriceMeteredUnitCreate, "meterId"> & { meter: string }`. Other price variants are unchanged.
- `meter_credit` benefit: `properties` is `Omit<BenefitMeterCreditCreateProperties, "meterId"> & { meter: string }`. Other benefit types are unchanged.

`ProductDefinition` / `ProductCreateDefinition` and `BenefitDefinition` / `BenefitCreateDefinition` use those remapped unions so config authors never see Polar `meterId`.

## Push flow

`push()` remains a single function. Order is fixed because benefits and products need Polar meter IDs.

1. Set `globalThis.polarClient` / `polarOrganizationId` as today.
2. `downloadStoreFromCloud()` — list products, benefits, **and meters**.
3. Upsert each defined meter by `metadata.key`:
   - missing `key` → throw (`Missing 'key' in meter …`).
   - match existing Polar meter → `meters.update` with the full definition (name, unit, labels, filter, aggregation, metadata).
   - no match → `meters.create`.
   - Polar meters not in the config are left untouched.
4. For each `meter_credit` benefit, rewrite a **copy** of `properties` (`meter` → Polar `meterId`). Do not mutate the stored definition — a second `push()` must still see the key. Unknown key throws **before** any benefit create/update. Message includes the benefit description and the unknown key.
5. Upsert benefits as today, sending the copied payload with Polar `meterId` (never `meter`).
6. For each metered price, rewrite a **copy** of the price (`meter` → Polar `meterId`). Unknown key throws **before** that product’s create/update. Message includes the product name and the unknown key.
7. Upsert products and attach benefits as today. `toProductPayload` strips `virtual`, `id`, and `benefits`. Metered prices on that payload carry `meterId` only.
8. Clear globals. Return `{ updatedProducts }`.

Virtual products still never call Polar. `mapVirtualProduct` takes the synced Polar meter map. A metered price must resolve `meter` to the Polar meter object (`id`, `name`, `unit`, labels). Non-metered prices are unchanged. Unknown key throws. Do not invent a random stub meter.

Log meter create/update the same way products and benefits are logged.

## Errors

- Missing `key` on a meter → throw, same style as products and benefits.
- A price or `meter_credit` `meter` that was never `defineMeter`’d → throw before the Polar call that would need the id. Message includes the product name or benefit description and the unknown key.
- Polar API failures on create or update propagate. No retries. No partial rollback.
- Polar may reject filter/aggregation updates after the meter has processed events or a customer purchase. Surface that error. Changing a locked meter means a new `key` (new Polar meter).
- Duplicate `defineMeter` keys: no extra check (same as products and benefits).
- Orphan Polar meters: never deleted or archived.

## Testing

### Unit (`tests/unit.test.ts`, no Polar)

- `defineMeter` writes `key` into `metadata` and keeps Polar fields (`name`, `unit`, `filter`, `aggregation`).
- Metered price accepts `meter` and does not put `meter` on the Polar create/update payload (`meterId` is the resolved UUID).
- `meter_credit` benefit accepts `properties.meter` and sends `properties.meterId` to Polar.
- `unitAmount: 0.10` → `10`; `capAmount` rounds like `priceAmount`.
- Virtual product with a meter key: `mapVirtualProduct` fills `meter` / `meterId` from the just-synced Polar meter object.
- Unknown meter key throws with the product name or benefit description and the key.

### Integration (`tests/store-fn.test.ts`, existing `skipIf` Polar sandbox)

- Create a meter, a `meter_credit` benefit, and a product with a fixed price plus a metered price; assert Polar `meterId`s on the benefit and the metered price match the created meter.
- Update the meter name, push again, assert it changed.
- Leave an extra Polar meter (not in the config); assert it still exists after push.
- Reference a missing meter key; assert throw.

CLI is unchanged except that written products include Polar’s nested meter on metered prices.

## README

Replace the current “Metered/Usage-Based Pricing” example (which omits `meterId` and `unitAmount`) with the included-usage + overage example from Public API: `defineMeter`, `meter_credit` for 1,000 invocations, fixed $29.99/mo, and `metered_unit` at `$0.10` per extra invocation.

Document `defineMeter` in the API reference next to `defineBenefit`. Note that `push()` upserts meters first, then benefits, then products.

## Implementation notes

- Reuse `fetchPolarIterator` for the meter list in `downloadStoreFromCloud`.
- Add `resolveMeter(key, metersByKey)` (or equivalent) used by benefit rewrite, product price rewrite, and `mapVirtualProduct`.
- Polar `meters.update` takes `{ id, meterUpdate }`. Pass the definition minus store-only fields. Do not special-case filter/aggregation.
- Polar `products.create` / `update` require `meterId` and `unitAmount` on `metered_unit` prices. Rewrite before those calls.
- Polar `benefits.create` / `update` for `meter_credit` require `properties.meterId`. Rewrite before those calls.
- `mapVirtualProduct`’s current random meter stub is removed. A metered virtual price must resolve `meter` from the synced map.
- Benefit and product Polar payloads are copies. Stored definitions keep `meter` keys so `push()` is idempotent.
