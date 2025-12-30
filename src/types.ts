import { ProductCreate } from "@polar-sh/sdk/models/components/productcreate.js"

export type ProductDefinition<TMeta> = ProductCreate & {
  key: string
  virtual?: boolean
  metadata?: TMeta
}

export type ProductCreateDefinition<TMeta> = Omit<ProductCreate, "metadata"> & {
  virtual?: boolean
  metadata: TMeta & { key: string }
}
