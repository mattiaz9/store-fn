import { Polar } from "@polar-sh/sdk"
import { ProductCreate } from "@polar-sh/sdk/models/components/productcreate.js"
import { ProductCreateDefinition, ProductDefinition } from "./types"
import { downloadStoreFromCloud, mapVirtualProduct, writeProductsToFile } from "./lib"
import { Product } from "@polar-sh/sdk/models/components/product.js"
import pc from "picocolors"

interface CreateStoreFnOptions {
  client: Polar
  organizationId: string
}

function createStoreFn(options: CreateStoreFnOptions) {
  let definedProducts: ProductCreateDefinition<any>[] = []

  function defineProduct<TMeta extends ProductCreate["metadata"]>({
    key,
    ...details
  }: ProductDefinition<TMeta>) {
    details.prices = details.prices.map((price) => {
      if ("priceAmount" in price) {
        price.priceAmount = Math.round(price.priceAmount * 100)
      }
      if ("presetAmount" in price && typeof price.presetAmount === "number") {
        price.presetAmount = Math.round(price.presetAmount * 100)
      }
      if ("minimumAmount" in price && typeof price.minimumAmount === "number") {
        price.minimumAmount = Math.round(price.minimumAmount * 100)
      }
      if ("maximumAmount" in price && typeof price.maximumAmount === "number") {
        price.maximumAmount = Math.round(price.maximumAmount * 100)
      }
      return price
    })

    const definition = {
      ...details,
      metadata: {
        key,
        ...details.metadata,
      } as TMeta & { key: string },
    } satisfies ProductCreateDefinition<TMeta>

    definedProducts.push(definition)

    return definition
  }

  async function sync() {
    globalThis.polarClient = options.client
    globalThis.polarOrganizationId = options.organizationId

    const polarStore = await downloadStoreFromCloud()

    let updatedProducts: Product[] = []

    for (const product of definedProducts) {
      if (!product.metadata?.key) {
        throw new Error(`Missing 'key' in product ${product.name}`)
      }

      if (product.virtual) {
        const virtualProduct = mapVirtualProduct(product)
        updatedProducts.push(virtualProduct)
        continue
      }

      const existingProduct = polarStore.products.find(
        (p) => p.metadata.key === product.metadata?.key,
      )

      if (existingProduct) {
        const updatedProduct = await polarClient.products.update({
          id: existingProduct.id,
          productUpdate: product,
        })
        updatedProducts.push(updatedProduct)

        console.log(pc.green(`Updated product ${pc.bold(product.name)}`))
      } else {
        const createdProduct = await polarClient.products.create(product)
        updatedProducts.push(createdProduct)

        console.log(pc.green(`Created new product ${pc.bold(product.name)}`))
      }
    }

    // @ts-expect-error
    globalThis.polarClient = undefined
    // @ts-expect-error
    globalThis.polarOrganizationId = undefined

    return {
      updatedProducts,
    }
  }

  return { defineProduct, sync }
}

export { createStoreFn, writeProductsToFile }
