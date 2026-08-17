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
