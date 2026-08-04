import type { ProductCreateOneTime } from "@polar-sh/sdk/models/components/productcreateonetime.js"
import type { ProductCreateRecurring } from "@polar-sh/sdk/models/components/productcreaterecurring.js"

export type StoreMetadata = { [k: string]: string | number | boolean }

type WithStoreFields<T, TMeta extends StoreMetadata> = Omit<T, "metadata"> & {
  virtual?: boolean
  /** Optional id for virtual products. Defaults to `metadata.key` when omitted. */
  id?: string
  metadata?: TMeta
}

type WithRequiredStoreMetadata<T, TMeta extends StoreMetadata> = Omit<T, "metadata"> & {
  virtual?: boolean
  /** Optional id for virtual products. Defaults to `metadata.key` when omitted. */
  id?: string
  metadata: TMeta & { key: string }
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
