import { Polar } from "@polar-sh/sdk"
import { ProductCreate } from "@polar-sh/sdk/models/components/productcreate.js"

declare global {
  var polarClient: Polar
  var polarOrganizationId: string
}

export type ProductDefinition<TMeta> = ProductCreate & {
  key: string
  metadata?: TMeta
} & ({ virtual?: false | undefined } | { virtual: true; id: string })

export type ProductCreateDefinition<TMeta> = Omit<ProductCreate, "metadata"> & {
  metadata: TMeta & { key: string }
} & ({ virtual?: false | undefined } | { virtual: true; id: string })
