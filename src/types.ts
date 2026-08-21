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

/** Polar stores free prices as `amountType: "fixed"` with `priceAmount: 0`. */
export type FreePriceDefinition = {
  amountType: "free"
  priceCurrency?: ProductPriceFixedCreate["priceCurrency"]
  taxBehavior?: ProductPriceFixedCreate["taxBehavior"]
}

export type ProductPriceDefinition =
  | ProductPriceCustomCreate
  | ProductPriceFixedCreate
  | ProductPriceSeatBasedCreate
  | MeteredPriceDefinition
  | FreePriceDefinition

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
